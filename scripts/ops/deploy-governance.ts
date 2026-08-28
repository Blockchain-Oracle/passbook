//
// Declares + deploys Governance (Houses) to SN_MAIN — M7's step 0, in
// `deploy-markets-launch.ts`'s exact shape: dry run by default, `--execute` spends.
//
//   npx tsx scripts/ops/deploy-governance.ts              # checks only, spends nothing
//   npx tsx scripts/ops/deploy-governance.ts --estimate   # + fee estimate, spends nothing
//   npx tsx scripts/ops/deploy-governance.ts --execute    # SPENDS REAL STRK
//
// THE EVIDENCE MERGES rather than replaces: `evidence/markets-launch-deployment.json` is the one
// file the relayer boots from and the web builds from, so Governance lands as a key in it beside
// Markets and Launch — with the deploy BLOCK, which is the Teller's event-scan floor.
//
// GATE DISCIPLINE (docs/governance.md §13): this script does NOT touch `strk20.json`. The
// Governor enters the manifest in the same commit as its first qualifying transactions — the
// airlock — and a deploy is not one of them.
//
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Account, RpcProvider, hash, json } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnv } from '../../packages/protocol/src/env.js'
import { EXPECTED_POOL_CLASS_HASH } from '../../packages/protocol/src/message-book.js'

const envFile = loadDotEnv()

/**
 * The class hash of the contract that was actually reviewed and tested — computed from the
 * artifacts of the committed source (18 snforge tests green, the accumulator cross-pinned to
 * governance-commitment.test.ts) on 28 Aug 2026. A drift here means the Cairo changed after
 * review; the script stops rather than paying for bytes nobody looked at.
 */
const GOVERNANCE_CLASS_HASH = '0x7240c52656a0a5250649b4db768fbe6ad43e794b11d036ebb19904ff4bb8f20'

const ARTIFACT = 'contracts/target/dev/strk20_app_Governance'
const OUTPUT_FILE = 'evidence/markets-launch-deployment.json'

/**
 * Floor for one declare plus one UDC deploy plus headroom. MEASURED 28 Aug via
 * `estimateDeclareFee`: 137.72 STRK for the declare — the 845 KiB class (the EC accumulator
 * machinery is most of it) prices like Markets-plus. `--estimate` prints the live number;
 * trust it over this constant.
 */
const MIN_BALANCE_WEI = 150n * 10n ** 18n

const SUPPORTED_SPEC = new Set(['0.9.0', '0.10.0', '0.10.2', '0.10.3'])

const execute = process.argv.includes('--execute')
const wantEstimate = process.argv.includes('--estimate')

type Status = 'PASS' | 'FAIL' | 'SKIP'
const checks: { status: Status; name: string; detail: string }[] = []
const record = (status: Status, name: string, detail: string) => checks.push({ status, name, detail })

