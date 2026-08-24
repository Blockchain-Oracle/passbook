//
// FREE probe: does a LONE zero-deposit `[SetViewingKey]` compile on an UNREGISTERED
// address? (story 1.12)
//
// TRACKED, not scratch, because `ACTION_LIST_EVIDENCE` in message-book.ts cites its
// results as evidence — a table nobody can reproduce is an assertion, not evidence.
//
// `compile_actions` is a pool VIEW. This costs nothing, signs nothing and submits
// nothing; it is safe to run at any time and re-running it is how you check the table is
// still true. The evidence it closes: the table proved the lone SetViewingKey REJECTS on
// an already-registered address (`NON_ZERO_VALUE`) but never recorded the positive case
// the whole sponsored-registration path depends on.
//
//   npx tsx scripts/probes/registration-compile-actions.ts
//
import { RpcProvider } from 'starknet'
import { NET } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'

loadDotEnvVerbose()

// publicnode rather than the first configured host: lava answers a failed view with a
// bare "Contract error" and no data, so the revert string — the entire point of a
// rejection probe — is lost. Pinned here rather than in NET, which is for the app.
const RPC_WITH_REVERT_DATA = 'https://starknet-rpc.publicnode.com'
const p = new RpcProvider({ nodeUrl: RPC_WITH_REVERT_DATA })

const view = (entrypoint: string, calldata: string[]) =>
  p.callContract({ contractAddress: NET.pool, entrypoint, calldata })

/** Turns `{"revert_error":"0x4e4f...,0x454e..."}` back into readable pool assert strings. */
function revertString(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err)
  const felts = raw.match(/"revert_error":"([^"]+)"/)?.[1]
  if (!felts) return raw.replace(/\s+/g, ' ').slice(0, 200)
  try {
    return felts
      .split(',')
      .map((f) => {
        // `padStart` is load-bearing: an odd-length hex string silently loses its leading
        // nibble through Buffer.from(..., 'hex'), which mangles the assert name.
        const hex = BigInt(f.trim()).toString(16)
        return Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex').toString('utf8')
      })
      .join(' / ')
  } catch {
    // A token BigInt cannot parse means the revert payload is not the felt list this
    // assumes. Show the raw string rather than crashing the probe: the unrecognised
    // output IS the finding, and a decoder that throws hides it.
    return raw.replace(/\s+/g, ' ').slice(0, 300)
  }
}

const sender = process.env.DEPLOYER_ADDRESS
if (!sender) {
  console.error('DEPLOYER_ADDRESS is not set. This probe needs an address to compile against.')
  process.exit(1)
}

console.log('block        ', await p.getBlockNumber())
console.log('pool         ', NET.pool)
console.log('pool class   ', await p.getClassHashAt(NET.pool))

const [registered] = await view('get_public_key', [sender])
console.log(`sender       ${sender}\nget_public_key ${registered}`)
if (BigInt(registered!) !== 0n) {
  console.error('\nABORT: that address is already registered. This probe needs an unregistered one.')
  process.exit(1)
}

// A canonical viewing key and a non-zero random. Neither value matters to the compiler —
// the SHAPE of the action list is what is under test.
const VIEWING_KEY = '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80'
const RANDOM = '0x2a'

// Span<ClientAction> = [len, ...items]; SetViewingKey is variant 0 with one field.
const cases: [string, string[]][] = [
  ['[SetViewingKey] alone on an UNREGISTERED addr', ['0x1', '0x0', RANDOM]],
  ['[SetViewingKey, SetViewingKey] in one tx     ', ['0x2', '0x0', RANDOM, '0x0', '0x2b']],
]

for (const [label, span] of cases) {
  try {
    const out = await view('compile_actions', [sender, VIEWING_KEY, ...span])
    console.log(`\n${label}  OK  ${out[0]} server actions (${out.length} felts)`)
  } catch (e) {
    console.log(`\n${label}  ERR ${revertString(e)}`)
  }
}

console.log('\nThese two rows are recorded in ACTION_LIST_EVIDENCE (message-book.ts).')
