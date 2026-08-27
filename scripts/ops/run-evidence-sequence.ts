//
// The evidence sequence, one step per run.
//
//   npx tsx scripts/ops/run-evidence-sequence.ts <step>             # dry run
//   npx tsx scripts/ops/run-evidence-sequence.ts <step> --execute   # SPENDS
//
//   steps:  fund          deposit STRK into a note (the shape the probe proved)
//           market        create the 15-minute experimental market, spending a note
//           bet           the ladder — 3 bets, one transaction, one fee   [EVIDENCE #1]
//           claim         the batch settlement, losers filtered out       [EVIDENCE #2]
//           launch        create a launch (a DIRECT call — no pool, no fee)
//           buy           the hidden buy, submitted by the relayer        [EVIDENCE #3]
//
// ── WHY ONE SCRIPT AND NOT THREE ──────────────────────────────────────────────────────────
//
// Every step after `fund` is the same shape: spend a note, send the change back, hand value to one
// of our contracts, invoke it. Writing that three times would be three chances to get the balance
// arithmetic or the bounds wrong. The steps differ only in what they withdraw and what they invoke.
//
// ── WHAT WAS LEARNED THE EXPENSIVE WAY, ENCODED HERE ──────────────────────────────────────
//
// · `deposit({ amount })` with NO recipient declares an OPEN note — a slot a later deposit fills.
//   Tx A used it as though it were a balance inflow, minted an unmatched open note, and reverted
//   after the fee. `compile_actions` cannot see that (it no-ops the emission), which is why both
//   the compiler and the prover accepted it. Only `deposit({ recipient, amount })` is used below.
// · The fee estimate cannot see the proof, so `resourceBounds` MUST be supplied or the transaction
//   dies before signing. Sized from the 88,071,920 the successful probe actually consumed.
// · THE STEP FILES BELOW WRITE POSITION SECRETS, AND A POSITION SECRET IS THE MONEY. The contracts
//   pay whoever presents the preimage of the commitment and check no address, so a secret that is
//   still claimable must not stay in `evidence/` once this repository is public — move it to
//   `.secrets/` (gitignored) and leave a pointer, which is what the launch buy and creator entries
//   already do. A SPENT secret is inert and stays in full, because a reader who hashes it watches
//   the commitment fall out.
// · `--relayed` posts to the local relayer instead of signing here. That was IMPOSSIBLE until the
//   wire learned to carry `resourceBounds`: without them the relayer's own estimate simulated the
//   transaction unproven and every value-moving submission died before it was ever sent.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Account, CallData, RpcProvider, byteArray, cairo, constants } from 'starknet'
import { IndexerDiscoveryProvider, Open, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk'

import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'
import { deriveViewingKey } from '../../packages/protocol/src/identity.js'
import { readPoolConstants } from '../../packages/protocol/src/pool.js'
import { extractClientActionSpan, formatStrk, PROVING_BLOCK_LAG, proofBlobFrom } from '../../packages/protocol/src/register.js'
import { approveCeiling } from '../../packages/protocol/src/fee-ceiling.js'
import { parseAppContracts } from '../../packages/protocol/src/app-contracts.js'
import { mintPositionSecret } from '../../packages/protocol/src/commitment.js'
import {
  MARKET_OP,
  SIDE_DOWN,
  SIDE_UP,
  betPayload,
  claimPayload,
  createPayload,
  expectedOpenNotes,
} from '../../packages/protocol/src/market-calldata.js'
import { buyPayload } from '../../packages/protocol/src/launch-calldata.js'
import { withFallback } from '../../packages/protocol/src/rpc.js'

loadDotEnvVerbose()

const RELAYER_URL = process.env.LOCAL_RELAYER_URL ?? 'http://127.0.0.1:8791'

const step = process.argv[2]
const execute = process.argv.includes('--execute')
if (!step || !['fund', 'market', 'bet', 'launch', 'buy', 'claim'].includes(step)) {
  console.error('usage: run-evidence-sequence.ts <fund|market|bet|launch|buy|claim> [--execute]')
  process.exit(1)
}

const { DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, MARKETS_DEMO_ACCOUNT_KEY: accountKey } = process.env
if (!DEPLOYER_ADDRESS || !DEPLOYER_PRIVATE_KEY || !accountKey) {
  console.error('DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY and MARKETS_DEMO_ACCOUNT_KEY must all be set')
  process.exit(1)
}
if (ACTIVE_NETWORK !== 'mainnet') {
  console.error(`ACTIVE_NETWORK is ${ACTIVE_NETWORK}`)
  process.exit(1)
}

const deployed = parseAppContracts(
  existsSync('evidence/markets-launch-deployment.json')
    ? readFileSync('evidence/markets-launch-deployment.json', 'utf8')
    : null,
)
const MARKETS = deployed.markets!
const PAIR_BTC_USD = '0x4254432f555344'

// ── Numbers. Small, and bounded by the relayer's approve ceiling for the funding leg. ────
const FUND_WEI = 5n * 10n ** 18n
const SEED_WEI = 2n * 10n ** 18n
const BET_WEI = 300_000_000_000_000_000n // 0.3 STRK per rung
//
// NOMINAL 20 MINUTES, AND THE EXTRA FIVE ARE NOT PADDING.
//
// `Markets::op_create` asserts `deadline - block_timestamp >= 900`. This script computes the
// deadline from its LOCAL clock, but proving plus inclusion takes two to three minutes — so a
// nominal 15-minute window arrives already under the floor and the contract panics
// 'WINDOW_TOO_SHORT'. That is what reverted tx A and the first market create, twice, at ~2.5 STRK
// each. Twenty nominal leaves ~17 on arrival: still the experimental tier (under the 3600-second
// standard minimum), still a genuinely short market, and no longer racing my own honesty rule.
//
const WINDOW_SECONDS = 20 * 60

/** Sized from the 88,071,920 l2 the successful probe consumed. Ceiling ≈ 7.4 STRK. */
const BOUNDS = {
  l2_gas: { max_amount: 150_000_000n, max_price_per_unit: 50_000_000_000n },
  l1_gas: { max_amount: 10_000n, max_price_per_unit: 200_000_000_000_000n },
  l1_data_gas: { max_amount: 50_000n, max_price_per_unit: 300_000_000_000n },
}

// ── The launch. One epoch of 16 units, priced per UNIT in stake base units. ──────────────
const LAUNCH_UNITS_PER_EPOCH = 16
const LAUNCH_EPOCHS = 1
/** Tokens per epoch. Divisible by 16, so a unit is exactly 100 tokens. */
const LAUNCH_TRANCHE = 1600n
/** 0.05 STRK per unit → a full 16-unit sale raises 0.8 STRK. Demo capital, real mechanics. */
const LAUNCH_P0 = 50_000_000_000_000_000n
const LAUNCH_DP = 0n
const BUY_UNITS = 4

const pool = await readPoolConstants()
if (pool.paused) {
  console.error('the pool is paused')
  process.exit(1)
}

const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
const account = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_PRIVATE_KEY })
const self = String(account.address)
const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)

