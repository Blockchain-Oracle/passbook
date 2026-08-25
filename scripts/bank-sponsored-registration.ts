//
// Banks story 1.13's ONE sponsored registration on mainnet and measures what it costs.
//
// This is the paid gate the free probes stop short of: it drives the REAL
// `registerSponsored` pipeline — fresh throwaway identity, counterfactual OZ address,
// live local relayer, live prover over OHTTP — and records the true cost (pool fee +
// gas, cross-checked against the relayer's balance delta) in
// evidence/sponsored-registration.json. FR-019's number lives there, with provenance,
// and nowhere else.
//
// TWO TERMINALS, in this order — the bank talks to the relayer over loopback HTTP, so
// the server must already be listening when this script starts (it pre-checks and
// refuses otherwise, for free):
//
//   terminal 1:  npx tsx packages/relayer/src/server.ts     # leave it running
//   terminal 2:  npx tsx scripts/bank-sponsored-registration.ts
//
// EXACTLY ONE, BY CONSTRUCTION. The script refuses to run while the evidence file
// exists, and every pre-check runs before anything is signed or posted. There is no
// --execute flag because there is no dry run to have: the free full-stack rehearsal is
// scripts/probes/registration-prove.ts, which should be green before this runs.
//
// THE DEPLOYER ALSO SPENDS HERE, and that is a discovered prerequisite rather than a
// choice: the prove leg hard-requires a DEPLOYED contract at the registering address
// (see the deploy section below), so the deployer funds the throwaway's own
// DEPLOY_ACCOUNT (~0.13 STRK estimated, funded at 2x) before the relayer spends
// anything. Discovered 2026-08-24, when the first prove attempt failed free.
//
// THE THROWAWAY KEY NEVER LEAVES PROCESS MEMORY. It is generated here, used to derive
// and register the viewing key, and discarded — never printed, never written. The
// registered ADDRESS is public on-chain and is recorded; the key is not, and there is
// nothing at the address to lose.
//
// IF THIS SCRIPT ENDS IN `confirmation-unknown`, STOP. A transaction may be in flight;
// the key is single-use and a blind re-run is a 6 STRK NON_ZERO_VALUE revert. Search
// the chain for the transaction first — the failure text below says exactly that.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { Account, CallData, RpcProvider, cairo, hash } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../packages/protocol/src/env.js'
import { actualFeeWei } from '../packages/protocol/src/activity.js'
import { generateIdentity } from '../packages/protocol/src/identity.js'
import { readPoolConstants } from '../packages/protocol/src/pool.js'
import {
  confirmFromReceipt,
  formatStrk,
  PROVING_BLOCK_LAG,
  proveRegistration,
  registerSponsored,
  type RegistrationStage,
} from '../packages/protocol/src/register.js'
import { preflightRegistration } from '../packages/protocol/src/registration.js'
import { withFallback } from '../packages/protocol/src/rpc.js'
import { REFUSAL_FEE_MULTIPLE } from '../packages/relayer/src/funding-monitor.js'
import { OZ_ACCOUNT_CLASS_HASH, pickBroadcastHost, strkBalance } from './account-lib.js'

const OUTPUT_FILE = 'evidence/sponsored-registration.json'
const FUNDING_FILE = 'evidence/relayer-funding.json'

const RELAYER_URL = process.env.RELAYER_URL ?? 'http://127.0.0.1:8787/api/submit'

loadDotEnvVerbose()

const relayerAddress = process.env.RELAYER_ADDRESS
const deployerAddress = process.env.DEPLOYER_ADDRESS
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY

function abort(message: string): never {
  console.error(`\nbank-sponsored-registration: ${message}`)
  process.exit(1)
}

