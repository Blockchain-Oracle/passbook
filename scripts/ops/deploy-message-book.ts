//
// Declares and deploys `MessageBook` to SN_MAIN.
//
// DRY RUN IS THE DEFAULT AND SPENDING REQUIRES `--execute`. That inversion is the whole
// design. A declare that reverts costs real STRK and cannot be undone, and the deadline
// leaves no room for a second attempt, so every check that can be made for free is made
// before anything is signed, and the default invocation makes all of them and then stops.
//
//   npx tsx scripts/deploy-message-book.ts              # checks only, spends nothing
//   npx tsx scripts/deploy-message-book.ts --estimate   # + a local fee estimate, still spends nothing
//   npx tsx scripts/deploy-message-book.ts --execute    # SPENDS REAL STRK
//
// `starkli 0.4.2` rejects Sierra >= 1.8 and `sncast 0.59` demands RPC 0.10 against
// mainnet's 0.8.x, so neither can do this. starknet.js `declareAndDeploy` is the only
// path that works, which is why this file exists at all rather than being a shell line.
//
// Only the `--execute` path writes evidence/deployment.json. A dry run that wrote a
// deployment record would be writing a claim about mainnet that mainnet does not
// support, into the one directory whose entire purpose is that a judge can trust it.
//
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { Account, RpcProvider, hash, json } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnv } from '../../packages/protocol/src/env.js'
import { EXPECTED_POOL_CLASS_HASH } from '../../packages/protocol/src/message-book.js'

// Must run before anything reads process.env, which the pre-flight below does.
const envFile = loadDotEnv()

const ARTIFACT_BASE = 'contracts/target/dev/strk20_app_MessageBook'
const SIERRA_PATH = `${ARTIFACT_BASE}.contract_class.json`
const CASM_PATH = `${ARTIFACT_BASE}.compiled_contract_class.json`
const OUTPUT_FILE = 'evidence/deployment.json'

/**
 * The class hash of the contract that was actually reviewed and tested, computed from
 * the artifacts on 21 Aug 2026 and independently confirmed to be undeclared on mainnet.
 *
 * If the computed hash stops matching this, the Cairo source changed after review. That
 * is not necessarily wrong — but it means the bytes about to be paid for are not the
 * bytes anyone looked at, so the script stops and says so rather than deploying them.
 * Update this constant deliberately, in the same commit as the contract change.
 */
const EXPECTED_CLASS_HASH =
  '0x52c432b3751ef6e61aa742e6b04a75bd929f2c85e1f2e632df812d424e4460f'

/**
 * A floor with a measured basis, not a round number.
 *
 * `estimateDeclareFee` returns ~8.66 STRK (8655118334796113136 FRI) for this contract,
 * consistently against both hosts, and the UDC deploy invoke lands on top of that. 12
 * STRK leaves headroom for gas-price movement between the check and the broadcast
 * without being so high it rejects a genuinely ready wallet. Use `--estimate` for the
 * live number rather than trusting this one.
 */
const MIN_BALANCE_WEI = 12n * 10n ** 18n

/**
 * RPC spec versions `starknet@10.5.0` will talk to. Mainnet hosts disagree: at the time
 * of writing `rpc.starknet.lava.build` serves 0.8.1 (OUT of window) and
 * `starknet-rpc.publicnode.com` serves 0.10.2 (in window).
 *
 * Reads and even the declare *estimate* work fine against the out-of-window host — but
 * the broadcast and `waitForTransaction` leg is the one thing nobody has exercised, and
 * the most expensive transaction in the project must not be its first test. So the
 * declare picks a host that advertises a supported version, and refuses if none does.
 */
const SUPPORTED_SPEC = new Set(['0.9.0', '0.10.0', '0.10.2', '0.10.3'])

const execute = process.argv.includes('--execute')
const wantEstimate = process.argv.includes('--estimate')

type Status = 'PASS' | 'FAIL' | 'SKIP'
const checks: { status: Status; name: string; detail: string }[] = []
const record = (status: Status, name: string, detail: string) =>
  checks.push({ status, name, detail })

