//
// FREE probe: what does the deployed pool make of a SEND-shaped action list? (story 1.16)
//
// TRACKED, not scratch, because `ACTION_LIST_EVIDENCE` in message-book.ts cites its results
// as evidence — a table nobody can reproduce is an assertion, not evidence.
//
// `compile_actions` is a pool VIEW. This costs nothing, signs nothing and submits nothing. The
// only key it needs is a THROWAWAY viewing key, and it is a literal in this file rather than a
// secret: it is used as a compiler input, never to sign, and the address it is compiled against
// is read from the environment purely so the probe runs against an address the operator owns.
//
//   npx tsx scripts/probes/send-compile-actions.ts
//
// WHAT THIS CAN AND CANNOT ESTABLISH. `compile_actions` resolves real pool state, so a `UseNote`
// against a note the sender does not hold stops at NOTE_NOT_FOUND and a subchannel that does not
// exist stops at SUBCHANNEL_NOT_FOUND — the probe cannot conjure a funded, registered sender.
// What it CAN do is put the pool's own compiler in front of every send-shaped list whose value
// can be sourced from a `Deposit` in the same transaction, which is enough to settle the
// structural questions story 1.16 depends on:
//
//   1. Does the double-`Withdraw` fee fold compile — a user leg and a relayer reimbursement leg
//      to two different addresses in one proven chain?
//   2. Does a list with no invoke still need replay protection?
//   3. What does the pool call an unbalanced list, an overspend, and a zero-amount note?
//   4. Must a new channel's index equal the sender's live channel count?
//
import { RpcProvider, ec, shortString } from 'starknet'
import { NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'
import { CLIENT_ACTION } from '../../packages/protocol/src/message-book.js'

loadDotEnvVerbose()

// publicnode rather than the first configured host: lava answers a failed view with a bare
// "Contract error" and no data, so the revert string — the entire point of a rejection probe —
// is lost. Pinned here rather than in NET, which is for the app.
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
    return raw.replace(/\s+/g, ' ').slice(0, 300)
  }
}

const sender = process.env.DEPLOYER_ADDRESS
const other = process.env.RELAYER_ADDRESS
if (!sender || !other) {
  console.error('DEPLOYER_ADDRESS and RELAYER_ADDRESS must both be set: the fee-leg rows need two addresses.')
  process.exit(1)
}

console.log('block        ', await p.getBlockNumber())
console.log('pool         ', NET.pool)

// THE CLASS HASH IS A GATE, NOT A PRINTOUT. Every row this banks is a claim about the DEPLOYED
// class, and the pool is upgradeable at zero delay — so a run against a class we are not pinned
// to would quietly file evidence about a contract nobody is running. Refuse instead.
const onchainClass = await p.getClassHashAt(NET.pool)
console.log('pool class   ', onchainClass)
if (BigInt(onchainClass) !== BigInt(NET.poolClassHash)) {
  console.error(`\nABORT: the pool's class hash is ${onchainClass}, and this build is pinned to`)
  console.error(`${NET.poolClassHash}. The pool has been upgraded; every row in`)
  console.error('ACTION_LIST_EVIDENCE describes a contract that is no longer running. Re-pin first.')
  process.exit(1)
}

const [registered] = await view('get_public_key', [sender])
const [channels] = await view('get_num_of_channels', [sender])
console.log(`sender       ${sender}\nget_public_key ${registered} · get_num_of_channels ${channels}`)
if (BigInt(registered!) !== 0n) {
  console.error('\nABORT: that address is already registered. Every row below opens the write-once')
  console.error('SetViewingKey slot in-transaction, which needs an unregistered address.')
  process.exit(1)
}

// The RECIPIENT_NOT_REGISTERED row is only evidence if the recipient really is unregistered. If
// this address ever gets a key the row would quietly start proving nothing while still printing
// a line — so the precondition is checked rather than assumed.
const [otherRegistered] = await view('get_public_key', [other])
console.log(`recipient    ${other}\nget_public_key ${otherRegistered}`)
if (BigInt(otherRegistered!) !== 0n) {
  console.error('\nABORT: the recipient address now HAS a key, so the RECIPIENT_NOT_REGISTERED row')
  console.error('below would no longer be testing what it claims. Point RELAYER_ADDRESS at an')
  console.error('unregistered address, or drop that row.')
  process.exit(1)
}

// A THROWAWAY viewing key. Nothing signs with it and nothing is submitted; the pool derives a
// public key and a channel key from it so the probe can name them where the client would.
const VIEWING_KEY = 0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80n

const hex = (v: bigint) => `0x${v.toString(16)}`
const evenHex = (v: bigint) => {
  const h = v.toString(16)
  return `0x${h.padStart(h.length + (h.length % 2), '0')}`
}
const poseidon = (...v: bigint[]) => ec.starkCurve.poseidonHashMany(v)
/** A Cairo domain-separation tag is a short string literal; the pool hashes it as a felt. */
const tag = (t: string) => BigInt(shortString.encodeShortString(t))