/**
 * The receipt's `actual_fee`, or a hard stop.
 *
 * The PARSER is `activity.ts`'s — shared, unit-tested against both RPC shapes and a junk table,
 * rather than a second private copy here where nothing could run it. The POLICY is this
 * script's and stays here: evidence may not carry a fee this process could not read, so an
 * `unknown` aborts. `activity.ts` returns `unknown` instead of throwing because it renders a
 * page of history where one odd receipt must cost one row its fee field; a banking run has
 * exactly one receipt and no such thing as a partially-known cost.
 */
function bankedFee(receipt: unknown): { amount: bigint; unit: string } {
  const fee = actualFeeWei(receipt)
  if (fee.state === 'unknown') {
    abort(`the receipt carries no readable actual_fee (${fee.reason}) — refusing to bank a cost`)
  }
  return { amount: fee.amountWei, unit: fee.unit }
}

// ---------------------------------------------------------------------------------
// Pre-checks — all free, all before anything is signed or posted.
// ---------------------------------------------------------------------------------

if (ACTIVE_NETWORK !== 'mainnet') abort(`ACTIVE_NETWORK is "${ACTIVE_NETWORK}" — the bank is a mainnet fact`)
if (!relayerAddress) abort('RELAYER_ADDRESS must be set — the balance-delta cross-check reads it')
if (!deployerAddress || !deployerKey) {
  abort('DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY must be set — the deployer funds the account deployment')
}
if (existsSync(OUTPUT_FILE)) {
  abort(
    `${OUTPUT_FILE} already exists. The session banks exactly ONE registration and it has ` +
      `been banked; a second is a new decision, not a re-run. Nothing was spent.`,
  )
}
if (!existsSync(FUNDING_FILE)) {
  abort(
    `${FUNDING_FILE} is missing — run scripts/fund-relayer.ts --execute first. The relayer ` +
      `cannot sign at 0 STRK, and the evidence must carry the funding leg's provenance.`,
  )
}
const funding = JSON.parse(readFileSync(FUNDING_FILE, 'utf8')) as { transactionHash?: string }
if (!funding.transactionHash) abort(`${FUNDING_FILE} has no transactionHash — not a funding record`)

console.log(`\nbank sponsored registration — SPENDS THE RELAYER'S STRK when it proceeds`)
console.log(`network   ${ACTIVE_NETWORK}`)
console.log(`pool      ${NET.pool}`)
console.log(`relayer   ${RELAYER_URL} (submitting as ${relayerAddress})\n`)

// Liveness AND identity in one free GET: the relayer answers /fee-recipient with the
// address it signs as, so this catches "nothing is listening" and "a different wallet
// is listening" — the balance-delta cross-check below is meaningless against the wrong
// wallet — before anything is proven.
const feeRecipientUrl = new URL('/fee-recipient', RELAYER_URL).toString()
let advertised: string | undefined
try {
  const res = await fetch(feeRecipientUrl, { signal: AbortSignal.timeout(5_000) })
  advertised = ((await res.json()) as { feeRecipient?: string })?.feeRecipient
} catch (e) {
  abort(
    `the relayer at ${feeRecipientUrl} did not answer (${String(e)}).\n` +
      `  Start it first: npx tsx packages/relayer/src/server.ts`,
  )
}
if (!advertised || BigInt(advertised) !== BigInt(relayerAddress)) {
  abort(
    `the relayer advertises fee recipient ${advertised}, but RELAYER_ADDRESS is ` +
      `${relayerAddress}. The balance cross-check would measure the wrong wallet. Refusing.`,
  )
}
// The relayer's ACCOUNT CONTRACT must exist, not just its balance: a funded but
// undeployed hot key answers every free pre-check and then refuses the relay leg with
// "Contract not found" — after the throwaway's deploy leg has already been paid for and
// burned. Learned the expensive way in this session; checked for free here, first.
let relayerClass: string
try {
  relayerClass = await withFallback((p) => p.getClassHashAt(relayerAddress))
} catch (e) {
  abort(
    `the relayer address ${relayerAddress} has NO deployed account contract ` +
      `(${String(e).slice(0, 120)}). It cannot sign a transaction, so the bank would fail ` +
      `AFTER the throwaway deploy leg was spent. Deploy it first:\n` +
      `  npx tsx scripts/deploy-account.ts --role=relayer --execute`,
  )
}
console.log(`relayer is up, signs as its advertised address, account class ${relayerClass}`)

