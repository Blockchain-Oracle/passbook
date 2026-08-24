//
// Funds the relayer hot key for story 1.13's ONE banked sponsored registration.
//
// The relayer signs every sponsored submission out of its own STRK balance, and that
// balance is currently 0 — its funding monitor refuses work below two live fees
// (funding-monitor.ts, REFUSAL_FEE_MULTIPLE). This sends exactly 13 STRK from the
// deployer: floor is 2 × 6 STRK = 12 to clear the refusal gate, one bank spends ~6 +
// gas, and the deployer keeps enough to stay operable. The number is the authorized
// session amount, not a policy — see the 1.13 spec's Design Notes.
//
//   npx tsx scripts/fund-relayer.ts             # checks only, spends nothing
//   npx tsx scripts/fund-relayer.ts --execute   # SPENDS REAL STRK
//
// Dry run is the default and spending needs `--execute`, same as the other scripts.
// Only the `--execute` path writes evidence/relayer-funding.json, and it refuses to
// overwrite one that exists: evidence is append-only, and a second funding leg is a
// second decision, not a re-run.
//
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { Account, CallData, RpcProvider, cairo } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../packages/protocol/src/env.js'
import { readPoolConstants } from '../packages/protocol/src/pool.js'
import { formatStrk } from '../packages/protocol/src/register.js'
import { REFUSAL_FEE_MULTIPLE } from '../packages/relayer/src/funding-monitor.js'
import { pickBroadcastHost, strkBalance } from './account-lib.js'

const OUTPUT_FILE = 'evidence/relayer-funding.json'

/** The authorized session amount. See the header — a constant on purpose, not a policy. */
const FUNDING_AMOUNT_WEI = 13n * 10n ** 18n

const execute = process.argv.includes('--execute')

loadDotEnvVerbose()

const deployerAddress = process.env.DEPLOYER_ADDRESS
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
const relayerAddress = process.env.RELAYER_ADDRESS

function abort(message: string): never {
  console.error(`\nfund-relayer: ${message}`)
  process.exit(1)
}

// The protocol's own bigint formatter — the local Number-based one lost precision past
// 2^53 wei, which is every balance this script prints.
const fmtStrk = (wei: bigint) => `${formatStrk(wei)} STRK`

if (ACTIVE_NETWORK !== 'mainnet') abort(`ACTIVE_NETWORK is "${ACTIVE_NETWORK}" — this session banks on mainnet`)
if (!deployerAddress || !deployerKey) abort('DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY must both be set')
if (!relayerAddress) abort('RELAYER_ADDRESS must be set — it is the transfer destination')
if (existsSync(OUTPUT_FILE)) {
  abort(
    `${OUTPUT_FILE} already exists, so the funding leg has already run.\n` +
      `  Evidence is append-only and a second transfer is a new decision — ask first.`,
  )
}

console.log(`\nfund relayer — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`)
console.log(`network  ${ACTIVE_NETWORK}`)
console.log(`from     ${deployerAddress} (deployer)`)
console.log(`to       ${relayerAddress} (relayer)`)
console.log(`amount   ${fmtStrk(FUNDING_AMOUNT_WEI)}\n`)

// The refusal floor is derived from the LIVE fee, exactly as the relayer's own monitor
// derives it — a relayer already clear of its floor does not need this transfer, and
// sending anyway would just move budget for no reason.
const pool = await readPoolConstants()
if (pool.feeWei <= 0n) abort(`the pool reported a fee of ${pool.feeWei} wei — not a reading to size a transfer from`)
const refusalFloorWei = pool.feeWei * REFUSAL_FEE_MULTIPLE
console.log(`live pool fee            ${fmtStrk(pool.feeWei)}`)
console.log(`relayer refusal floor    ${fmtStrk(refusalFloorWei)} (${REFUSAL_FEE_MULTIPLE} live fees)`)

const [deployerBefore, relayerBefore] = await Promise.all([
  strkBalance(deployerAddress),
  strkBalance(relayerAddress),
])
console.log(`deployer balance         ${fmtStrk(deployerBefore)}`)
console.log(`relayer balance          ${fmtStrk(relayerBefore)}`)

if (relayerBefore >= refusalFloorWei) {
  abort(
    `the relayer already holds ${fmtStrk(relayerBefore)}, at or above its ` +
      `${fmtStrk(refusalFloorWei)} refusal floor. It can sign without this transfer. ` +
      `Nothing was sent.`,
  )
}
if (deployerBefore < FUNDING_AMOUNT_WEI) {
  abort(
    `the deployer holds ${fmtStrk(deployerBefore)}, below the ${fmtStrk(FUNDING_AMOUNT_WEI)} ` +
      `transfer amount. Nothing was sent.`,
  )
}

let nodeUrl: string
try {
  nodeUrl = await pickBroadcastHost()
} catch (e) {
  abort(String(e instanceof Error ? e.message : e))
}
const provider = new RpcProvider({ nodeUrl })
const account = new Account({ provider, address: deployerAddress, signer: deployerKey })
const transferCall = {
  contractAddress: STRK_TOKEN,
  entrypoint: 'transfer',
  calldata: CallData.compile([relayerAddress, cairo.uint256(FUNDING_AMOUNT_WEI)]),
}

