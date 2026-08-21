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
// itself an ability worth restricting. Four controls, in order of how much they buy:
//
//   1. It requires content-type: application/json and refuses an unexpected Origin.
//      This is what separates a web page from the key. Loopback is NOT a boundary
//      against the operator's own browser: a cross-origin <form enctype="text/plain">
//      is a CORS simple request, fires no preflight, and posts a body that parses as
//      JSON. The attacker cannot read the reply and does not need to — the transaction
//      is already signed. A form cannot send application/json, and anything that can
//      is preflighted against a server that answers no CORS headers.
//   2. allowlist.ts decides what may be signed at all, and caps how much an approve
//      may authorise. Everything is refused BEFORE the key is used — see handle().
//   3. It binds 127.0.0.1 unless RELAYER_HOST says otherwise. Exposing a funded signer
//      to every interface has to be a deliberate act, not what a missed setting does.
//      Treat RELAYER_HOST as a gate that authentication and rate limiting must come
//      before: the allowlist bounds what may be signed, never by whom or how often.
//   4. The approve ceiling is drawn from the LIVE fee, per submission.
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
import { readPoolConstants } from '../../protocol/src/pool.js'
import { assertSubmittable, APPROVE_FEE_MULTIPLE, type SubmissionPolicy } from './allowlist.js'

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

async function handle(req: IncomingMessage, res: ServerResponse, opts: RelayerServerOptions) {
  const { submit, resolvePolicy, allowedOrigins = new Set<string>() } = opts

  if (req.method !== 'POST' || !SUBMIT_PATHS.has(req.url ?? '')) {
    send(res, 404, { error: 'not found' })
    return
  }

  // Loopback binds the socket; it does not keep out the operator's own browser, which
  // is already inside that boundary. Any page they visit can post here, so these two
  // checks are what actually separate a web page from a funded key.
  //
  // A cross-origin <form> can only send text/plain, urlencoded or multipart — none of
  // them this — and it cannot set a header to fake it. Anything that CAN set
  // application/json cross-origin is preflighted, and we answer no CORS headers at all.
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (contentType !== 'application/json') {
    send(res, 415, { error: 'content-type must be application/json' })
    return
  }

  // A same-process caller sends no Origin at all. A browser always sends one, so an
  // Origin we did not expect is by definition not the caller this endpoint is for.
  const origin = req.headers.origin
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    send(res, 403, { error: `refusing a submission from origin ${origin}` })
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

  // The approve ceiling is drawn from the live fee, which is mutable with zero upgrade
  // delay, so it is read per submission rather than pinned at boot. If it cannot be
  // read we refuse: without a bound there is nothing to check an approve against.
  let policy: SubmissionPolicy
  try {
    policy = await resolvePolicy()
  } catch (e) {
    send(res, 503, { error: `refusing to sign: the live fee could not be read: ${String(e)}` })
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

export interface RelayerServerOptions {
  /** Signs and broadcasts. Injected so everything around it is testable for free. */
  submit: SubmitCalls
  /** Resolved per submission, because the fee it bounds is mutable at zero delay. */
  resolvePolicy: () => Promise<SubmissionPolicy>
  /** Browser origins permitted to post. Empty means only callers that send no Origin. */
  allowedOrigins?: ReadonlySet<string>
}

export function createRelayerServer(options: RelayerServerOptions): Server {
  return createServer((req, res) => {
    // A client that vanishes mid-request — closed tab, dropped network — makes Node
    // emit 'error' on these streams. An 'error' event with no listener is rethrown as
    // an uncaught exception, and this process is a singleton that must outlive the
    // whole judging session: one dropped connection must not end it. There is nobody
    // left to answer by this point, so noting it is the only action available.
    req.on('error', (e) => console.warn(`relayer: request stream failed: ${e.message}`))
    res.on('error', (e) => console.warn(`relayer: response stream failed: ${e.message}`))

    handle(req, res, options).catch((e) => {
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
 * Loopback unless deliberately overridden.
 *
 * `||` rather than `??` on purpose: `??` falls back only on undefined, so a set-but-empty
 * RELAYER_HOST — a .env placeholder, a compose key with no value, an unset CI variable —
 * would reach `listen(port, '')`, which binds every interface. That is the exact opposite
 * of the default, produced by leaving something blank. Empty means unset here, matching
 * how required() already treats it.
 *
 * Exported because the default is a security control, and a control that lives only
 * inside main() is a control no test can reach.
 */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.RELAYER_HOST || '127.0.0.1'
}

/** What must be true before running off-loopback, or null when it is loopback. */
export function offHostWarning(host: string): string | null {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null
  return (
    `WARNING: bound to ${host}, not loopback. This signer is reachable off-host. ` +
    `Do not run this way without authentication and rate limiting in front of it: ` +
    `the allowlist bounds what may be signed, not by whom or how often, so an ` +
    `exposed port still lets anyone spend up to the approve ceiling per submission.`
  )
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
  const host = resolveHost()
  const allowedOrigins = new Set(
    (process.env.RELAYER_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  )

  const nodeUrl = await pickLiveRpcHost()
  const account = new Account({
    provider: new RpcProvider({ nodeUrl }),
    address,
    signer: privateKey,
  })

  const messageBook = deployedMessageBook()
  const server = createRelayerServer({
    submit: async (calls) => {
      const { transaction_hash } = await account.execute(calls)
      return transaction_hash
    },
    resolvePolicy: async () => ({
      messageBook,
      maxApproveWei: (await readPoolConstants()).feeWei * APPROVE_FEE_MULTIPLE,
    }),
    allowedOrigins,
  })

  server.listen(port, host, () => {
    console.log(`relayer listening on ${host}:${port}, submitting as ${address} via ${nodeUrl}`)
    console.log(`allowlist: pool ${NET.pool} · STRK approve-to-pool only`)
    console.log(messageBook ? `allowlist: MessageBook ${messageBook}` : 'allowlist: no MessageBook deployed yet')
    console.log(
      allowedOrigins.size
        ? `origins: ${[...allowedOrigins].join(', ')}`
        : 'origins: none — only callers that send no Origin header',
    )
    const warning = offHostWarning(host)
    if (warning) console.warn(warning)
  })
}

// Only when run directly. Importing this module (tests, tooling) must stay side-effect
// free, but launching it must still fail loudly on a missing secret before it listens.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