const pool = await readPoolConstants()
if (pool.paused) abort('the pool is PAUSED. Nothing was spent.')
if (pool.feeWei <= 0n) abort(`the pool reported a fee of ${pool.feeWei} wei — refusing to spend against it`)
const poolClassAtBank = await withFallback((p) => p.getClassHashAt(NET.pool))
console.log(
  `pool at block ${pool.blockNumber}: fee ${formatStrk(pool.feeWei)} STRK · ` +
    `proof window ${pool.proofValidityBlocks} blocks · class ${poolClassAtBank}`,
)

const relayerBalanceBefore = await strkBalance(relayerAddress)
const floorWei = pool.feeWei * REFUSAL_FEE_MULTIPLE
console.log(`relayer balance ${formatStrk(relayerBalanceBefore)} STRK (refusal floor ${formatStrk(floorWei)})`)
if (relayerBalanceBefore < floorWei) {
  abort(
    `the relayer holds ${formatStrk(relayerBalanceBefore)} STRK, below its own ` +
      `${formatStrk(floorWei)} refusal floor — it would refuse this submission. ` +
      `Run scripts/fund-relayer.ts --execute first.`,
  )
}

// The fresh identity, at the product's own counterfactual convention. The key exists
// only in this process. One regeneration is allowed on the ~2^-250 collision; a second
// hit is not luck and stops the session.
function freshIdentityAtCounterfactual(): { privateKey: string; publicKey: string; address: string } {
  const identity = generateIdentity()
  const address = hash.calculateContractAddressFromHash(
    identity.publicKey, // salt
    OZ_ACCOUNT_CLASS_HASH,
    [identity.publicKey], // constructor calldata
    0, // deployerAddress — 0, the self-deploying convention
  )
  return { ...identity, address }
}

let identity = freshIdentityAtCounterfactual()
let route = await preflightRegistration(identity.privateKey, identity.address)
if (route.route === 'blocked-rpc-unknown') abort(`preflight could not read the chain: ${route.reason}`)
if (route.route !== 'unregistered') {
  console.warn(`fresh address ${identity.address} preflights "${route.route}" — regenerating once`)
  identity = freshIdentityAtCounterfactual()
  route = await preflightRegistration(identity.privateKey, identity.address)
  // An RPC that stopped answering between the two reads is a network fault, not a second
  // collision — reporting it as one would send the investigation at the derivation when
  // the chain was simply unreadable.
  if (route.route === 'blocked-rpc-unknown') {
    abort(`the second preflight could not read the chain: ${route.reason}. Nothing was spent.`)
  }
  if (route.route !== 'unregistered') {
    abort(
      `a SECOND fresh key preflighted "${route.route}". Two collisions in a row is not ` +
        `chance — investigate the derivation before spending anything.`,
    )
  }
}
console.log(`fresh identity at counterfactual OZ address ${identity.address} — unregistered\n`)

// ---------------------------------------------------------------------------------
// Deploy the throwaway account — a PREREQUISITE discovered live, not a nicety.
//
// The prove leg's virtual transaction authenticates the registering user via the
// pool's `assert_valid_signature` (reference/privacy utils.cairo:383-408), whose first
// step probes SRC5 `supports_interface` on the user's address. A deployed account
// without SRC5 is tolerated (safe dispatcher); an UNDEPLOYED address is a system-level
// "contract not deployed" revert nothing can catch, and the prover refuses to prove a
// reverting transaction. The free `compile_actions` VIEW accepts an undeployed sender,
// which is why no probe ever caught this: registration can compile counterfactually
// but can never PROVE counterfactually. Account deployment must come first.
//
// The deployer funds the fresh address with twice the estimated deployment fee and the
// account self-deploys (the OZ convention: it pays for its own deployment). Whatever
// dust remains is burned with the key when this process exits.
// ---------------------------------------------------------------------------------

