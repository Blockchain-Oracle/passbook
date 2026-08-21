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
import { createServer, type IncomingMessage } from 'node:http'
import { Account, RpcProvider, type Call } from 'starknet'
import { NET } from '../../protocol/src/constants.js'

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

const RELAYER_ADDRESS = required('RELAYER_ADDRESS')
const RELAYER_PRIVATE_KEY = required('RELAYER_PRIVATE_KEY')
const PORT = Number(process.env.PORT ?? 8787)

// R10 names `POST /submit`; the browser posts to the same-origin `/api/submit`, which
// a dev-server proxy or edge rule normally rewrites. Accepting both means the two
// halves connect whether or not that rewrite is in place.
const SUBMIT_PATHS = new Set(['/submit', '/api/submit'])

const JSON_HEADERS = { 'content-type': 'application/json' }

// A submission is a handful of calls. Anything larger is not one, so stop reading
// rather than buffering an unbounded body into memory.
const MAX_BODY_BYTES = 1_000_000

const account = new Account({
  provider: new RpcProvider({ nodeUrl: NET.rpc[0] }),
  address: RELAYER_ADDRESS,
  signer: RELAYER_PRIVATE_KEY,
})

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

const server = createServer((req, res) => {
  void (async () => {
    if (req.method !== 'POST' || !SUBMIT_PATHS.has(req.url ?? '')) {
      res.writeHead(404, JSON_HEADERS).end(JSON.stringify({ error: 'not found' }))
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
      res.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: String(e) }))
      return
    }

    try {
      // Our address is the one the public record will show against this transaction.
      // That is the entire service being offered; see paymaster.ts.
      const { transaction_hash } = await account.execute(calls)
      res.writeHead(200, JSON_HEADERS).end(JSON.stringify({ transactionHash: transaction_hash }))
    } catch (e) {
      res.writeHead(502, JSON_HEADERS).end(JSON.stringify({ error: String(e) }))
    }
  })()
})

server.listen(PORT, () => {
  console.log(`relayer listening on :${PORT}, submitting as ${RELAYER_ADDRESS}`)
})