const fmtStrk = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(4)} STRK`
const sizeOf = (p: string) => `${(statSync(p).size / 1024).toFixed(1)} KiB`

/**
 * Reads are done against every configured host rather than just the first, because a
 * single dead RPC must not be able to answer "no" to "is this class already declared?".
 * Answering that wrongly causes a duplicate declare, which is a wasted fee.
 */
async function read<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      return await fn(new RpcProvider({ nodeUrl }))
    } catch (e) {
      last = e
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

/**
 * Returns the first configured host whose advertised spec version starknet@10.5.0 will
 * actually talk to, or null if none will. Deliberately separate from `read()`: reads may
 * use any host that answers, but the broadcast may not.
 */
async function pickDeclareHost(): Promise<{ nodeUrl: string; spec: string } | null> {
  const seen: string[] = []
  for (const nodeUrl of NET.rpc) {
    try {
      const spec = await new RpcProvider({ nodeUrl }).getSpecVersion()
      seen.push(`${nodeUrl} -> ${spec}`)
      if (SUPPORTED_SPEC.has(spec)) return { nodeUrl, spec }
    } catch {
      seen.push(`${nodeUrl} -> unreachable`)
    }
  }
  record('FAIL', 'declare RPC spec version', `no host in window. Saw: ${seen.join(', ')}`)
  return null
}

/**
 * Three-valued on purpose. `false` means the chain told us the class is absent; `null`
 * means we could not find out. Only `false` justifies paying to declare, so the caller
 * must not be able to conflate "absent" with "unknown" — that conflation is exactly how
 * a duplicate declare happens.
 */
async function isDeclared(classHash: string): Promise<boolean | null> {
  let sawNotFound = false
  for (const nodeUrl of NET.rpc) {
    try {
      await new RpcProvider({ nodeUrl }).getClass(classHash)
      return true
    } catch (e) {
      if (/class.?hash.?not.?found|CLASS_HASH_NOT_FOUND|Class hash not found/i.test(String(e))) {
        sawNotFound = true
      }
    }
  }
  return sawNotFound ? false : null
}

async function strkBalance(address: string): Promise<bigint> {
  const r = await read((p) =>
    p.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [address] }),
  )
  // balanceOf returns a u256 as [low, high]. Reading only r[0] silently truncates.
  return BigInt(r[0]!) + (BigInt(r[1] ?? '0x0') << 128n)
}

// ---------------------------------------------------------------------------------
// Pre-flight. Everything below is free, and all of it runs before anything is signed.
// ---------------------------------------------------------------------------------

const { DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY } = process.env

// Where the secrets came from is itself a check. "Not set" reads very differently when
// no .env was found than when one was read and simply lacks the variable.
record(
  envFile.loaded ? 'PASS' : 'SKIP',
  '.env',
  envFile.loaded ? `loaded ${envFile.path}` : (envFile.reason ?? 'not loaded'),
)

if (DEPLOYER_ADDRESS) record('PASS', 'DEPLOYER_ADDRESS', DEPLOYER_ADDRESS)
else record('FAIL', 'DEPLOYER_ADDRESS', 'not set — see .env.example')

// Presence only. The dry run never touches the key; it asserts it will be there so that
// a missing key surfaces here rather than as an opaque signing error mid-deployment.
if (DEPLOYER_PRIVATE_KEY) record('PASS', 'DEPLOYER_PRIVATE_KEY', 'set (not read in dry run)')
else record('FAIL', 'DEPLOYER_PRIVATE_KEY', 'not set — see .env.example')

if (ACTIVE_NETWORK === 'mainnet') record('PASS', 'ACTIVE_NETWORK', 'mainnet')
else record('FAIL', 'ACTIVE_NETWORK', `"${ACTIVE_NETWORK}" — production must ship on mainnet`)

if (NET.pool) record('PASS', 'NET.pool', NET.pool)
else record('FAIL', 'NET.pool', `network "${ACTIVE_NETWORK}" has no pool address configured`)

let sierra: ReturnType<typeof json.parse> | null = null
let casm: ReturnType<typeof json.parse> | null = null
for (const [label, path] of [
  ['sierra artifact', SIERRA_PATH],
  ['casm artifact', CASM_PATH],
] as const) {
  if (!existsSync(path)) {
    record('FAIL', label, `${path} missing — run: cd contracts && scarb build`)
    continue
  }
  try {
    const parsed = json.parse(readFileSync(path, 'utf8'))
    if (label === 'sierra artifact') sierra = parsed
    else casm = parsed
    record('PASS', label, `${path}  ${sizeOf(path)}`)
  } catch (e) {
    record('FAIL', label, `${path} does not parse: ${String(e).slice(0, 120)}`)
  }
}

// `contracts/target/` is gitignored, so nothing otherwise proves the artifact about to
// be declared was built from the committed source rather than from an edit someone made
// and reverted. Comparing mtimes is not a proof of that, but it does catch the common
// case — a .cairo file touched after the last build — and turns the class-hash assertion
// below into a meaningful check rather than a check of a stale file against itself.
if (sierra && casm) {
  const artifactBuilt = Math.min(statSync(SIERRA_PATH).mtimeMs, statSync(CASM_PATH).mtimeMs)
  const sources = readdirSync('contracts/src')
    .filter((f) => f.endsWith('.cairo'))
    .map((f) => ({ f, mtime: statSync(`contracts/src/${f}`).mtimeMs }))
  const stale = sources.filter((s) => s.mtime > artifactBuilt)
  if (stale.length) {
    record(
      'FAIL',
      'artifacts newer than sources',
      `${stale.map((s) => s.f).join(', ')} changed after the last build.\n` +
        `      Run: cd contracts && scarb build && cd ..  — then re-run this script.`,
    )
  } else {
    record('PASS', 'artifacts newer than sources', `${sources.length} .cairo file(s), none newer`)
  }
}

let classHash = ''
let compiledClassHash = ''
if (sierra && casm) {
  classHash = hash.computeContractClassHash(sierra)
  compiledClassHash = hash.computeCompiledClassHash(casm)
  record('PASS', 'compiledClassHash', compiledClassHash)
  if (classHash === EXPECTED_CLASS_HASH) {
    record('PASS', 'classHash matches reviewed build', classHash)
  } else {
    record(
      'FAIL',
      'classHash matches reviewed build',
      `computed ${classHash}\n      expected ${EXPECTED_CLASS_HASH}\n` +
        `      The contract changed since it was reviewed. Re-review it, then update\n` +
        `      EXPECTED_CLASS_HASH in this file in the same commit.`,
    )
  }
} else {
  record('SKIP', 'classHash', 'artifacts unavailable')
}

// Chain ID is checked against the configured value rather than a literal, so that a
// mistake in constants.ts cannot be laundered into agreement by a matching mistake here.
let chainOk = false
try {
  const chainId = await read((p) => p.getChainId())
  chainOk = BigInt(chainId) === BigInt(NET.chainId)
  record(
    chainOk ? 'PASS' : 'FAIL',
    'RPC reports SN_MAIN',
    chainOk ? `${chainId} (SN_MAIN)` : `RPC says ${chainId}, constants say ${NET.chainId}`,
  )
} catch (e) {
  record('FAIL', 'RPC reports SN_MAIN', `could not reach any RPC: ${String(e).slice(0, 120)}`)
}

let blockNumber = 0
try {
  blockNumber = await read((p) => p.getBlockNumber())
  record('PASS', 'RPC reachable', `${NET.rpc.length} host(s), latest block ${blockNumber}`)
} catch (e) {
  record('FAIL', 'RPC reachable', String(e).slice(0, 120))
}

// Spec §10.5. The pool can be upgraded with zero delay, so "it matched when we tested"
// is not a statement about now.
try {
  const poolClass = await read((p) => p.getClassHashAt(NET.pool))
  if (BigInt(poolClass) === BigInt(EXPECTED_POOL_CLASS_HASH)) {
    record('PASS', 'pool implementation unchanged', poolClass)
  } else {
    record(
      'FAIL',
      'pool implementation unchanged',
      `pool is now class ${poolClass}\n      expected ${EXPECTED_POOL_CLASS_HASH}\n` +
        `      The pool was upgraded. Every protocol finding this repository relies on was\n` +
        `      established against the old implementation and is now unverified. Re-run the\n` +
        `      compile_actions probes before spending anything.`,
    )
  }
} catch (e) {
  record('FAIL', 'pool implementation unchanged', `could not read: ${String(e).slice(0, 120)}`)
}

// Only relevant to the broadcast, so it is checked but not fatal to a dry run's purpose.
const declareHost = await pickDeclareHost()
if (declareHost) {
  record(
    'PASS',
    'declare RPC spec version',
    `${declareHost.nodeUrl} serves ${declareHost.spec} (supported)`,
  )
}

let declared: boolean | null = null
if (classHash) {
  declared = await isDeclared(classHash)
  if (declared === true) {
    record('PASS', 'already declared', 'yes — declare will be SKIPPED, deploy only')
  } else if (declared === false) {
    record('PASS', 'already declared', 'no — declare + deploy')
  } else {
    record('FAIL', 'already declared', 'UNKNOWN — no RPC gave a definitive answer, refusing to guess')
  }
} else {
  record('SKIP', 'already declared', 'no class hash to check')
}

// Starknet has no EOAs: the deployer address is counterfactual until a DEPLOY_ACCOUNT
// transaction puts a contract at it, and a declare signed by an address with no contract
// behind it fails validation. Without this check the script reports READY against an
// account that cannot sign, and the failure surfaces mid-declare where it is expensive
// to diagnose.
if (DEPLOYER_ADDRESS) {
  try {
    const accountClass = await read((p) => p.getClassHashAt(DEPLOYER_ADDRESS))
    record('PASS', 'deployer account deployed', `class ${accountClass}`)
  } catch (e) {
    const notFound = /Contract not found|CONTRACT_NOT_FOUND|not found/i.test(String(e))
    record(
      'FAIL',
      'deployer account deployed',
      notFound
        ? `no contract at ${DEPLOYER_ADDRESS}.\n` +
          `      The address is counterfactual until it is deployed, and it cannot sign a\n` +
          `      declare until then. Fund it, then run:\n` +
          `        npx tsx scripts/deploy-account.ts --role=deployer`
        : `could not check: ${String(e).slice(0, 120)}`,
    )
  }
} else {
  record('SKIP', 'deployer account deployed', 'no DEPLOYER_ADDRESS')
}

let balance = -1n
if (DEPLOYER_ADDRESS) {
  try {
    balance = await strkBalance(DEPLOYER_ADDRESS)
    if (balance >= MIN_BALANCE_WEI) {
      record('PASS', 'deployer STRK balance', fmtStrk(balance))
    } else {
      record(
        'FAIL',
        'deployer STRK balance',
        `${fmtStrk(balance)} — below the ${fmtStrk(MIN_BALANCE_WEI)} floor. Fund it, or ` +
          `check DEPLOYER_ADDRESS is the wallet you think it is.`,
      )
    }
  } catch (e) {
    record('FAIL', 'deployer STRK balance', `could not read: ${String(e).slice(0, 120)}`)
  }
} else {
  record('SKIP', 'deployer STRK balance', 'no DEPLOYER_ADDRESS')
}

// ---------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------

const mark = { PASS: '  ok  ', FAIL: ' FAIL ', SKIP: ' skip ' }
console.log(`\nMessageBook deploy — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`)
console.log(
  `network ${ACTIVE_NETWORK} · reads ${NET.rpc[0]} · declares via ${declareHost?.nodeUrl ?? '(none in window)'}\n`,
)
for (const c of checks) console.log(`[${mark[c.status]}] ${c.name.padEnd(30)} ${c.detail}`)

const failed = checks.filter((c) => c.status === 'FAIL')

// A fee estimate signs a declare transaction locally and asks the node what it would
// cost. It submits nothing and changes nothing on chain. It is opt-in because it is the
// one branch here that touches the private key at all.
if (wantEstimate && !failed.length && DEPLOYER_ADDRESS && DEPLOYER_PRIVATE_KEY && sierra && casm) {
  try {
    // starknet@10.5.0 takes an options object. The positional form in the plan
    // (`new Account(provider, address, key)`) is the 6.x signature and does not compile.
    const account = new Account({
      provider: new RpcProvider({ nodeUrl: declareHost?.nodeUrl ?? NET.rpc[0] }),
      address: DEPLOYER_ADDRESS,
      signer: DEPLOYER_PRIVATE_KEY,
    })
    const fee = await account.estimateDeclareFee({ contract: sierra, casm })
    console.log(`\nestimated declare fee: ${fmtStrk(BigInt(fee.overall_fee))} (nothing submitted)`)
  } catch (e) {
    console.log(`\nfee estimate unavailable: ${String(e).slice(0, 200)}`)
  }
} else if (wantEstimate) {
  console.log('\nfee estimate skipped: pre-flight is not clean')
}

if (failed.length) {
  console.error(
    `\nNOT READY — ${failed.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}.` +
      `\nNothing was signed, nothing was spent, and ${OUTPUT_FILE} was NOT written.`,
  )
  process.exit(1)
}

if (!execute) {
  console.log(
    `\nREADY. This run spent nothing and wrote nothing.\n` +
      `Would ${declared === true ? 'DEPLOY ONLY (class already declared)' : 'DECLARE AND DEPLOY'}` +
      ` class ${classHash}\n` +
      `  as ${DEPLOYER_ADDRESS}\n` +
      `  constructor calldata: none (MessageBook has no constructor)\n\n` +
      `To spend real STRK and do it for real:\n` +
      `  npx tsx scripts/deploy-message-book.ts --execute\n`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------------
// From here down it costs money. Nothing above this line did.
// ---------------------------------------------------------------------------------

// The broadcast goes to a host whose spec version starknet@10.5.0 supports, which is not
// necessarily NET.rpc[0]. pickDeclareHost already failed the pre-flight if none qualified.
const provider = new RpcProvider({ nodeUrl: declareHost!.nodeUrl })
const account = new Account({
  provider,
  address: DEPLOYER_ADDRESS!,
  signer: DEPLOYER_PRIVATE_KEY!,
})

/**
 * `null` is not a good enough answer here.
 *
 * `declareAndDeploy` skips the declare when the class already exists and returns
 * `transaction_hash: ""` for it. Writing `""` — or silently coercing it to null — puts a
 * value in the audit trail whose provenance nobody can reconstruct: did the declare fail,
 * was it skipped, or did someone hand-edit the file? So the three cases are named.
 */
type DeclareRecord =
  | { declareTx: string }
  | { declareTx: null; declareNote: 'class was already declared before this run' }

let declareResult: DeclareRecord
let deployTx: string
let contractAddress: string

if (declared === true) {
  // Re-declaring an existing class is refused by the sequencer anyway, but paying to
  // find that out is avoidable, so we do not.
  console.log(`\nclass ${classHash} is already declared — deploying an instance only`)
  // MessageBook has no constructor, so there is nothing to pass.
  const res = await account.deployContract({ classHash, constructorCalldata: [] })
  await provider.waitForTransaction(res.transaction_hash)
  declareResult = { declareTx: null, declareNote: 'class was already declared before this run' }
  deployTx = res.transaction_hash
  contractAddress = res.contract_address
} else {
  console.log(`\ndeclaring and deploying class ${classHash} via ${declareHost!.nodeUrl} ...`)
  const res = await account.declareAndDeploy({ contract: sierra, casm })
  await provider.waitForTransaction(res.deploy.transaction_hash)
  const declareHash = res.declare.transaction_hash
  declareResult = declareHash
    ? { declareTx: declareHash }
    : // declareAndDeploy found the class already on chain between our check and the
      // broadcast, and skipped its declare leg. Nothing was overpaid; say what happened.
      { declareTx: null, declareNote: 'class was already declared before this run' }
  deployTx = res.deploy.transaction_hash
  contractAddress = res.deploy.contract_address
}

// The address is read back from the chain rather than trusted from the response, because
// this record is evidence. `getClassHashAt` returning our class hash is independent
// proof that the thing at that address is the contract we meant to deploy.
const onChainClassHash = await read((p) => p.getClassHashAt(contractAddress))
if (BigInt(onChainClassHash) !== BigInt(classHash)) {
  throw new Error(
    `deployed address ${contractAddress} holds class ${onChainClassHash}, not ${classHash} — ` +
      `NOT writing ${OUTPUT_FILE}`,
  )
}

const out = {
  classHash,
  compiledClassHash,
  contractAddress,
  ...declareResult,
  deployTx,
  network: ACTIVE_NETWORK,
  chainId: NET.chainId,
  // Recorded so the lint, and a judge, can re-derive that the address really holds this
  // class rather than taking the file's word for it. This is the value read back from
  // the chain, not the one we computed locally.
  verifiedClassHashAt: onChainClassHash,
  verifiedAtBlock: await read((p) => p.getBlockNumber()),
  poolClassHash: EXPECTED_POOL_CLASS_HASH,
  declaredVia: declareHost!.nodeUrl,
  deployedAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(out)
console.log(`\nverify independently:\n  ${NET.explorer}/contract/${contractAddress}`)