// The same spec-vetted host selection the funding script uses: this provider SIGNS
// (the throwaway's deployment, then the pipeline's free proof invocation), and a host
// outside starknet.js's supported spec window fails at broadcast, after the interesting
// pre-checks all passed.
let nodeUrl: string
try {
  nodeUrl = await pickBroadcastHost()
} catch (e) {
  abort(String(e instanceof Error ? e.message : e))
}
const provider = new RpcProvider({ nodeUrl })
const account = new Account({
  provider,
  address: identity.address,
  signer: identity.privateKey,
})

const deployFeeEstimate = BigInt(
  (
    await account.estimateAccountDeployFee({
      classHash: OZ_ACCOUNT_CLASS_HASH,
      constructorCalldata: [identity.publicKey],
      addressSalt: identity.publicKey,
      contractAddress: identity.address,
    })
  ).overall_fee,
)
// 1.5x the estimate, not 2x. The estimate already runs well above what is actually
// paid (0.1263 estimated vs 0.0540 paid on this session's first leg), but the funded
// balance has to clear the v3 RESOURCE BOUNDS ceiling starknet.js derives from the
// estimate — not the estimate itself — so 1.0x risks an upfront insufficient-balance
// rejection. Anything unconsumed is burned dust at the throwaway.
const deployFundingWei = (deployFeeEstimate * 3n) / 2n
/**
 * The ruled ceiling on the deploy leg (team-lead GO, 2026-08-24): ~0.5 STRK all in.
 * The funded amount is capped at 0.4 so the deployer's own transfer gas (~0.06
 * measured on the 13 STRK leg) stays inside it. An estimate that blows through this
 * is a stop-and-report, not a bigger spend.
 */
const DEPLOY_FUNDING_CAP_WEI = 4n * 10n ** 17n
if (deployFundingWei > DEPLOY_FUNDING_CAP_WEI) {
  abort(
    `the deployment leg wants ${formatStrk(deployFundingWei)} STRK, above the ` +
      `${formatStrk(DEPLOY_FUNDING_CAP_WEI)} cap ruled for it. Stopping to report ` +
      `rather than spending more. Nothing was sent.`,
  )
}
console.log(
  `account deployment: estimated ${formatStrk(deployFeeEstimate)} STRK, ` +
    `funding the address with ${formatStrk(deployFundingWei)}`,
)
const deployerBalance = await strkBalance(deployerAddress)
if (deployerBalance < deployFundingWei * 2n) {
  abort(
    `the deployer holds ${formatStrk(deployerBalance)} STRK, not enough to fund the ` +
      `deployment leg with headroom. Nothing was spent.`,
  )
}

// Every hash broadcast in this leg, so a throw AFTER a broadcast can name what is in
// flight. The funding script's first real run taught this the expensive way: a wait
// that dies post-broadcast without printing the hash leaves the operator with money in
// motion and no thread to pull.
const broadcastInFlight: string[] = []
const deployerAccount = new Account({ provider, address: deployerAddress, signer: deployerKey })