// Real discovery now — the account owns notes and every step after `fund` spends one.
const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })

const transfers = createPrivateTransfers({
  account,
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: { url: NET.prover, chainId: NET.chainId as constants.StarknetChainId, ohttp: true },
  discoveryProvider: discovery,
  poolContractAddress: NET.pool,
})

/** Reads the account's spendable STRK, so a step refuses before proving rather than after. */
async function shieldedStrk(): Promise<bigint> {
  const { notes } = await discovery.discoverNotes(BigInt(self) as never, viewingKey as never, {})
  const mine = (notes.get(BigInt(STRK_TOKEN) as never) ?? []) as { amount: bigint }[]
  return mine.reduce((sum, n) => sum + n.amount, 0n)
}

const held = await shieldedStrk()
console.log(`\nSTEP ${step.toUpperCase()}  ${execute ? '(EXECUTING)' : '(DRY RUN)'}`)
console.log(`  shielded STRK: ${formatStrk(held)}`)

// ── Build the step ───────────────────────────────────────────────────────────────────────
let describe = ''
let outputFile = ''
let extra: Record<string, unknown> = {}
let build: (b: ReturnType<typeof transfers.build>) => unknown

if (step === 'fund') {
  const approveWei = FUND_WEI + pool.feeWei
  if (approveWei > approveCeiling(pool.feeWei)) {
    console.error(`approve ${formatStrk(approveWei)} exceeds the ceiling`)
    process.exit(1)
  }
  describe = `deposit ${formatStrk(FUND_WEI)} into a note`
  outputFile = 'evidence/seq-fund.json'
  // The PROVEN shape: a recipient makes it a real note rather than an open slot.
  build = (b) => b.with(STRK_TOKEN, (t) => t.deposit({ recipient: self, amount: FUND_WEI }))
} else if (step === 'market') {
  if (held < SEED_WEI) {
    console.error(`need ${formatStrk(SEED_WEI)} shielded, hold ${formatStrk(held)} — run \`fund\` first`)
    process.exit(1)
  }
  const now = Math.floor(Date.now() / 1000)
  const deadline = now + WINDOW_SECONDS
  const r = await withFallback((p) =>
    p.callContract({ contractAddress: deployed.pragma!, entrypoint: 'get_data_median', calldata: ['0x0', PAIR_BTC_USD] }),
  )
  const strike = BigInt(r[0] ?? '0x0')
  const seeder = mintPositionSecret()
  const payload = createPayload({
    pairId: PAIR_BTC_USD,
    strike,
    deadline,
    token: STRK_TOKEN,
    seed: SEED_WEI,
    seederCommitment: seeder.commitment,
    experimental: true,
  })
  if (payload.state !== 'ready') {
    console.error(payload.because)
    process.exit(1)
  }
  describe = `seed ${formatStrk(SEED_WEI)} into a 15-minute BTC/USD market, strike ${Number(strike) / 1e8}`
  outputFile = 'evidence/seq-market.json'
  extra = { strike: strike.toString(), deadline, seederSecret: seeder.secret, seederCommitment: seeder.commitment }
  // THE BRIDGE SHAPE — spend a note, change back, hand the seed over, invoke. No deposit action,
  // so no open note can be minted by accident.
  build = (b) =>
    b
      .with(STRK_TOKEN, (t) => t.withdraw({ recipient: MARKETS, amount: SEED_WEI }))
      .invoke(() => ({ contractAddress: MARKETS, calldata: [...payload.calldata] }))
} else if (step === 'launch') {
  // A DIRECT call — `create_launch` moves no money, so it never touches the pool and pays gas
  // only. That is the whole point of the creator being a commitment: this can be sponsored for
  // somebody with no funded address at all.
  describe = `create a launch: ${LAUNCH_EPOCHS} epoch × ${LAUNCH_UNITS_PER_EPOCH} units at ${formatStrk(LAUNCH_P0)}/unit`
  outputFile = 'evidence/seq-launch.json'
  build = () => undefined
} else if (step === 'buy') {
  const launchId = Number(
    BigInt((await withFallback((p) => p.callContract({ contractAddress: deployed.launch!, entrypoint: 'launch_count', calldata: [] })))[0]!) - 1n,
  )
  const cost = BigInt(
    (await withFallback((p) =>
      p.callContract({
        contractAddress: deployed.launch!,
        entrypoint: 'quote_buy',
        calldata: [`0x${launchId.toString(16)}`, `0x${BUY_UNITS.toString(16)}`],
      }),
    ))[0]!,
  )
  if (held < cost) {
    console.error(`need ${formatStrk(cost)} shielded, hold ${formatStrk(held)}`)
    process.exit(1)
  }
  const buyer = mintPositionSecret()
  const payload = buyPayload([{ launchId, units: BUY_UNITS, commitment: buyer.commitment }])
  if (payload.state !== 'ready') {
    console.error(payload.because)
    process.exit(1)
  }
  describe = `THE HIDDEN BUY — ${BUY_UNITS} units for ${formatStrk(cost)} on launch ${launchId}, buyer never named`
  outputFile = 'evidence/seq-buy.json'
  extra = {
    launchId,
    units: BUY_UNITS,
    costWei: cost.toString(),
    buyerSecret: buyer.secret,
    buyerCommitment: buyer.commitment,
    headline: 'the stake arrives through the pool and the launch records a commitment, never an address',
  }
  build = (b) =>
    b
      .with(STRK_TOKEN, (t) => t.withdraw({ recipient: deployed.launch!, amount: cost }))
      .invoke(() => ({ contractAddress: deployed.launch!, calldata: [...payload.calldata] }))
} else if (step === 'claim') {
  const bet = JSON.parse(readFileSync('evidence/seq-bet.json', 'utf8')) as {
    marketId: number
    rungs: { rung: number; secret: string; commitment: string }[]
  }
  const mkt = JSON.parse(readFileSync('evidence/seq-market.json', 'utf8')) as {
    seederSecret: string
    seederCommitment: string
  }
  const positions = [
    ...bet.rungs.map((r) => ({ label: `rung ${r.rung}`, secret: r.secret, commitment: r.commitment })),
    { label: 'seeder', secret: mkt.seederSecret, commitment: mkt.seederCommitment },
  ]

  //
  // ── THE FILTER, AND WHY IT IS A VIEW OVER COMMITMENTS ─────────────────────────────────
  //
  // The pool reverts on a zero-amount deposit, so one losing rung inside the batch burns the six
  // STRK fee and settles NOTHING — every winner in the same transaction included. `preview_claim`
  // is the only thing standing between a four-position batch and that outcome.
  //
  // It takes COMMITMENTS, never secrets. A view call travels to a public RPC node in the clear and
  // a position secret IS the money — anyone who reads one can claim with it. The commitment is the
  // public half of the same pair, which is exactly what a filter needs and nothing more.
  //
  const previewed = await withFallback((p) =>
    p.callContract({
      contractAddress: MARKETS,
      entrypoint: 'preview_claim',
      calldata: [
        `0x${positions.length.toString(16)}`,
        ...positions.map((x) => `0x${BigInt(x.commitment).toString(16)}`),
      ],
    }),
  )
  // `Span<u128>` on the wire is `[len, ...items]`.
  const payouts = previewed.slice(1).map((v) => BigInt(v))
  if (payouts.length !== positions.length) {
    console.error(`preview_claim returned ${payouts.length} payouts for ${positions.length} positions`)
    process.exit(1)
  }
  positions.forEach((p, i) => {
    const owed = payouts[i]!
    console.log(`  ${p.label.padEnd(8)} ${owed === 0n ? 'nothing — excluded' : formatStrk(owed)}`)
  })

  const owed = positions.filter((_, i) => payouts[i]! > 0n)
  if (owed.length === 0) {
    console.error('nothing is owed on any position — the market has not settled, or it settled against all of them')
    process.exit(1)
  }
  const totalOwed = payouts.reduce((sum, v) => sum + v, 0n)

  const payload = claimPayload(owed.map((o) => o.secret))
  if (payload.state !== 'ready') {
    console.error(payload.because)
    process.exit(1)
  }
  // The pool asserts every open note in the transaction was deposited into, and its free
  // `compile_actions` view CANNOT see a mismatch — it no-ops the emission. So the count is stated
  // once, here, and checked again against what the compiler actually minted.
  const openNoteCount = expectedOpenNotes(MARKET_OP.claim, owed.length)

  describe =
    `THE BATCH CLAIM — ${owed.length} of ${positions.length} positions settled in one transaction, ` +
    `${formatStrk(totalOwed)} home`
  outputFile = 'evidence/seq-claim.json'
  extra = {
    marketId: bet.marketId,
    positions: positions.map((p, i) => ({
      position: p.label,
      commitment: p.commitment,
      payoutWei: payouts[i]!.toString(),
      settled: payouts[i]! > 0n,
    })),
    totalOwedWei: totalOwed.toString(),
    excluded: positions.filter((_, i) => payouts[i]! === 0n).map((p) => p.label),
    headline:
      'one transaction, one fee, three positions settled — and the losing rung filtered out before it ' +
      'could revert the batch and burn the fee for everyone in it',
  }
  //
  // ── THE SETTLING SHAPE ────────────────────────────────────────────────────────────────
  //
  // Nothing is SPENT here, so there is no `withdraw` leg: the money is coming home. What the
  // transaction carries instead is one OPEN NOTE per payout — `Open` being the SDK's marker for a
  // note whose amount a later deposit writes, a symbol rather than a number precisely so it cannot
  // be confused with an amount of zero. `op_claim` returns one `OpenNoteDeposit` per entry and the
  // pool fills them while pulling the sum the contract approved.
  //
  build = (b) => {
    b.with(STRK_TOKEN, (t) => {
      for (let i = 0; i < openNoteCount; i++) t.transfer({ recipient: self, amount: Open })
    })
    b.invoke(({ openNotes }) => {
      if (openNotes.length !== openNoteCount) {
        throw new Error(
          `the compiler minted ${openNotes.length} open notes and this claim deposits into ` +
            `${openNoteCount}. An unmatched one reverts the transaction AFTER the fee is taken — refusing.`,
        )
      }
      // The ids the payload could not know: minted by the compiler from (channelKey, token, index)
      // at proof time, dropped into the slots the serialiser reserved, in payload order — so
      // entry `i`'s payout lands in the note the payload names for entry `i`.
      const calldata = [...payload.calldata]
      payload.noteIdSlots.forEach((slot, i) => {
        const note = openNotes[i]
        if (note === undefined) throw new Error(`no open note was minted for payout ${i + 1}`)
        calldata[slot] = `0x${BigInt(note.noteId).toString(16)}`
      })
      return { contractAddress: MARKETS, calldata }
    })
  }
} else {
  const total = BET_WEI * 3n
  if (held < total) {
    console.error(`need ${formatStrk(total)} shielded, hold ${formatStrk(held)}`)
    process.exit(1)
  }
  const marketId = Number(
    BigInt((await withFallback((p) => p.callContract({ contractAddress: MARKETS, entrypoint: 'market_count', calldata: [] })))[0]!) - 1n,
  )
  const rungs = [mintPositionSecret(), mintPositionSecret(), mintPositionSecret()]
  const payload = betPayload([
    { marketId, side: SIDE_UP, amount: BET_WEI, commitment: rungs[0]!.commitment },
    { marketId, side: SIDE_UP, amount: BET_WEI, commitment: rungs[1]!.commitment },
    { marketId, side: SIDE_DOWN, amount: BET_WEI, commitment: rungs[2]!.commitment },
  ])
  if (payload.state !== 'ready') {
    console.error(payload.because)
    process.exit(1)
  }
  describe = `THE LADDER — 3 bets of ${formatStrk(BET_WEI)} on market ${marketId}, one transaction, one fee`
  outputFile = 'evidence/seq-bet.json'
  extra = {
    marketId,
    rungs: rungs.map((r, i) => ({ rung: i + 1, secret: r.secret, commitment: r.commitment })),
    headline: 'three bets, one pool transaction, one 6 STRK fee — nothing in the protocol’s history has batched like this',
  }
  build = (b) =>
    b
      .with(STRK_TOKEN, (t) => t.withdraw({ recipient: MARKETS, amount: total }))
      .invoke(() => ({ contractAddress: MARKETS, calldata: [...payload.calldata] }))
}

