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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Account, RpcProvider, hash, json } from 'starknet'
import { ACTIVE_NETWORK, NET } from '../packages/protocol/src/constants.js'

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

/** STRK, the fee token. Verified live: symbol() = "STRK", decimals() = 18. */
const STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

/**
 * A floor, not an estimate. Its job is to catch an unfunded or wrong wallet before it
 * produces a confusing mid-declare failure, so it is set well below anything that would
 * reject a genuinely ready wallet and well above zero. Measured all-in cost of a pool
 * transaction on this network is ~9.1 STRK; a declare plus deploy of a contract this
 * size is cheaper than that, but not by enough to make 5 STRK an unreasonable bar.
 * Use `--estimate` for a real number.
 */
const MIN_BALANCE_WEI = 5n * 10n ** 18n

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
console.log(`network ${ACTIVE_NETWORK} · rpc ${NET.rpc[0]}\n`)
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
      provider: new RpcProvider({ nodeUrl: NET.rpc[0] }),
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

const provider = new RpcProvider({ nodeUrl: NET.rpc[0] })
const account = new Account({
  provider,
  address: DEPLOYER_ADDRESS!,
  signer: DEPLOYER_PRIVATE_KEY!,
})

let declareTx: string | null = null
let deployTx: string
let contractAddress: string

if (declared === true) {
  // Re-declaring an existing class is refused by the sequencer anyway, but paying to
  // find that out is avoidable, so we do not.
  console.log(`\nclass ${classHash} is already declared — deploying an instance only`)
  const res = await account.deployContract({ classHash, constructorCalldata: [] })
  await provider.waitForTransaction(res.transaction_hash)
  deployTx = res.transaction_hash
  contractAddress = res.contract_address
} else {
  console.log(`\ndeclaring and deploying class ${classHash} ...`)
  const res = await account.declareAndDeploy({ contract: sierra, casm })
  await provider.waitForTransaction(res.deploy.transaction_hash)
  declareTx = res.declare.transaction_hash || null
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
  declareTx,
  deployTx,
  network: ACTIVE_NETWORK,
  chainId: NET.chainId,
  deployedAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(out)
console.log(`\nverify independently:\n  ${NET.explorer}/contract/${contractAddress}`)