let fundTx: { transaction_hash: string }
let deployTx: { transaction_hash: string }
let deployReceipt: { execution_status?: string; block_number?: number; actual_fee?: { amount?: string } }
try {
  fundTx = await deployerAccount.execute({
    contractAddress: STRK_TOKEN,
    entrypoint: 'transfer',
    calldata: CallData.compile([identity.address, cairo.uint256(deployFundingWei)]),
  })
  broadcastInFlight.push(fundTx.transaction_hash)
  console.log(`funding transfer ${fundTx.transaction_hash}`)
  const fundReceipt = (await provider.waitForTransaction(fundTx.transaction_hash)) as {
    execution_status?: string
  }
  if (fundReceipt.execution_status !== 'SUCCEEDED') {
    abort(`the funding transfer did not succeed (${fundReceipt.execution_status}). Session stops here.`)
  }

  deployTx = await account.deployAccount({
    classHash: OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata: [identity.publicKey],
    addressSalt: identity.publicKey,
    contractAddress: identity.address,
  })
  broadcastInFlight.push(deployTx.transaction_hash)
  console.log(`deploy account   ${deployTx.transaction_hash}`)
  deployReceipt = (await provider.waitForTransaction(deployTx.transaction_hash)) as typeof deployReceipt
  if (deployReceipt.execution_status !== 'SUCCEEDED') {
    abort(`the account deployment did not succeed (${deployReceipt.execution_status}). Session stops here.`)
  }
} catch (e) {
  abort(
    `the deploy leg threw (${String(e).slice(0, 160)})` +
      (broadcastInFlight.length
        ? ` with ${broadcastInFlight.length} transaction(s) ALREADY BROADCAST:\n` +
          broadcastInFlight.map((h) => `  ${NET.explorer}/tx/${h}`).join('\n') +
          `\n  They may land. Verify each on-chain before ANY re-run — a blind re-run ` +
          `re-spends the leg against a state that may already include these.`
        : ' before anything was broadcast; nothing is in flight and a re-run is safe.'),
  )
}

// Evidence-grade: the class is read back off the chain, not trusted from the response.
const deployedClass = await withFallback((p) => p.getClassHashAt(identity.address))
if (BigInt(deployedClass) !== BigInt(OZ_ACCOUNT_CLASS_HASH)) {
  abort(`the deployed address holds class ${deployedClass}, not the OZ class. Session stops here.`)
}
console.log(`account deployed and verified at ${identity.address}`)

// The pipeline proves at head - PROVING_BLOCK_LAG, and the virtual transaction executes
// against THAT block's state — where the account we just deployed does not exist yet.
// Wait until the proving block will contain the deployment, or the prove leg reverts
// with the exact contract-not-deployed failure the deploy leg exists to prevent.
//
// A receipt without a block number cannot anchor that wait, so it ABORTS rather than
// skipping it — a skipped wait is a prove leg racing the deployment, and losing that
// race burns nothing but ends the throwaway (its key dies with this process).
if (deployReceipt.block_number === undefined) {
  abort(
    `the deployment receipt for ${deployTx.transaction_hash} carries no block number, so the ` +
      `proving-lag wait cannot be anchored. The deployment DID land (status SUCCEEDED, class ` +
      `verified) — re-read the receipt and finish manually rather than proving blind.`,
  )
}
// Bounded: ~80 polls at 15s is twenty minutes, several times the worst block cadence
// this chain has shown. A head that has not advanced past the target by then is a
// stalled RPC view or a halted chain, and neither is something to spin on forever.
const ripeAt = deployReceipt.block_number + PROVING_BLOCK_LAG
const HEAD_WAIT_ATTEMPTS = 80
let ripe = false
for (let attempt = 0; attempt < HEAD_WAIT_ATTEMPTS; attempt++) {
  const head = await withFallback((p) => p.getBlockNumber())
  if (head >= ripeAt) {
    ripe = true
    break
  }
  console.log(`waiting for the proving lag: head ${head}, proving becomes safe at ${ripeAt}`)
  await sleep(15_000)
}
if (!ripe) {
  abort(
    `the head did not reach block ${ripeAt} after ${HEAD_WAIT_ATTEMPTS} polls (~20 minutes). ` +
      `The chain or the RPC view is stalled. The throwaway at ${identity.address} is deployed ` +
      `and unregistered; its key dies with this process, so a later re-run starts a FRESH ` +
      `deploy leg — investigate the stall before spending one.`,
  )
}
console.log('')

// ---------------------------------------------------------------------------------
// The bank. From here the relayer's STRK is being spent.
// ---------------------------------------------------------------------------------

const stageAt: Partial<Record<RegistrationStage, number>> = {}
let capturedReceipt: unknown
let provenShape: { proofFactsCount: number; proofChars: number } | undefined

