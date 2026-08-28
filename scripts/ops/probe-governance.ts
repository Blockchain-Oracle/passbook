//
// PROBE-1, run as the first real governance journey on SN_MAIN — and the gate transactions it
// banks along the way (docs/governance.md §10.4, §13, §16).
//
//   npx tsx scripts/ops/probe-governance.ts create-house [--execute]   # direct call, gas only
//   npx tsx scripts/ops/probe-governance.ts propose      [--execute]   # direct call, gas only
//   npx tsx scripts/ops/probe-governance.ts ballot       [--execute]   # ONE POOL TX — the probe
//   npx tsx scripts/ops/probe-governance.ts tally        [--execute]   # after close: count + reveal
//
// WHAT THE BALLOT STEP PROVES, the three questions §10.4 asks: (a) the pool derives and injects
// `identity_key` as argument 0 of `privacy_compute` — visible because the ballot LANDS, since
// the Governor asserts a non-zero identity from its pool-only caller; (b) a phase-6 withdraw can
// fund the same transaction's ComputeAndInvoke leg — visible because `take_custody` inside
// `privacy_invoke_with_computation` succeeds; (c) the measured gas, banked in the evidence file.
//
// THE TELLER IS LOCAL. The proposal's tally key is minted into `.relayer/probe-teller.json` on
// this machine, so the `tally` step can count and reveal from HERE — `publish_tally` carries its
// own authority (the curve), and `publish_key` needs only the key. The production Teller never
// needs to know this proposal existed.
//
// Modeled on `run-evidence-sequence.ts`, whose shapes are mainnet-proven; the deviations are the
// compute leg and the local teller, both stated where they happen.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Account, CallData, RpcProvider, cairo, constants } from 'starknet'
import { IndexerDiscoveryProvider, createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk'

import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'
import { deriveViewingKey } from '../../packages/protocol/src/identity.js'
import { readPoolConstants } from '../../packages/protocol/src/pool.js'
import { extractClientActionSpan, formatStrk, PROVING_BLOCK_LAG, proofBlobFrom } from '../../packages/protocol/src/register.js'
import { approveCeiling } from '../../packages/protocol/src/fee-ceiling.js'
import { parseAppContracts } from '../../packages/protocol/src/app-contracts.js'
import { mintPositionSecret } from '../../packages/protocol/src/commitment.js'
import { encodeByteArray } from '../../packages/protocol/src/app-reads.js'
import { mintBallotVector } from '../../packages/protocol/src/governance-commitment.js'
import { sealBallot } from '../../packages/protocol/src/governance-seal.js'
import { GOV_OPT_FOR, ballotPayload } from '../../packages/protocol/src/governance-calldata.js'
import { withFallback } from '../../packages/protocol/src/rpc.js'
import { countBallots, openTeller, tellerChainDeps } from '../../packages/relayer/src/teller.js'

loadDotEnvVerbose()

const step = process.argv[2]
const execute = process.argv.includes('--execute')
if (!step || !['create-house', 'propose', 'ballot', 'tally'].includes(step)) {
  console.error('usage: probe-governance.ts <create-house|propose|ballot|tally> [--execute]')
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
if (!deployed.governance) {
  console.error('no Governance address in the evidence file — run deploy-governance.ts first')
  process.exit(1)
}
const GOV = deployed.governance
const FROM_BLOCK = (() => {
  const raw = JSON.parse(readFileSync('evidence/markets-launch-deployment.json', 'utf8')) as {
    Governance?: { blockNumber?: number }
  }
  return raw.Governance?.blockNumber ?? 0
})()

// ── Numbers. Demo capital, real mechanics — the sequence script's discipline. ────────────
/** One STRK of quorum: the probe ballot alone reaches it, so the journey settles decisively. */
const QUORUM_WEI = 1n * 10n ** 18n
/** The ballot's weight: 1.2 STRK escrowed until close, then reclaimable. */
const WEIGHT_WEI = 1_200_000_000_000_000_000n
/**
 * NOMINAL 66 MINUTES. `propose` asserts `deadline - now >= 3600` AT EXECUTION, and the market
 * step's lesson (two reverts at 2.5 STRK each) is that proving plus inclusion eats minutes off
 * a locally-computed deadline. Six spare minutes cost nothing; a revert costs real STRK.
 */
const WINDOW_SECONDS = 66 * 60

/** The sequence script's measured bounds — a ComputeAndInvoke prices like an invoke plus one
 * external call, comfortably inside the same ceiling (≈7.4 STRK). */
const BOUNDS = {
  l2_gas: { max_amount: 150_000_000n, max_price_per_unit: 50_000_000_000n },
  l1_gas: { max_amount: 10_000n, max_price_per_unit: 200_000_000_000_000n },
  l1_data_gas: { max_amount: 50_000n, max_price_per_unit: 300_000_000_000n },
}

/** The local Teller's ledger. NOT in evidence/ — it holds live secrets. */
const PROBE_TELLER_STORE = '.relayer/probe-teller.json'

const pool = await readPoolConstants()
if (pool.paused) {
  console.error('the pool is paused')
  process.exit(1)
}

const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
const account = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_PRIVATE_KEY })
const self = String(account.address)
const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)