// Signs locally and asks the node the price. Submits nothing. The deployer pays the
// transfer gas ON TOP of the 13 STRK, so the estimate has to fit in what remains.
const estimated = BigInt((await account.estimateInvokeFee(transferCall)).overall_fee)
console.log(`estimated transfer gas   ${fmtStrk(estimated)}`)
if (deployerBefore < FUNDING_AMOUNT_WEI + estimated * 2n) {
  abort(
    `the deployer cannot cover ${fmtStrk(FUNDING_AMOUNT_WEI)} plus twice the estimated gas ` +
      `(${fmtStrk(estimated)} estimated). Nothing was sent.`,
  )
}

if (!execute) {
  console.log(
    `\nREADY. This run spent nothing and wrote nothing.\n` +
      `Would transfer ${fmtStrk(FUNDING_AMOUNT_WEI)} deployer -> relayer via ${nodeUrl}.\n` +
      `To spend real STRK and do it for real:\n  npx tsx scripts/fund-relayer.ts --execute\n`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------------
// From here down it costs money. Nothing above this line did.
// ---------------------------------------------------------------------------------

console.log(`\ntransferring via ${nodeUrl} ...`)
const { transaction_hash } = await account.execute(transferCall)
console.log(`transaction ${transaction_hash}`)

// GUARDED, and the guard is not hypothetical: the real session's first run crashed
// exactly here — the transfer had broadcast, the wait threw (a client-side API bug at
// the time, but a dropped socket or a lagging host fails identically), and the script
// died without its evidence. A throw after broadcast must never read as "nothing
// happened": the money may be moving, so the abort names the hash and forbids a blind
// re-run.
let receipt: { execution_status?: string; revert_reason?: string; block_number?: number }
try {
  receipt = (await provider.waitForTransaction(transaction_hash)) as typeof receipt
} catch (e) {
  abort(
    `the wait for ${transaction_hash} failed (${String(e).slice(0, 160)}), but the ` +
      `transfer WAS BROADCAST and may have landed. Do NOT re-run --execute blind — a ` +
      `second run is a second 13 STRK transfer. Verify on-chain first:\n` +
      `  ${NET.explorer}/tx/${transaction_hash}\n` +
      `  ${OUTPUT_FILE} was NOT written; capture it from the receipt once the status is known.`,
  )
}
// Strictly SUCCEEDED — this script writes provenance, and anything-but-REVERTED would
// pass states that are not a landed transfer.
if (receipt.execution_status !== 'SUCCEEDED') {
  abort(
    `the transfer did not succeed (${receipt.execution_status ?? 'no status on the receipt'}` +
      `${receipt.revert_reason ? `: ${receipt.revert_reason}` : ''}).\n` +
      `  ${OUTPUT_FILE} was NOT written. The session must stop here — see the 1.13 spec.`,
  )
}

// Read back from the chain rather than trusting the wait: this record is evidence. The
// balance read POLLS, because it goes through the fallback chain whose hosts lag each
// other by a block — a single read racing a stale host would abort a transfer that
// landed and leave a real transaction with no record.
let deployerAfter = 0n
let relayerAfter = relayerBefore
for (let attempt = 0; attempt < 10 && relayerAfter < relayerBefore + FUNDING_AMOUNT_WEI; attempt++) {
  if (attempt > 0) await sleep(3_000)
  ;[deployerAfter, relayerAfter] = await Promise.all([
    strkBalance(deployerAddress),
    strkBalance(relayerAddress),
  ])
}
if (relayerAfter < relayerBefore + FUNDING_AMOUNT_WEI) {
  abort(
    `the relayer balance moved ${fmtStrk(relayerAfter - relayerBefore)}, not the ` +
      `${fmtStrk(FUNDING_AMOUNT_WEI)} sent, and did not settle within the polling window — ` +
      `NOT writing ${OUTPUT_FILE}. Investigate ${transaction_hash} before anything else spends.`,
  )
}

const out = {
  purpose: 'story 1.13 — fund the relayer hot key for the one banked sponsored registration',
  from: deployerAddress,
  to: relayerAddress,
  amountWei: FUNDING_AMOUNT_WEI.toString(),
  transactionHash: transaction_hash,
  block: receipt.block_number ?? null,
  deployerBalanceBeforeWei: deployerBefore.toString(),
  deployerBalanceAfterWei: deployerAfter.toString(),
  relayerBalanceBeforeWei: relayerBefore.toString(),
  relayerBalanceAfterWei: relayerAfter.toString(),
  livePoolFeeWei: pool.feeWei.toString(),
  refusalFloorWei: refusalFloorWei.toString(),
  network: ACTIVE_NETWORK,
  chainId: NET.chainId,
  sentVia: nodeUrl,
  executedAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(`deployer ${fmtStrk(deployerBefore)} -> ${fmtStrk(deployerAfter)}`)
console.log(`relayer  ${fmtStrk(relayerBefore)} -> ${fmtStrk(relayerAfter)}`)
console.log(`\nverify independently:\n  ${NET.explorer}/tx/${transaction_hash}`)