const result = await registerSponsored(
  {
    accountKey: identity.privateKey,
    account,
    appName: 'Passbook',
    relayerUrl: RELAYER_URL,
  },
  {
    // The ceremony stand-in. 1.8's backup gate protects a USER's only copy of a key;
    // this key is a deliberate throwaway that dies with the process, so there is
    // nothing for the ceremony to protect and `true` is the honest answer.
    canRegister: () => true,
    // The PRODUCTION prove, wrapped only to measure: the evidence must state that the
    // broadcast carried both proof_facts and the proof blob, and this is the one moment
    // their sizes are observable. Nothing about the prove itself changes.
    prove: async (proveInput) => {
      const proved = await proveRegistration(proveInput)
      provenShape = { proofFactsCount: proved.proofFacts.length, proofChars: proved.proof.length }
      return proved
    },
    onStage: (stage) => {
      stageAt[stage] = Date.now()
      console.log(`stage ${stage.padEnd(9)} ${new Date().toISOString()}`)
    },
    // The default confirm, plus capture: the receipt is the cost evidence (actual_fee),
    // and this is the one moment it is in hand. Decision logic is confirmFromReceipt,
    // unchanged — the pipeline still owns revert classification.
    confirm: async (transactionHash) => {
      const receipt = await withFallback((p) => p.waitForTransaction(transactionHash))
      capturedReceipt = receipt
      return confirmFromReceipt(receipt)
    },
  },
)