async function directCall(
  entrypoint: string,
  calldata: string[],
  outputFile: string,
  describe: string,
  extra: Record<string, unknown>,
): Promise<void> {
  console.log(`\n${describe}`)
  if (!execute) {
    console.log('DRY RUN — would call', entrypoint, 'on', GOV)
    return
  }
  const { transaction_hash } = await account.execute([{ contractAddress: GOV, entrypoint, calldata }])
  console.log(`  submitted ${transaction_hash}`)
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
        governance: GOV,
        note: 'a DIRECT call — no pool, no fee, no proof. Gas only.',
        verifiedAt: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`wrote ${outputFile}`)
  process.exit(r.execution_status === 'SUCCEEDED' ? 0 : 1)
}

// ── The steps ────────────────────────────────────────────────────────────────────────────

if (step === 'create-house') {
  const founder = mintPositionSecret()
  await directCall(
    'create_house',
    [
      STRK_TOKEN,
      `0x${QUORUM_WEI.toString(16)}`,
      '0x1388', // 5000 bps — simple majority
      '0x1', // COUNT_WEIGHTED
      '0x1', // MEMBERS_OPEN
      '0x0', // no invite on an open House
      ...encodeByteArray('Passbook Founders'),
      founder.commitment,
    ],
    'evidence/seq-gov-house.json',
    'activate House 0 — "Passbook Founders", open, STRK-weighted, 1 STRK quorum',
    { founderSecret: founder.secret, founderCommitment: founder.commitment },
  )
}

if (step === 'propose') {
  // The LOCAL teller mints the key — see the header. The secret never leaves this machine.
  const teller = openTeller({ file: PROBE_TELLER_STORE })
  const tallyKey = teller.mintKey()
  const deadline = Math.floor(Date.now() / 1000) + WINDOW_SECONDS
  await directCall(
    'propose',
    [
      '0x0', // house 0
      '0x1', // MODE_SECRET_UNTIL_CLOSE
      '0x2', // FOR / AGAINST
      `0x${deadline.toString(16)}`,
      `0x${tallyKey.toString(16)}`,
      '0x1', // ACTION_TEXT
      '0x0',
      '0x0',
      ...encodeByteArray('Should Passbook keep building governance in the open?'),
    ],
    'evidence/seq-gov-propose.json',
    `propose on House 0 — sealed until close, closes in ${WINDOW_SECONDS / 60} minutes`,
    { deadline, tallyKey: `0x${tallyKey.toString(16)}`, tellerStore: PROBE_TELLER_STORE },
  )
}