const fmtStrk = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(4)} STRK`

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
  return BigInt(r[0]!) + (BigInt(r[1] ?? '0x0') << 128n)
}

// ── Pre-flight — all free, all before anything is signed ─────────────────────────────────

const { DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY } = process.env

record(envFile.loaded ? 'PASS' : 'SKIP', '.env', envFile.loaded ? `loaded ${envFile.path}` : (envFile.reason ?? 'not loaded'))
if (DEPLOYER_ADDRESS) record('PASS', 'DEPLOYER_ADDRESS', DEPLOYER_ADDRESS)
else record('FAIL', 'DEPLOYER_ADDRESS', 'not set — see .env.example')
if (DEPLOYER_PRIVATE_KEY) record('PASS', 'DEPLOYER_PRIVATE_KEY', 'set (not read in dry run)')
else record('FAIL', 'DEPLOYER_PRIVATE_KEY', 'not set — see .env.example')
if (ACTIVE_NETWORK === 'mainnet') record('PASS', 'ACTIVE_NETWORK', 'mainnet')
else record('FAIL', 'ACTIVE_NETWORK', `"${ACTIVE_NETWORK}" — production ships on mainnet`)

let sierra: ReturnType<typeof json.parse> | null = null
let casm: ReturnType<typeof json.parse> | null = null
let compiledClassHash = ''
{
  const sierraPath = `${ARTIFACT}.contract_class.json`
  const casmPath = `${ARTIFACT}.compiled_contract_class.json`
  if (!existsSync(sierraPath) || !existsSync(casmPath)) {
    record('FAIL', 'Governance artifacts', 'missing — run: cd contracts && scarb build')
  } else {
    try {
      sierra = json.parse(readFileSync(sierraPath, 'utf8'))
      casm = json.parse(readFileSync(casmPath, 'utf8'))
      const classHash = hash.computeContractClassHash(sierra)
      compiledClassHash = hash.computeCompiledClassHash(casm)
      if (classHash === GOVERNANCE_CLASS_HASH) {
        record('PASS', 'Governance class hash', `${classHash} (${(statSync(sierraPath).size / 1024).toFixed(1)} KiB)`)
      } else {
        record('FAIL', 'Governance class hash', `computed ${classHash}\n      expected ${GOVERNANCE_CLASS_HASH} — the source changed after review`)
        sierra = null
      }
    } catch (e) {
      record('FAIL', 'Governance artifacts', `do not parse: ${String(e).slice(0, 120)}`)
    }
  }
}

// The evidence file must already exist — this run MERGES into it and must not invent the rest.
let evidence: Record<string, unknown> | null = null
if (existsSync(OUTPUT_FILE)) {
  try {
    evidence = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as Record<string, unknown>
    record('PASS', 'evidence file to merge into', `${OUTPUT_FILE} (Markets ${(evidence.Markets as { contractAddress?: string })?.contractAddress ? 'present' : 'ABSENT'})`)
  } catch (e) {
    record('FAIL', 'evidence file to merge into', `does not parse: ${String(e).slice(0, 120)}`)
  }
} else {
  record('FAIL', 'evidence file to merge into', `${OUTPUT_FILE} missing — deploy Markets/Launch first`)
}

try {
  const chainId = await read((p) => p.getChainId())
  const ok = BigInt(chainId) === BigInt(NET.chainId)
  record(ok ? 'PASS' : 'FAIL', 'RPC reports SN_MAIN', ok ? chainId : `RPC says ${chainId}`)
} catch (e) {
  record('FAIL', 'RPC reports SN_MAIN', String(e).slice(0, 120))
}

try {
  const poolClass = await read((p) => p.getClassHashAt(NET.pool))
  if (BigInt(poolClass) === BigInt(EXPECTED_POOL_CLASS_HASH)) {
    record('PASS', 'pool implementation unchanged', poolClass)
  } else {
    record('FAIL', 'pool implementation unchanged', `pool is now ${poolClass} — re-verify ComputeAndInvoke against it before spending`)
  }
} catch (e) {
  record('FAIL', 'pool implementation unchanged', String(e).slice(0, 120))
}

const declareHost = await pickDeclareHost()
if (declareHost) record('PASS', 'declare RPC spec version', `${declareHost.nodeUrl} serves ${declareHost.spec}`)

let declared: boolean | null = null
if (sierra) {
  declared = await isDeclared(GOVERNANCE_CLASS_HASH)
  if (declared === true) record('PASS', 'already declared', 'yes — declare will be skipped')
  else if (declared === false) record('PASS', 'already declared', 'no — will declare')
  else record('FAIL', 'already declared', 'UNKNOWN — refusing to guess')
}

if (DEPLOYER_ADDRESS) {
  try {
    const accountClass = await read((p) => p.getClassHashAt(DEPLOYER_ADDRESS))
    record('PASS', 'deployer account deployed', `class ${accountClass}`)
  } catch (e) {
    record('FAIL', 'deployer account deployed', String(e).slice(0, 160))
  }
  try {
    const balance = await strkBalance(DEPLOYER_ADDRESS)
    record(
      balance >= MIN_BALANCE_WEI ? 'PASS' : 'FAIL',
      'deployer STRK balance',
      `${fmtStrk(balance)} against a ${fmtStrk(MIN_BALANCE_WEI)} floor`,
    )
  } catch (e) {
    record('FAIL', 'deployer STRK balance', String(e).slice(0, 120))
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────

const mark = { PASS: '  ok  ', FAIL: ' FAIL ', SKIP: ' skip ' }
console.log(`\nGovernance deploy — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`)
for (const c of checks) console.log(`[${mark[c.status]}] ${c.name.padEnd(32)} ${c.detail}`)

const failed = checks.filter((c) => c.status === 'FAIL')

if (wantEstimate && !failed.length && DEPLOYER_ADDRESS && DEPLOYER_PRIVATE_KEY && sierra && declared === false) {
  const account = new Account({
    provider: new RpcProvider({ nodeUrl: declareHost?.nodeUrl ?? NET.rpc[0] }),
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  })
  try {
    const fee = await account.estimateDeclareFee({ contract: sierra, casm })
    console.log(`\ndeclare estimate: ${fmtStrk(BigInt(fee.overall_fee))} (the deploy lands on top)`)
  } catch (e) {
    console.log(`\ndeclare estimate unavailable: ${String(e).slice(0, 160)}`)
  }
}

if (failed.length) {
  console.error(`\nNOT READY — ${failed.length} failed: ${failed.map((c) => c.name).join(', ')}`)
  process.exit(1)
}

if (!execute) {
  console.log(
    `\nREADY. Spent nothing, wrote nothing. Would: ${declared === true ? 'skip declare (exists)' : 'declare'} + deploy (pool)\n` +
      `\nTo spend real STRK:\n  npx tsx scripts/ops/deploy-governance.ts --execute\n`,
  )
  process.exit(0)
}

// ── From here down it costs money ────────────────────────────────────────────────────────

const provider = new RpcProvider({ nodeUrl: declareHost!.nodeUrl })
const account = new Account({ provider, address: DEPLOYER_ADDRESS!, signer: DEPLOYER_PRIVATE_KEY! })

let declareTx: string | null = null
if (declared !== true) {
  console.log(`\ndeclaring Governance (${GOVERNANCE_CLASS_HASH}) ...`)
  const res = await account.declare({ contract: sierra!, casm: casm! })
  await provider.waitForTransaction(res.transaction_hash)
  declareTx = res.transaction_hash
  console.log(`  declared in ${declareTx}`)
} else {
  console.log('\nGovernance class already declared — skipping declare')
}

console.log('  deploying Governance(pool) ...')
const res = await account.deployContract({
  classHash: GOVERNANCE_CLASS_HASH,
  constructorCalldata: [NET.pool],
})
await provider.waitForTransaction(res.transaction_hash)
const contractAddress = res.contract_address
const onChain = await read((p) => p.getClassHashAt(contractAddress))
if (BigInt(onChain) !== BigInt(GOVERNANCE_CLASS_HASH)) {
  throw new Error(`Governance at ${contractAddress} holds class ${onChain}, not ${GOVERNANCE_CLASS_HASH}`)
}
const blockNumber = await read((p) => p.getBlockNumber())
console.log(`  deployed at ${contractAddress} (verified) at block ~${blockNumber}`)

const merged = {
  ...evidence,
  Governance: {
    classHash: GOVERNANCE_CLASS_HASH,
    compiledClassHash,
    declareTx: declareTx ?? 'class was already declared before this run',
    deployTx: res.transaction_hash,
    contractAddress,
    // The Teller's event-scan floor: BallotCast events cannot predate the deploy.
    blockNumber,
    deployedAt: new Date().toISOString(),
  },
}
writeFileSync(OUTPUT_FILE, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`\nmerged Governance into ${OUTPUT_FILE}`)
console.log(merged.Governance)
console.log(
  '\nNEXT: set RELAYER_GOVERNANCE_FROM_BLOCK on Fly to the blockNumber above, redeploy the ' +
    'relayer, and run the first pool transaction — the Governor enters strk20.json in THAT commit.',
)
