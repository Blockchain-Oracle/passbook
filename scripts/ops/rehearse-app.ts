//
// FREE `compile_actions` rehearsal for the Markets and Launch action shapes.
//
//   npx tsx scripts/ops/rehearse-app.ts
//
// View-only. No transaction, no key of any value, nothing spent — the pool's client compiler is a
// public view, so the real deployed contract can be asked whether it accepts a list before a single
// STRK is committed to finding out. This is the gate before ANY funded app-contract transaction.
//
// ── WHY IT DRIVES THE REAL BUILDERS ───────────────────────────────────────────────────────
//
// `rehearse.mjs` hand-writes its action lists, which is right for probing what the POOL accepts.
// This one exists to probe what WE emit, so it goes through `planSend` and the real calldata
// builders and validates whatever they actually produce. A rehearsal of a hand-written shape that
// resembles ours proves nothing about the shape we will send.
//
// ── AND THE ONE THING IT CANNOT CHECK ─────────────────────────────────────────────────────
//
// `compile_actions` CANNOT catch an unmatched open note. Day-0 verification found it no-ops the
// `EmitOpenNoteCreated` step, so three open notes with no matching deposits compiled cleanly here
// and would still have reverted on chain at `UNDEPOSITED_OPEN_NOTES` — after the six-STRK fee.
// That invariant lives in the client (`expectedOpenNotes`, and the count check inside `proveSend`),
// and this script re-asserts it locally rather than pretending the pool did it.
//
import { ec, hash, RpcProvider, shortString } from 'starknet'
import { NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { planSend, type AppInvokeLeg, type SendWalletData } from '../../packages/protocol/src/send.js'
import {
  MARKET_OP,
  SIDE_UP,
  betPayload,
  claimPayload,
  expectedOpenNotes as marketOpenNotes,
} from '../../packages/protocol/src/market-calldata.js'
import {
  LAUNCH_OP,
  buyPayload,
  redeemPayload,
  expectedOpenNotes as launchOpenNotes,
} from '../../packages/protocol/src/launch-calldata.js'
import { CLIENT_ACTION } from '../../packages/protocol/src/message-book.js'
import { parseAppContracts } from '../../packages/protocol/src/app-contracts.js'
import { readFileSync } from 'node:fs'

const f = (v: bigint | number | string) => `0x${BigInt(v).toString(16)}`

// ── Throwaway identity. Random, canonical, never funded, never reused. ───────────────────
const HALF_ORDER = 0x0400000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn / 2n
function randFelt(bits = 200): bigint {
  let x = 0n
  for (const b of crypto.getRandomValues(new Uint8Array(bits / 8))) x = (x << 8n) | BigInt(b)
  return x
}
let PRIV = randFelt(200)
while (PRIV === 0n || PRIV >= HALF_ORDER) PRIV = randFelt(200)
const PUB = BigInt(ec.starkCurve.getStarkKey(f(PRIV)))
const SELF = f(randFelt(240))

const CHANNEL_KEY_TAG = BigInt(shortString.encodeShortString('CHANNEL_KEY_TAG:V1'))
const channelKey = (recipient: string, pub: bigint) =>
  BigInt(
    hash.computePoseidonHashOnElements(
      [CHANNEL_KEY_TAG, BigInt(SELF), PRIV, BigInt(recipient), pub].map(f),
    ),
  )

/** Addresses from the deployment when it exists; throwaways when it does not. */
let deployed = parseAppContracts(null)
try {
  deployed = parseAppContracts(readFileSync('evidence/markets-launch-deployment.json', 'utf8'))
} catch {
  /* not deployed yet — the shapes are what is being rehearsed, not the addresses */
}
const MARKETS = deployed.markets ?? f(randFelt(240))
const LAUNCH = deployed.launch ?? f(randFelt(240))
const LAUNCH_TOKEN = f(randFelt(240))

const FEE_WEI = 6_000_000_000_000_000_000n
const R = () => randFelt(120) | 1n
const SALT = () => randFelt(120) | 3n

// ── The wallet the plans are built against ───────────────────────────────────────────────
const SELF_CHANNEL_KEY = channelKey(SELF, PUB)
// NO channel key and no subchannels: a throwaway address has neither on chain, so the plan opens
// both — which is also the ordinary first-ever transaction for a real wallet.
const wallet: SendWalletData = {
  channels: [{ address: SELF, publicKey: PUB }],
  notes: [
    { id: 1n, token: STRK_TOKEN, amount: 100n * FEE_WEI, witness: { channelKey: SELF_CHANNEL_KEY, nonce: 0, r: R() } },
  ],
}

/**
 * Turn a plan's `expectedActions` into a concrete action list the pool's compiler will accept.
 *
 * The plan leaves the compiler's own fields blank — randoms, salts, note indices. Those are filled
 * with throwaway values here, because `compile_actions` needs concrete felts; every field the plan
 * DID pin is passed through untouched, which is what makes this a rehearsal of our shape rather
 * than of a shape that merely looks like it.
 */
function concrete(plan: { expectedActions: readonly { variant: number; fields: (bigint | null)[] }[] }) {
  // Every list needs a `WriteOnce`-producing action, and a throwaway has never set a viewing key —
  // so this is both required and free. `SetViewingKey` is single-use per address on chain, which is
  // exactly why the identity above is minted fresh on every run.
  const out: Record<string, unknown>[] = [{ type: 'SetViewingKey', random: R() }]

  // Note indices must be SEQUENTIAL per channel-and-token: the pool reverts `INDEX_NOT_SEQUENTIAL`
  // on a gap and `NON_ZERO_VALUE` on a repeat. Both note kinds share one counter per token because
  // they share one subchannel.
  const nextIndex = new Map<string, bigint>()
  // The SUBCHANNEL index is a different counter entirely: it is the token's position within the
  // channel, not a note's position within the subchannel. A redemption opens two — STRK for the
  // fee and the payout token — and giving both index 0 is the `NON_ZERO_VALUE` revert.
  let nextTokenIndex = 0n
  const takeIndex = (token: bigint) => {
    const key = token.toString()
    const i = nextIndex.get(key) ?? 0n
    nextIndex.set(key, i + 1n)
    return i
  }

  for (const action of plan.expectedActions) {
    const at = (i: number, fallback: bigint) => action.fields[i] ?? fallback
    switch (action.variant) {
      case CLIENT_ACTION.OpenChannel:
        out.push({ type: 'OpenChannel', recipientAddr: at(0, 0n), index: at(1, 0n), random: R(), salt: SALT() })
        break
      case CLIENT_ACTION.OpenSubchannel:
        out.push({
          type: 'OpenSubchannel',
          recipientAddr: at(0, 0n),
          recipientPublicKey: at(1, PUB),
          channelKey: at(2, SELF_CHANNEL_KEY),
          index: at(3, nextTokenIndex++),
          token: at(4, 0n),
          salt: SALT(),
        })
        break
      case CLIENT_ACTION.UseNote:
        // A DEPOSIT STANDS IN FOR THE SPEND. `UseNote` reads real pool storage and a throwaway owns
        // no notes, so the literal leg is untestable from here — the same limitation the existing
        // ACTION_LIST_EVIDENCE records. A `Deposit` of the same token and amount exercises
        // identical balance rules, which is what this rehearsal is checking.
        out.push({ type: 'Deposit', token: at(1, 0n), amount: 100n * FEE_WEI })
        break
      case CLIENT_ACTION.CreateEncNote:
        out.push({
          type: 'CreateEncNote',
          recipientAddr: at(0, 0n),
          recipientPublicKey: at(1, PUB),
          token: at(2, 0n),
          amount: at(3, 0n),
          index: takeIndex(at(2, 0n)),
          salt: SALT(),
        })
        break
      case CLIENT_ACTION.CreateOpenNote:
        out.push({
          type: 'CreateOpenNote',
          recipientAddr: at(0, 0n),
          recipientPublicKey: at(1, PUB),
          token: at(2, 0n),
          index: takeIndex(at(2, 0n)),
          random: SALT(),
        })
        break
      case CLIENT_ACTION.Withdraw:
        out.push({ type: 'Withdraw', toAddr: at(0, 0n), token: at(1, 0n), amount: at(2, 0n), random: R() })
        break
      case CLIENT_ACTION.InvokeExternal: {
        const calldata = action.fields.slice(2).map((v, i) => v ?? BigInt(0x900 + i))
        out.push({ type: 'InvokeExternal', contractAddress: at(0, 0n), calldata })
        break
      }
      default:
        throw new Error(`no rehearsal encoding for variant ${action.variant}`)
    }
  }
  return out
}

function encode(actions: Record<string, unknown>[]): string[] {
  const out = [f(actions.length)]
  for (const a of actions) {
    const k = CLIENT_ACTION[a.type as keyof typeof CLIENT_ACTION]
    const g = (key: string) => f(a[key] as bigint)
    if (a.type === 'SetViewingKey') out.push(f(k), g('random'))
    else if (a.type === 'OpenChannel') out.push(f(k), g('recipientAddr'), g('index'), g('random'), g('salt'))
    else if (a.type === 'Deposit') out.push(f(k), g('token'), g('amount'))
    else if (a.type === 'OpenSubchannel')
      out.push(f(k), g('recipientAddr'), g('recipientPublicKey'), g('channelKey'), g('index'), g('token'), g('salt'))
    else if (a.type === 'CreateEncNote')
      out.push(f(k), g('recipientAddr'), g('recipientPublicKey'), g('token'), g('amount'), g('index'), g('salt'))
    else if (a.type === 'CreateOpenNote')
      out.push(f(k), g('recipientAddr'), g('recipientPublicKey'), g('token'), g('index'), g('random'))
    else if (a.type === 'UseNote') out.push(f(k), g('channelKey'), g('token'), g('index'))
    else if (a.type === 'Withdraw') out.push(f(k), g('toAddr'), g('token'), g('amount'), g('random'))
    else if (a.type === 'InvokeExternal') {
      const calldata = a.calldata as bigint[]
      out.push(f(k), g('contractAddress'), f(calldata.length), ...calldata.map(f))
    } else throw new Error(`unencodable ${String(a.type)}`)
  }
  return out
}

let provider: RpcProvider
async function pickRpc() {
  for (const nodeUrl of NET.rpc) {
    try {
      const p = new RpcProvider({ nodeUrl })
      await p.getBlockLatestAccepted()
      console.log(`RPC: ${nodeUrl}`)
      return p
    } catch {
      /* next */
    }
  }
  throw new Error('no RPC reachable')
}

const revertName = (e: unknown) => {
  const blob = JSON.stringify((e as { baseError?: unknown })?.baseError ?? String(e))
  const named = blob.match(/[A-Z][A-Z0-9_]{6,}/g)
  const drop = new Set(['CONTRACT_NOT_FOUND', 'ENTRYPOINT_NOT_FOUND', 'TRANSACTION_EXECUTION_ERROR', 'CONTRACT_ERROR', 'EXECUTION_ERROR'])
  const hits = named ? [...new Set(named)].filter((s) => !drop.has(s)) : []
  return hits.length ? hits.join(',') : blob.slice(0, 220)
}

const results: { label: string; ok: boolean; detail: string }[] = []

async function probe(label: string, request: Record<string, unknown>, expectOpenNotes: number) {
  const out = planSend(request as never, wallet, SELF, { recipient: f(randFelt(240)), feeWei: FEE_WEI })
  if (!out.ok) {
    results.push({ label, ok: false, detail: `planner refused: ${JSON.stringify(out.failure)}` })
    return
  }

  // THE CHECK THE POOL CANNOT DO FOR US, asserted locally before the free view is even called.
  const planned = out.plan.expectedActions.filter((a) => a.variant === CLIENT_ACTION.CreateOpenNote).length
  if (planned !== expectOpenNotes) {
    results.push({
      label,
      ok: false,
      detail: `plans ${planned} open notes and the op deposits into ${expectOpenNotes} — this is the ` +
        'mismatch compile_actions cannot see and the pool reverts on after taking the fee',
    })
    return
  }

  const calldata = [f(SELF), f(PRIV), ...encode(concrete(out.plan))]
  try {
    const res = await provider.callContract({ contractAddress: NET.pool, entrypoint: 'compile_actions', calldata })
    results.push({
      label,
      ok: true,
      detail: `${Number(BigInt(res[0]!))} server actions, ${planned} open note(s), ${out.plan.expectedActions.length} client actions`,
    })
  } catch (e) {
    results.push({ label, ok: false, detail: revertName(e) })
  }
}

provider = await pickRpc()
console.log(`pool: ${NET.pool}`)
console.log(`markets: ${MARKETS}${deployed.markets ? '' : '  (throwaway — not deployed yet)'}`)
console.log(`launch:  ${LAUNCH}${deployed.launch ? '' : '  (throwaway — not deployed yet)'}\n`)

const leg = (over: Partial<AppInvokeLeg> & { contract: string; op: number; calldata: readonly string[]; noteIdSlots: readonly number[] }): AppInvokeLeg => ({
  openNoteCount: over.noteIdSlots.length,
  ...over,
})

// ── The four shapes that carry real money ────────────────────────────────────────────────

const ladder = betPayload([
  { marketId: 0, side: SIDE_UP, amount: 20n * FEE_WEI, commitment: f(randFelt(240)) },
  { marketId: 1, side: SIDE_UP, amount: 20n * FEE_WEI, commitment: f(randFelt(240)) },
  { marketId: 2, side: SIDE_UP, amount: 20n * FEE_WEI, commitment: f(randFelt(240)) },
])
if (ladder.state !== 'ready') throw new Error(ladder.because)
await probe(
  'ladder bet — 3 rungs, one transaction, one fee',
  {
    kind: 'market-bet',
    recipient: MARKETS,
    token: STRK_TOKEN,
    symbol: 'STRK',
    amount: 60n * FEE_WEI,
    mode: 'relayer',
    app: leg({ contract: MARKETS, op: MARKET_OP.bet, calldata: ladder.calldata, noteIdSlots: ladder.noteIdSlots }),
  },
  marketOpenNotes(MARKET_OP.bet, 3),
)

const settle = claimPayload([f(randFelt(240)), f(randFelt(240)), f(randFelt(240))])
if (settle.state !== 'ready') throw new Error(settle.because)
await probe(
  'batch claim — 3 payouts into 3 open notes',
  {
    kind: 'market-claim',
    recipient: MARKETS,
    token: STRK_TOKEN,
    symbol: 'STRK',
    amount: 0n,
    mode: 'relayer',
    app: leg({
      contract: MARKETS,
      op: MARKET_OP.claim,
      calldata: settle.calldata,
      noteIdSlots: settle.noteIdSlots,
      payoutToken: STRK_TOKEN,
    }),
  },
  marketOpenNotes(MARKET_OP.claim, 3),
)

const buy = buyPayload([{ launchId: 0, units: 4, commitment: f(randFelt(240)) }])
if (buy.state !== 'ready') throw new Error(buy.because)
await probe(
  'hidden launch buy — stake in, buyer never named',
  {
    kind: 'launch-buy',
    recipient: LAUNCH,
    token: STRK_TOKEN,
    symbol: 'STRK',
    amount: 10n * FEE_WEI,
    mode: 'relayer',
    app: leg({ contract: LAUNCH, op: LAUNCH_OP.buy, calldata: buy.calldata, noteIdSlots: buy.noteIdSlots }),
  },
  launchOpenNotes(LAUNCH_OP.buy, 1),
)

// The graduation case: a payout in a token that did not exist when the launch opened. Legal
// because the pool has no token allowlist in its deposit path — proven live on Day 0 against a
// phantom token — provided the transaction opens a subchannel for it, which the plan does.
const redeem = redeemPayload([f(randFelt(240)), f(randFelt(240))])
if (redeem.state !== 'ready') throw new Error(redeem.because)
await probe(
  'launch redeem — 2 payouts in a token deployed after the buy',
  {
    kind: 'launch-redeem',
    recipient: LAUNCH,
    token: LAUNCH_TOKEN,
    symbol: 'LAUNCH',
    amount: 0n,
    mode: 'relayer',
    app: leg({
      contract: LAUNCH,
      op: LAUNCH_OP.redeem,
      calldata: redeem.calldata,
      noteIdSlots: redeem.noteIdSlots,
      payoutToken: LAUNCH_TOKEN,
    }),
  },
  launchOpenNotes(LAUNCH_OP.redeem, 2),
)

console.log('')
for (const r of results) console.log(`  ${r.ok ? 'OK ' : 'ERR'}  ${r.label}\n        ${r.detail}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} shapes accepted by the live pool compiler.`)
if (failed.length) {
  console.log('A rejected shape here is a shape that would burn the fee on chain. Do not fund it.')
  process.exit(1)
}