// The two values the pool would compute for itself. Reproduced from hashes.cairo rather than
// imported: the SDK keeps them under `dist/internal`, which is not subpath-exported, and a
// probe that reaches into an unexported path breaks on the next SDK release.
const PUBLIC_KEY = BigInt(ec.starkCurve.getStarkKey(evenHex(VIEWING_KEY)))
const CHANNEL_KEY = poseidon(
  tag('CHANNEL_KEY_TAG:V1'),
  BigInt(sender),
  VIEWING_KEY,
  BigInt(sender),   // a self-addressed channel: the one recipient we know is registered in-tx
  PUBLIC_KEY,
)

const RANDOM = '0x2a'
const SALT = '0x2b'
const T = STRK_TOKEN

const v = (name: keyof typeof CLIENT_ACTION) => `0x${CLIENT_ACTION[name].toString(16)}`

// Every builder below writes the variant's ABI fields in ABI order. A field dropped here is not
// a wrong answer, it is a "Failed to deserialize param" that looks like a pool rule.
const setViewingKey = () => [v('SetViewingKey'), RANDOM]
const openChannel = (index: string, to = sender) => [v('OpenChannel'), to, index, RANDOM, SALT]
const openSubchannel = (index: string) =>
  [v('OpenSubchannel'), sender, hex(PUBLIC_KEY), hex(CHANNEL_KEY), index, T, SALT]
const createEncNote = (amount: string, index = '0x0') =>
  [v('CreateEncNote'), sender, hex(PUBLIC_KEY), T, amount, index, SALT]
const deposit = (amount: string) => [v('Deposit'), T, amount]
const useNote = (index = '0x0') => [v('UseNote'), hex(CHANNEL_KEY), T, index]
const withdraw = (amount: string, to = sender) => [v('Withdraw'), to, T, amount, RANDOM]

// EVERY LABEL HERE IS THE LABEL IN `ACTION_LIST_EVIDENCE`, character for character. The table
// cites this script as the way to reproduce it, and a row whose wording has drifted from the case
// that produced it cannot be matched back to a run — which is how a stale row survives a re-run
// nobody notices it failed.
const cases: [string, string[][]][] = [
  // --- the shape the send pipeline actually builds ------------------------------------------
  [
    '[SVK, OpenChannel(0), OpenSubchannel(0), Deposit(3), CreateEncNote(3)]',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), deposit('0x3'), createEncNote('0x3')],
  ],
  // --- the fee fold: two Withdraw legs to two different addresses ---------------------------
  [
    '… Deposit(3), CreateEncNote(1), Withdraw(1→self), Withdraw(1→relayer)',
    [
      setViewingKey(), openChannel('0x0'), openSubchannel('0x0'),
      deposit('0x3'), createEncNote('0x1'), withdraw('0x1'), withdraw('0x1', other),
    ],
  ],
  [
    '… Deposit(3), CreateEncNote(1), Withdraw(2→relayer)',
    [
      setViewingKey(), openChannel('0x0'), openSubchannel('0x0'),
      deposit('0x3'), createEncNote('0x1'), withdraw('0x2', other),
    ],
  ],
  // --- balance rules ------------------------------------------------------------------------
  [
    '… Deposit(3), CreateEncNote(1) — outputs short of inputs',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), deposit('0x3'), createEncNote('0x1')],
  ],
  [
    '… Deposit(1), CreateEncNote(2) — overspend',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), deposit('0x1'), createEncNote('0x2')],
  ],
  [
    '… Deposit(3), CreateEncNote(0) — zero-amount note',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), deposit('0x3'), createEncNote('0x0')],
  ],
  // --- replay protection on a list with no invoke in it -------------------------------------
  [
    '[Deposit(1), Withdraw(1)] — balanced, NO invoke, no write-once action',
    [deposit('0x1'), withdraw('0x1')],
  ],
  [
    '[SVK, OpenChannel(0), Deposit(1), Withdraw(1)] — companion added',
    [setViewingKey(), openChannel('0x0'), deposit('0x1'), withdraw('0x1')],
  ],
  // --- the questions the send pre-flight is built on -----------------------------------------
  [
    '[SVK, OpenChannel(1)] — a first channel at a non-zero index',
    [setViewingKey(), openChannel('0x1')],
  ],
  [
    '[SVK, OpenChannel(0 → an UNREGISTERED recipient)]',
    [setViewingKey(), openChannel('0x0', other)],
  ],
  [
    '… OpenSubchannel(0), UseNote — a note this sender does not hold',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), useNote(), createEncNote('0x1')],
  ],
  [
    '… OpenSubchannel(0), OpenSubchannel(1) — same token twice in one tx',
    [setViewingKey(), openChannel('0x0'), openSubchannel('0x0'), openSubchannel('0x1')],
  ],
  [
    '[OpenChannel(0), …] with no SetViewingKey on an unregistered sender',
    [openChannel('0x0'), openSubchannel('0x0'), useNote(), createEncNote('0x1')],
  ],
]

for (const [label, items] of cases) {
  const span = [`0x${items.length.toString(16)}`, ...items.flat()]
  try {
    const out = await view('compile_actions', [sender, hex(VIEWING_KEY), ...span])
    console.log(`\n${label}\n  OK  ${out[0]} server actions (${out.length} felts)`)
  } catch (e) {
    console.log(`\n${label}\n  ERR ${revertString(e)}`)
  }
}

console.log('\nThese rows are recorded in ACTION_LIST_EVIDENCE (message-book.ts), send group.')