if (step === 'ballot') {
  // Read the proposal the propose step made — its REAL tally key, not a remembered one.
  const proposalFelts = await withFallback((p) =>
    p.callContract({ contractAddress: GOV, entrypoint: 'get_proposal', calldata: ['0x0'] }),
  )
  const tallyKey = BigInt(proposalFelts[4] ?? '0x0')
  const state = Number(BigInt(proposalFelts[11] ?? '0x0'))
  if (state !== 1 || tallyKey === 0n) {
    console.error(`proposal 0 is not open to ballots (state ${state}) — run propose first`)
    process.exit(1)
  }

  const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: NET.prover, chainId: NET.chainId as constants.StarknetChainId, ohttp: true },
    discoveryProvider: discovery,
    poolContractAddress: NET.pool,
  })
  const { notes } = await discovery.discoverNotes(BigInt(self) as never, viewingKey as never, {})
  const mine = (notes.get(BigInt(STRK_TOKEN) as never) ?? []) as { amount: bigint }[]
  const held = mine.reduce((sum, n) => sum + n.amount, 0n)
  console.log(`\nBALLOT ${execute ? '(EXECUTING)' : '(DRY RUN)'} — shielded STRK: ${formatStrk(held)}`)
  // Only the WEIGHT spends from notes — `collect_fee` pulls from whoever submits, and on a
  // self-submit that is the deployer's public balance (the sequence script's own arithmetic).
  if (held < WEIGHT_WEI) {
    console.error(`need ${formatStrk(WEIGHT_WEI)} shielded — run the sequence fund step first`)
    process.exit(1)
  }

  // The whole client side of §4.1, in order: escrow secret, commitment vector, sealed choice,
  // payload — exactly what `BallotTicket.tsx` does, driven headless.
  const escrow = mintPositionSecret()
  const vector = mintBallotVector(WEIGHT_WEI, GOV_OPT_FOR, 2)
  const sealed = await sealBallot(
    { choice: GOV_OPT_FOR, weight: WEIGHT_WEI, blinds: vector.blinds },
    tallyKey,
  )
  const payload = ballotPayload({
    houseId: 0,
    proposalId: 0,
    newTotalWeight: WEIGHT_WEI,
    reclaimCommitment: escrow.commitment,
    drawPot: false,
    vector: vector.vector.map((point) => {
      if (point === null) throw new Error('identity point in a ballot vector')
      return point
    }),
    sealed,
  })
  if (payload.state !== 'ready') {
    console.error(payload.because)
    process.exit(1)
  }

  if (!execute) {
    console.log(`DRY RUN — would escrow ${formatStrk(WEIGHT_WEI)} into a FOR ballot via ComputeAndInvoke`)
    process.exit(0)
  }

  const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
  console.log(`proving against block ${provingBlockId} …`)
  const builder = transfers.build({
    autoSetup: true,
    autoSelectNotes: 'naive',
    autoDiscover: { notes: 'refresh', channels: 'refresh' },
  })
  builder.surplusTo(self)
  // THE PROBE ITSELF: phase-6 withdraw funds the Governor, phase-7 ComputeAndInvoke carries the
  // ballot — one transaction, the §10.4(b) question answered by it landing.
  builder.with(STRK_TOKEN, (t) => t.withdraw({ recipient: GOV, amount: WEIGHT_WEI }))
  builder.computeAndInvoke(() => ({
    contractAddress: GOV,
    computeAdditionalData: [...payload.calldata],
    invokeAdditionalData: [...payload.calldata],
  }))
  const invocation = await builder.createProofInvocation({ provingBlockId })
  console.log(`compiled ${extractClientActionSpan(invocation.invocation.calldata).length} span felts`)

  const { callAndProof } = await transfers.executeWithInvocation(invocation, provingBlockId)
  const { call, proof } = callAndProof
  const calls = [
    {
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: CallData.compile([NET.pool, cairo.uint256(approveCeiling(pool.feeWei))]),
    },
    call,
  ]

  console.log('submitting (self), bounds set, estimate skipped …')
  const { transaction_hash } = await account.execute(calls, {
    proofFacts: [...proof.proofFacts],
    proof: proofBlobFrom(proof),
    resourceBounds: BOUNDS,
  } as never)
  console.log(`  submitted ${transaction_hash}`)
  const r = (await provider.waitForTransaction(transaction_hash)) as {
    execution_status?: string
    block_number?: number
    actual_fee?: { amount?: string }
  }
  console.log(`  ${r.execution_status}  block ${r.block_number}  fee ${r.actual_fee?.amount ?? '?'}`)

  mkdirSync('evidence', { recursive: true })
  writeFileSync(
    'evidence/seq-gov-ballot.json',
    `${JSON.stringify(
      {
        step,
        describe: `PROBE-1: ${formatStrk(WEIGHT_WEI)} escrowed into a sealed FOR ballot via ComputeAndInvoke`,
        transactionHash: transaction_hash,
        executionStatus: r.execution_status,
        block: r.block_number ?? null,
        actualFeeWei: r.actual_fee?.amount ?? null,
        governance: GOV,
        escrowSecret: escrow.secret,
        escrowCommitment: escrow.commitment,
        probeAnswers: {
          identityInjected: 'the Governor asserts a non-zero pool-derived identity; the ballot landing IS the answer',
          withdrawFundsCompute: 'take_custody ran inside privacy_invoke_with_computation on the same transaction',
          gas: r.actual_fee?.amount ?? 'see actualFeeWei',
        },
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  console.log('wrote evidence/seq-gov-ballot.json')
  process.exit(r.execution_status === 'SUCCEEDED' ? 0 : 1)
}

if (step === 'tally') {
  const teller = openTeller({ file: PROBE_TELLER_STORE })
  const chain = tellerChainDeps(
    GOV,
    {
      callContract: async ({ contractAddress, entrypoint, calldata }) =>
        (await withFallback((p) => p.callContract({ contractAddress, entrypoint, calldata }))) as string[],
      getEvents: (filter) =>
        withFallback(
          async (p) =>
            (await p.channel.getEvents(filter as never)) as {
              events?: unknown[]
              continuation_token?: string
            },
        ),
    },
    FROM_BLOCK,
  )
  const proposal = await chain.getProposal(0)
  const now = Math.floor(Date.now() / 1000)
  if (proposal.state !== 1) {
    console.error(`proposal 0 is in state ${proposal.state} — nothing to tally`)
    process.exit(1)
  }
  if (now < proposal.deadline) {
    console.error(`the box is still open — closes in ${proposal.deadline - now}s`)
    process.exit(1)
  }
  if (!teller.holds(proposal.tallyKey)) {
    console.error('this machine does not hold the tally key — the propose step mints it here')
    process.exit(1)
  }

  if (!execute) {
    console.log('DRY RUN — would count, publish the tally, then publish the key')
    process.exit(0)
  }

  let tallyTx = ''
  let keyTx = ''
  await teller.tick({
    ...chain,
    submitTally: async (proposalId, sums, blindSums, excluded) => {
      const calldata = [
        `0x${proposalId.toString(16)}`,
        `0x${sums.length.toString(16)}`,
        ...sums.map((s) => `0x${s.toString(16)}`),
        `0x${blindSums.length.toString(16)}`,
        ...blindSums.map((b) => `0x${b.toString(16)}`),
        `0x${excluded.length.toString(16)}`,
        ...excluded,
      ]
      const res = await account.execute([{ contractAddress: GOV, entrypoint: 'publish_tally', calldata }])
      await provider.waitForTransaction(res.transaction_hash)
      tallyTx = res.transaction_hash
      return res.transaction_hash
    },
    submitKey: async (proposalId, secret) => {
      const res = await account.execute([
        {
          contractAddress: GOV,
          entrypoint: 'publish_key',
          calldata: [`0x${proposalId.toString(16)}`, `0x${secret.toString(16)}`],
        },
      ])
      await provider.waitForTransaction(res.transaction_hash)
      keyTx = res.transaction_hash
      return res.transaction_hash
    },
  })

  const settled = await chain.getProposal(0)
  writeFileSync(
    'evidence/seq-gov-tally.json',
    `${JSON.stringify(
      {
        step,
        describe: 'the Teller counts, the curve accepts, the key goes on-chain forever',
        tallyTx,
        keyTx,
        finalState: settled.state,
        governance: GOV,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  console.log(`wrote evidence/seq-gov-tally.json — final state ${settled.state}`)
}