console.log(`  ${describe}`)
if (existsSync(outputFile)) {
  console.error(`\n${outputFile} exists — this step has already run`)
  process.exit(1)
}
if (!execute) {
  console.log(`\nREADY. Spent nothing.\n  npx tsx scripts/ops/run-evidence-sequence.ts ${step} --execute`)
  process.exit(0)
}

//
// ── THE LAUNCH CREATE IS A DIRECT CALL, NOT A POOL TRANSACTION ───────────────────────────
//
// `create_launch` moves no money, so it never touches the pool: no fee, no proof, no action list.
// It pays gas and nothing else. That is deliberate in the contract — the creator is a COMMITMENT
// rather than an address precisely so this can be relayer-sponsored for somebody with no funded
// account, and whoever holds the secret still sweeps the raise.
//
if (step === 'launch') {
  const creator = mintPositionSecret()
  const deadline = Math.floor(Date.now() / 1000) + 1800
  const { transaction_hash } = await account.execute([
    {
      contractAddress: deployed.launch!,
      entrypoint: 'create_launch',
      calldata: CallData.compile([
        byteArray.byteArrayFromString('Passbook Demo'),
        byteArray.byteArrayFromString('PBD'),
        byteArray.byteArrayFromString(''),
        STRK_TOKEN,
        cairo.uint256(LAUNCH_P0).low,
        cairo.uint256(LAUNCH_DP).low,
        cairo.uint256(LAUNCH_TRANCHE).low,
        LAUNCH_EPOCHS,
        deadline,
        creator.commitment,
      ]),
    },
  ])
  console.log(`  ${transaction_hash}`)
  const r = (await provider.waitForTransaction(transaction_hash)) as {
    execution_status?: string
    block_number?: number
  }
  console.log(`  ${r.execution_status}  block ${r.block_number}`)
  mkdirSync('evidence', { recursive: true })
  writeFileSync(
    outputFile,
    `${JSON.stringify(
      {
        step,
        describe,
        transactionHash: transaction_hash,
        executionStatus: r.execution_status,
        block: r.block_number ?? null,
        launch: deployed.launch,
        creatorSecret: creator.secret,
        creatorCommitment: creator.commitment,
        deadline,
        p0Wei: LAUNCH_P0.toString(),
        epochs: LAUNCH_EPOCHS,
        trancheTokens: LAUNCH_TRANCHE.toString(),
        note: 'a DIRECT call — no pool, no fee, no proof. Gas only.',
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  console.log(`\nwrote ${outputFile}`)
  process.exit(r.execution_status === 'SUCCEEDED' ? 0 : 1)
}

// ── Prove and submit ─────────────────────────────────────────────────────────────────────
const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
console.log(`\nproving against block ${provingBlockId} …`)

// `autoSetup` lets the compiler resolve channels and subchannels from discovery itself. Without it
// it decides to open a subchannel and then asserts the channel is in a registry nothing seeded —
// "Channel not found". The app seeds that registry by hand (`buildSendRegistry`); a script has no
// hand-held wallet state to seed it from, so it asks the chain.
// `autoSelectNotes` is what lets the compiler SPEND. Its note-selection branch is gated on the
// option (`if ((balance < 0n && options?.autoSelectNotes) …)`), so without it a deficit finds
// "total available: 0" even with notes sitting in discovery. `send.ts` never needs it because the
// app hands notes over explicitly with `.inputs()`; a script has no wallet state and asks the chain.
const builder = transfers.build({
  autoSetup: true,
  // `'naive'` selects notes until the balance is non-negative. It is a STRATEGY STRING, not a
  // boolean — `true` is truthy enough to pass the guard and then matches no strategy, which is
  // how a wallet holding six STRK reports "total available: 0".
  autoSelectNotes: 'naive',
  // And discovery has its own switch. Without it the compiler never asks the indexer, so the
  // registry stays empty however many notes the chain holds.
  autoDiscover: { notes: 'refresh', channels: 'refresh' },
})
builder.surplusTo(self) // change comes back to us; the SDK fails fast on a shortfall
build(builder)
const invocation = await builder.createProofInvocation({ provingBlockId })
console.log(`compiled ${extractClientActionSpan(invocation.invocation.calldata).length} span felts`)

const { callAndProof } = await transfers.executeWithInvocation(invocation, provingBlockId)
const { call, proof } = callAndProof

const calls =
  step === 'fund'
    ? [
        {
          contractAddress: STRK_TOKEN,
          entrypoint: 'approve',
          calldata: CallData.compile([NET.pool, cairo.uint256(FUND_WEI + pool.feeWei)]),
        },
        call,
      ]
    : // Nothing is deposited on a spend-a-note step, so the approve covers the fee alone.
      [
        {
          contractAddress: STRK_TOKEN,
          entrypoint: 'approve',
          calldata: CallData.compile([NET.pool, cairo.uint256(approveCeiling(pool.feeWei))]),
        },
        call,
      ]

//
// RELAYED WHEN ASKED, AND FOR THE HIDDEN BUY IT MATTERS.
//
// Self-submission puts the deployer — a known depositor — on chain as the sender, and the buy's
// whole claim is about who is NOT named. Relaying makes the relayer the sender, so the buyer
// appears nowhere: the launch stores a commitment, and the stake arrived through the pool.
//
// This is only possible because the wire now carries `resourceBounds`; before that the relayer's
// fee estimate simulated the transaction unproven and every value-moving submission died there.
//
const relayed = process.argv.includes('--relayed')
let transaction_hash: string
if (relayed) {
  console.log(`submitting VIA THE RELAYER at ${RELAYER_URL} …`)
  const res = await fetch(`${RELAYER_URL}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.RELAYER_AUTH_TOKEN ? { 'x-relayer-auth': process.env.RELAYER_AUTH_TOKEN } : {}),
    },
    body: JSON.stringify({
      calls,
      proofFacts: [...proof.proofFacts],
      proof: proofBlobFrom(proof),
      resourceBounds: {
        l2_gas: { max_amount: BOUNDS.l2_gas.max_amount.toString(), max_price_per_unit: BOUNDS.l2_gas.max_price_per_unit.toString() },
        l1_gas: { max_amount: BOUNDS.l1_gas.max_amount.toString(), max_price_per_unit: BOUNDS.l1_gas.max_price_per_unit.toString() },
        l1_data_gas: { max_amount: BOUNDS.l1_data_gas.max_amount.toString(), max_price_per_unit: BOUNDS.l1_data_gas.max_price_per_unit.toString() },
      },
    }),
  })
  const body = (await res.json()) as { transactionHash?: string; error?: string }
  if (!res.ok || !body.transactionHash) {
    console.log(`\nRELAYER REFUSED (${res.status}): ${String(body.error).slice(0, 300)}`)
    process.exit(1)
  }
  transaction_hash = body.transactionHash
} else {
  console.log('submitting, bounds set, estimate skipped …')
  const out = await account.execute(calls, {
    proofFacts: [...proof.proofFacts],
    proof: proofBlobFrom(proof),
    resourceBounds: BOUNDS,
  } as never)
  transaction_hash = out.transaction_hash
}
console.log(`  ${transaction_hash}`)

const receipt = (await provider.waitForTransaction(transaction_hash)) as {
  execution_status?: string
  block_number?: number
  actual_fee?: { amount?: string }
  execution_resources?: unknown
  revert_reason?: string
  events?: unknown[]
}
console.log(`  ${receipt.execution_status}  block ${receipt.block_number}  ${receipt.events?.length ?? 0} events`)

mkdirSync('evidence', { recursive: true })
writeFileSync(
  outputFile,
  `${JSON.stringify(
    {
      step,
      describe,
      transactionHash: transaction_hash,
      executionStatus: receipt.execution_status,
      block: receipt.block_number ?? null,
      actualFee: receipt.actual_fee?.amount ?? null,
      executionResources: receipt.execution_resources ?? null,
      revertReason: receipt.revert_reason ?? null,
      eventCount: receipt.events?.length ?? 0,
      markets: MARKETS,
      submittedBy: relayed
        ? 'THE RELAYER — whoever this position belongs to never appears on chain as the sender'
        : 'the deployer, self-submitted',
      ...extra,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)
console.log(`\nwrote ${outputFile}`)
if (receipt.execution_status !== 'SUCCEEDED') {
  console.log('REVERTED — stopping. Banked above.')
  process.exit(1)
}