if (!result.ok) {
  const { failure } = result
  console.error(`\nFAILED at stages [${result.stages.join(', ')}]: ${failure.kind}`)
  console.error(JSON.stringify(failure, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
  if (failure.kind === 'confirmation-unknown') {
    console.error(
      `\nSTOP. A transaction MAY be in flight${
        failure.transactionHash ? ` (hash ${failure.transactionHash})` : ' and its hash is unknown'
      }.\n` +
        `Do NOT re-run. Search the chain first — the key is single-use and a second\n` +
        `attempt over a landed registration reverts NON_ZERO_VALUE at full fee:\n` +
        `  ${NET.explorer}/contract/${identity.address}\n` +
        `  (get_public_key(${identity.address}) != 0 on the pool means it landed)`,
    )
  }
  console.error(`\n${OUTPUT_FILE} was NOT written.`)
  process.exit(1)
}

console.log(`\nCONFIRMED ${result.transactionHash} in block ${result.registrationBlock}`)

// The MINIMAL record, written the moment the spend is confirmed and before any
// measurement read gets a chance to throw — the window between "the money moved" and
// "the file exists" is the one this closes. `wx` is exclusive-create, so this line is
// also the concurrent-run lock the startup existsSync check cannot be (two runs can
// both pass it before either spends): whichever run confirms first owns the file, and
// a second writer fails HERE rather than silently overwriting a banked record.
mkdirSync('evidence', { recursive: true })
try {
  writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(
      {
        status: 'confirmed — full measurement pending; if this text survives, the measuring run died and the numbers must be captured from the receipt',
        transactionHash: result.transactionHash,
        block: result.registrationBlock,
        registeredAddress: identity.address,
        confirmedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
} catch (e) {
  console.error(
    `\nTHE REGISTRATION IS CONFIRMED (${result.transactionHash}, block ` +
      `${result.registrationBlock}) but ${OUTPUT_FILE} already exists — another writer got ` +
      `there first (${String(e).slice(0, 120)}). NOT overwriting it. Reconcile the two ` +
      `records by hand; every number above is on-chain under the hash.`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------------
// Measurement. Everything below is reads; nothing else is spent — and the minimal
// record above already holds the hash if any of them throws.
// ---------------------------------------------------------------------------------

const gas = bankedFee(capturedReceipt)
const poolFeeWei = result.feeRow.feeWei
const totalWei = poolFeeWei + gas.amount

// The submitter, read off the chain rather than assumed — AC1 wants the hash to
// independently resolve to a submission from the relayer address.
const tx = (await withFallback((p) => p.getTransactionByHash(result.transactionHash))) as {
  sender_address?: string
}
const submitter = tx.sender_address ?? '(unreadable)'
if (!tx.sender_address || BigInt(tx.sender_address) !== BigInt(relayerAddress)) {
  console.warn(`WARNING: the transaction's sender is ${submitter}, not the relayer — recorded as-is`)
}

// The balance delta is what the wallet actually lost. The RPC hosts lag each other by a
// block, so poll briefly rather than reading once and calling a sync gap a discrepancy.
let relayerBalanceAfter = relayerBalanceBefore
for (let attempt = 0; attempt < 10 && relayerBalanceAfter === relayerBalanceBefore; attempt++) {
  await sleep(3_000)
  relayerBalanceAfter = await strkBalance(relayerAddress)
}
const deltaWei = relayerBalanceBefore - relayerBalanceAfter
const deltaMatchesTotal = deltaWei === totalWei

const proveMs =
  stageAt.prove !== undefined && stageAt.relay !== undefined ? stageAt.relay - stageAt.prove : null

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString())
const out = {
  purpose:
    'story 1.13 / FR-019 — the one banked sponsored registration on mainnet, with its measured cost',
  registration: {
    transactionHash: result.transactionHash,
    block: result.registrationBlock,
    registeredAddress: identity.address,
    identityPublicKey: identity.publicKey,
    submitter,
    stages: result.stages,
  },
  cost: {
    poolFeeWei: poolFeeWei.toString(),
    gasWei: gas.amount.toString(),
    gasUnit: gas.unit,
    totalWei: totalWei.toString(),
    totalStrk: formatStrk(totalWei),
    how:
      'poolFee = get_fee_amount read live at the build stage (the approve leg covers it); ' +
      'gas = the receipt actual_fee the relayer paid; total = what the relayer wallet lost',
  },
  crossCheck: {
    relayerBalanceBeforeWei: relayerBalanceBefore.toString(),
    relayerBalanceAfterWei: relayerBalanceAfter.toString(),
    deltaWei: deltaWei.toString(),
    deltaMatchesTotal,
  },
  timing: {
    stages: {
      build: iso(stageAt.build),
      prove: iso(stageAt.prove),
      relay: iso(stageAt.relay),
      confirmed: iso(stageAt.confirmed),
    },
    proveMs,
    note: 'proveMs is the prove-stage wall time: prove stage entry to relay stage entry',
  },
  accountDeployment: {
    required: true,
    why:
      'Discovered live in this session: the prove leg authenticates the registering user via ' +
      "the pool's assert_valid_signature (utils.cairo:383-408 at pinned commit 74841caf), whose " +
      'SRC5 supports_interface probe hard-reverts on an undeployed address. compile_actions as ' +
      'a free view accepts an undeployed sender; proving does not. A sponsored registration ' +
      "can therefore never be a counterfactual account's first transaction.",
    fundingTransactionHash: fundTx.transaction_hash,
    fundedWei: deployFundingWei.toString(),
    deployTransactionHash: deployTx.transaction_hash,
    deployBlock: deployReceipt.block_number ?? null,
    deployFeeWei: deployReceipt.actual_fee?.amount ? BigInt(deployReceipt.actual_fee.amount).toString() : null,
    verifiedClassHash: deployedClass,
    dust:
      'whatever the funded amount left after the deployment fee remains at the throwaway ' +
      'address and is burned with its key when this process exits — the key is never persisted',
  },
  proofOnWire: {
    proofFactsCount: provenShape?.proofFactsCount ?? null,
    proofChars: provenShape?.proofChars ?? null,
    note:
      'The broadcast carried BOTH proof_facts and the proof blob. The sequencer requires the ' +
      'pair — "Proof facts and proof must either both be present or both be absent" — first ' +
      "verified live by this session's broadcasts, contradicting earlier receipt-sampled " +
      'observations: receipts and getTransactionByHash do not echo either field back, so an ' +
      'accepted proven transaction reads as proof-less after the fact.',
  },
  screeningImmunity: {
    confirmed: true,
    note:
      'The fresh address was never screened and the registration still succeeded. The deployed ' +
      "class only verifies a screening attestation when the action span carries a regular-pool " +
      'deposit; a zero-deposit span takes the no-deposit branch, which asserts the attestation ' +
      'is None (privacy.cairo apply_actions, lines 782-797 at pinned commit 74841caf). ' +
      'Registration-phase screening immunity is therefore confirmed in practice, not inferred.',
  },
  funding: {
    transactionHash: funding.transactionHash,
    record: FUNDING_FILE,
  },
  sessionCosts: {
    // Honest accounting, ruled into the record: the first bank attempt's throwaway was
    // deployed and then orphaned when the relay leg exposed the undeployed relayer hot
    // key (discovery 2). Its key was never persisted — by design — so it died with the
    // process and the remainder at the address is burned. Real transactions, real cost.
    //
    // The final evidence file carries TWO MORE entries this block does not write —
    // `throwaway2` (burned to the pre-consumed sponsorship unit) and `throwaway3`
    // (burned to the proof-field wire gap the sequencer exposed) — appended after the
    // banked run from their receipts. This script cannot run again (the evidence guard
    // above), so the literals here record only what was known when it last could.
    throwaway1: {
      why: 'cost of discovering the relayer hot key was undeployed — deployed, never registered, key burned with its process',
      address: '0x664718e9a08d63e9786f2a8224d509eb76fba7a9064f33bc5893f360cddd0f1',
      fundTransactionHash: '0x30a3341ce1436175070d3a107d4bc3bdfd2bb7d2a1f1a2f4cd0f692c83c5edb',
      deployTransactionHash: '0x56a0082874ece7ada1ca3c465c3bdf29e55f1a91fcf44e526cba81231a99f86',
      fundedWei: '252587504194869888',
      deployFeeWei: '53977524554615808',
      dustBurnedWei: '198609979640254080',
    },
    relayerAccountDeployment: {
      why: 'the relayer hot key had no account contract; nothing it signs works without one',
      transactionHash: '0x12cc3719ca0cf0d905a6e5230f547b88d660087529d2d250141db1ecfaf90c4',
      record: 'evidence/account-deployment.json',
    },
  },
  provenance: {
    network: ACTIVE_NETWORK,
    chainId: NET.chainId,
    pool: NET.pool,
    poolClassHashAtBank: poolClassAtBank,
    prover: NET.prover,
    relayerUrl: RELAYER_URL,
    verifiedAtBlock: pool.blockNumber,
    createdAt: new Date().toISOString(),
  },
}
// Enriches the minimal record this same run wrote at confirmation — a plain write, not
// `wx`, because owning that record is exactly what the exclusive create above proved.
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(`pool fee   ${formatStrk(poolFeeWei)} STRK`)
console.log(`gas        ${formatStrk(gas.amount)} STRK (${gas.unit})`)
console.log(`total      ${formatStrk(totalWei)} STRK`)
console.log(
  `delta      ${formatStrk(deltaWei)} STRK — ${
    deltaMatchesTotal ? 'MATCHES the receipt figures' : 'DOES NOT MATCH the receipt figures'
  }`,
)
console.log(`prove time ${proveMs === null ? '(not captured)' : `${proveMs} ms`}`)
console.log(`\nverify independently:\n  ${NET.explorer}/tx/${result.transactionHash}`)

if (!deltaMatchesTotal) {
  console.error(
    `\nTHE CROSS-CHECK FAILED: the wallet lost ${formatStrk(deltaWei)} STRK but the receipt ` +
      `accounts for ${formatStrk(totalWei)}. The evidence records both, honestly — investigate ` +
      `before the number is quoted anywhere.`,
  )
  process.exit(1)
}
