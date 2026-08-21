//
// SERVER-SIDE ONLY. This module reads the relayer's signing key out of the process
// environment. It must never be imported by, bundled into, or otherwise reachable
// from browser code — the whole point of the split is that the key stays here while
// `paymaster.ts` (which the browser does hold) stays free of credentials.
//
// The environment is the right home for exactly these two values and nothing else:
// network parameters are facts about a network and live in constants.ts, under
// version control where they can be reviewed. Only secrets come from the env.
//
// This process holds a funded key and pays for what it signs, so reaching the port is
// itself an ability worth restricting. Two controls, in order of how much they buy:
//
//   1. It binds 127.0.0.1 unless RELAYER_HOST says otherwise. Exposing a funded signer
//      to every interface has to be a deliberate act, not what a missed setting does.
//   2. allowlist.ts decides what may be signed at all. Everything else is refused
//      BEFORE the key is used — see the policy gate in handle().
//
// Operational rule that backs both up: fund this wallet with only what the current
// batch needs, so a mistake in either control costs a batch rather than a balance.
//
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Account, RpcProvider, type Call } from 'starknet'
import { NET } from '../../protocol/src/constants.js'
import { withFallback } from '../../protocol/src/rpc.js'
import { assertSubmittable, type SubmissionPolicy } from './allowlist.js'

// R10 names `POST /submit`; the browser posts to the same-origin `/api/submit`, which
// a dev-server proxy or edge rule normally rewrites. Accepting both means the two
// halves connect whether or not that rewrite is in place.
const SUBMIT_PATHS = new Set(['/submit', '/api/submit'])

const JSON_HEADERS = { 'content-type': 'application/json' }

// A submission is a handful of calls. Anything larger is not one, so stop reading
// rather than buffering an unbounded body into memory.
const MAX_BODY_BYTES = 1_000_000

/**
 * Signs and broadcasts the calls, yielding the transaction hash. Injected rather than
 * reached for directly so the request handling around it can be tested without a real
 * mainnet submission — the one part of this file that cannot be exercised for free.
 */
export type SubmitCalls = (calls: Call[]) => Promise<string>

/** Fails at startup rather than as an opaque signing error on the first request. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The relayer cannot sign without it. Set it in the server ` +
        `environment only — never in a VITE_-prefixed variable, which ships to the browser.`,
    )
  }
  return value
}

/** Never throws: a response we cannot deliver must not become an uncaught exception. */
function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  try {
    res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body))
  } catch (e) {
    // The socket died between the check above and the write. Nobody left to tell.
    console.warn(`relayer: could not send ${status}: ${String(e)}`)
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  submit: SubmitCalls,
  policy: SubmissionPolicy,
) {
  if (req.method !== 'POST' || !SUBMIT_PATHS.has(req.url ?? '')) {
    send(res, 404, { error: 'not found' })
    return
  }

  // A malformed request is the caller's fault (400); a failed submission is ours or
  // the chain's (502). Collapsing both into one status would misdirect every debug.
  let calls: Call[]
  try {
    const body = (await readJsonBody(req)) as { calls?: Call[] }
    if (!Array.isArray(body.calls) || body.calls.length === 0) {
      throw new Error('body must carry a non-empty `calls` array')
    }
    calls = body.calls
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  // The policy gate. This runs BEFORE the key is used, and its order relative to
  // submit() is the whole control: a refusal reported after signing would be no
  // refusal at all. 403 rather than 400 — the request was legible, just not permitted.
  try {
    assertSubmittable(calls, policy)
  } catch (e) {
    send(res, 403, { error: String(e) })
    return
  }

  try {
    // Our address is the one the public record will show against this transaction.
    // That is the entire service being offered; see paymaster.ts.
    send(res, 200, { transactionHash: await submit(calls) })
  } catch (e) {
    send(res, 502, { error: String(e) })
  }
}

export function createRelayerServer(submit: SubmitCalls, policy: SubmissionPolicy = {}): Server {
  return createServer((req, res) => {
    // A client that vanishes mid-request — closed tab, dropped network — makes Node
    // emit 'error' on these streams. An 'error' event with no listener is rethrown as
    // an uncaught exception, and this process is a singleton that must outlive the
    // whole judging session: one dropped connection must not end it. There is nobody
    // left to answer by this point, so noting it is the only action available.
    req.on('error', (e) => console.warn(`relayer: request stream failed: ${e.message}`))
    res.on('error', (e) => console.warn(`relayer: response stream failed: ${e.message}`))

    handle(req, res, submit, policy).catch((e) => {
      // Last line of defence. Nothing in handle() may escape as an unhandled rejection.
      console.warn(`relayer: unhandled request failure: ${String(e)}`)
      send(res, 500, { error: 'internal error' })
    })
  })
}

/**
 * Returns the first RPC host that actually answers, so a dead primary at boot does not
 * silently become a relayer that cannot submit anything.
 *
 * This probes with a READ, before any key is used and before anything is signed, so
 * there is no double-submission risk. Deliberately NOT retry-on-error for the write
 * path: once a submission has been broadcast, a connection failure and a JSON-RPC
 * error are not distinguishable from here, and retrying the latter risks broadcasting
 * twice. That distinction needs the real submission path and stays deferred.
 */
export async function pickLiveRpcHost(): Promise<string> {
  return withFallback(async (p) => {
    await p.getBlockNumber()
    return p.channel.nodeUrl
  })
}

/**
 * The deployed MessageBook, if there is one. Absent before Task 7 deploys it, which is
 * not an error: the pool and STRK entries stand on their own, and an allowlist that is
 * missing an entry refuses too much rather than too little.
 */
function deployedMessageBook(): string | undefined {
  try {
    const raw = readFileSync(new URL('../../../evidence/deployment.json', import.meta.url), 'utf8')
    return (JSON.parse(raw) as { contractAddress?: string }).contractAddress
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const address = required('RELAYER_ADDRESS')
  const privateKey = required('RELAYER_PRIVATE_KEY')
  const port = Number(process.env.PORT ?? 8787)
  // Loopback unless deliberately overridden. A funded signer reachable from every
  // interface must be something someone chose, not something a missing variable did.
  const host = process.env.RELAYER_HOST ?? '127.0.0.1'

  const nodeUrl = await pickLiveRpcHost()
  const account = new Account({
    provider: new RpcProvider({ nodeUrl }),
    address,
    signer: privateKey,
  })

  const messageBook = deployedMessageBook()
  const server = createRelayerServer(async (calls) => {
    const { transaction_hash } = await account.execute(calls)
    return transaction_hash
  }, { messageBook })

  server.listen(port, host, () => {
    console.log(`relayer listening on ${host}:${port}, submitting as ${address} via ${nodeUrl}`)
    console.log(`allowlist: pool ${NET.pool} · STRK approve-to-pool only`)
    console.log(messageBook ? `allowlist: MessageBook ${messageBook}` : 'allowlist: no MessageBook deployed yet')
    if (host !== '127.0.0.1') {
      console.warn(`WARNING: bound to ${host}, not loopback. This signer is reachable off-host.`)
    }
  })
}

// Only when run directly. Importing this module (tests, tooling) must stay side-effect
// free, but launching it must still fail loudly on a missing secret before it listens.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
