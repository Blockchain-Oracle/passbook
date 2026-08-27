//
// Declares LaunchToken and declares+deploys Markets and Launch to SN_MAIN — the Wave 3 step 0.
//
// DRY RUN IS THE DEFAULT AND SPENDING REQUIRES `--execute`, inherited verbatim from
// `deploy-message-book.ts`, which put one contract on mainnet with this exact shape. Three
// classes ride one run because their order is load-bearing: Launch's CONSTRUCTOR takes
// LaunchToken's class hash (graduate() deploys from it), so the token class must exist before
// Launch does, and doing them in one script makes that ordering a property of the code rather
// than of somebody's memory at 1am.
//
//   npx tsx scripts/ops/deploy-markets-launch.ts              # checks only, spends nothing
//   npx tsx scripts/ops/deploy-markets-launch.ts --estimate   # + fee estimates, spends nothing
//   npx tsx scripts/ops/deploy-markets-launch.ts --execute    # SPENDS REAL STRK
//
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { Account, RpcProvider, hash, json } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnv } from '../../packages/protocol/src/env.js'
import { EXPECTED_POOL_CLASS_HASH } from '../../packages/protocol/src/message-book.js'

const envFile = loadDotEnv()

/**
 * Pragma's mainnet oracle — pinned from a LIVE get_data_median read banked in
 * `evidence/day0-markets-launch-checks.json` (BTC/ETH/STRK, 10-11 sources, block 13955303),
 * never retyped from memory. The dry run below re-probes it, so a stale pin cannot ship.
 */
const PRAGMA_ADDRESS = '0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b'

/**
 * The class hashes of the contracts that were actually reviewed and tested — computed from the
 * artifacts of the committed source (db233df: 109 snforge tests green) on 27 Aug 2026. If a
 * computed hash stops matching, the Cairo changed after review; the script stops rather than
 * paying for bytes nobody looked at. Update deliberately, in the same commit as the change.
 */
const LAUNCH_TOKEN_CLASS_HASH =
  '0x6bc12b93be701b35f48d30acdf4caddf9fe603a3d7ca4f2ce8444a175262782'

interface DeployTarget {
  name: string
  artifact: string
  expectedClassHash: string
  deploy: boolean
  constructorCalldata?: () => string[]
  constructorNote?: string
}

const CONTRACTS: DeployTarget[] = [
  {
    name: 'LaunchToken',
    artifact: 'contracts/target/dev/strk20_app_LaunchToken',
    expectedClassHash: LAUNCH_TOKEN_CLASS_HASH,
    deploy: false, // declare only — graduate() deploys instances of it later
  },
  {
    name: 'Markets',
    artifact: 'contracts/target/dev/strk20_app_Markets',
    expectedClassHash: '0x750ec8f6c6c96f1e66129f84ac8ca798973bb3e5fd9384269706a7e079f4388',
    deploy: true,
    constructorCalldata: () => [NET.pool, PRAGMA_ADDRESS],
    constructorNote: '(pool, pragma)',
  },
  {
    name: 'Launch',
    artifact: 'contracts/target/dev/strk20_app_Launch',
    expectedClassHash: '0x7c4a3f7cd257beb5a8243fb1cd3ac3e5f59b36f08a436bbd657ef214c970d22',
    deploy: true,
    // The token CLASS hash, not an address — graduate() deploy_syscalls from it.
    constructorCalldata: () => [NET.pool, LAUNCH_TOKEN_CLASS_HASH],
    constructorNote: '(pool, launch_token_class_hash)',
  },
]

const OUTPUT_FILE = 'evidence/markets-launch-deployment.json'

/**
 * Floor for the whole run: three declares plus two UDC deploys. MessageBook's declare measured
 * ~8.66 STRK; Markets and Launch are larger classes. 60 STRK of headroom against the deployer's
 * live 81.7 keeps a mid-run gas move from stranding the sequence half-done — the worst outcome,
 * because a half-deployed pair means Launch's constructor argument exists but Launch does not.
 * `--estimate` prints the live numbers; trust those over this floor.
 */
const MIN_BALANCE_WEI = 60n * 10n ** 18n

const SUPPORTED_SPEC = new Set(['0.9.0', '0.10.0', '0.10.2', '0.10.3'])

const execute = process.argv.includes('--execute')
const wantEstimate = process.argv.includes('--estimate')

type Status = 'PASS' | 'FAIL' | 'SKIP'
const checks: { status: Status; name: string; detail: string }[] = []
const record = (status: Status, name: string, detail: string) =>
  checks.push({ status, name, detail })

const fmtStrk = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(4)} STRK`
const sizeOf = (p: string) => `${(statSync(p).size / 1024).toFixed(1)} KiB`

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

/** Three-valued: `false` = chain says absent, `null` = could not find out. Only `false`
 * justifies paying to declare — see deploy-message-book.ts for the duplicate-declare story. */
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

// ---------------------------------------------------------------------------------
// Pre-flight — all free, all before anything is signed.
// ---------------------------------------------------------------------------------

const { DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY } = process.env

record(
  envFile.loaded ? 'PASS' : 'SKIP',
  '.env',
  envFile.loaded ? `loaded ${envFile.path}` : (envFile.reason ?? 'not loaded'),
)
if (DEPLOYER_ADDRESS) record('PASS', 'DEPLOYER_ADDRESS', DEPLOYER_ADDRESS)
else record('FAIL', 'DEPLOYER_ADDRESS', 'not set — see .env.example')
if (DEPLOYER_PRIVATE_KEY) record('PASS', 'DEPLOYER_PRIVATE_KEY', 'set (not read in dry run)')
else record('FAIL', 'DEPLOYER_PRIVATE_KEY', 'not set — see .env.example')
if (ACTIVE_NETWORK === 'mainnet') record('PASS', 'ACTIVE_NETWORK', 'mainnet')
else record('FAIL', 'ACTIVE_NETWORK', `"${ACTIVE_NETWORK}" — production ships on mainnet`)

type Loaded = {
  sierra: ReturnType<typeof json.parse>
  casm: ReturnType<typeof json.parse>
  classHash: string
  compiledClassHash: string
  declared: boolean | null
}
const loaded = new Map<string, Loaded>()

for (const c of CONTRACTS) {
  const sierraPath = `${c.artifact}.contract_class.json`
  const casmPath = `${c.artifact}.compiled_contract_class.json`
  if (!existsSync(sierraPath) || !existsSync(casmPath)) {
    record('FAIL', `${c.name} artifacts`, `missing — run: cd contracts && scarb build`)
    continue
  }
  try {
    const sierra = json.parse(readFileSync(sierraPath, 'utf8'))
    const casm = json.parse(readFileSync(casmPath, 'utf8'))
    const classHash = hash.computeContractClassHash(sierra)
    const compiledClassHash = hash.computeCompiledClassHash(casm)
    if (classHash === c.expectedClassHash) {
      record('PASS', `${c.name} class hash`, `${classHash}  (${sizeOf(sierraPath)})`)
    } else {
      record(
        'FAIL',
        `${c.name} class hash`,
        `computed ${classHash}\n      expected ${c.expectedClassHash} — the source changed after review`,
      )
    }
    loaded.set(c.name, { sierra, casm, classHash, compiledClassHash, declared: null })
  } catch (e) {
    record('FAIL', `${c.name} artifacts`, `do not parse: ${String(e).slice(0, 120)}`)
  }
}

// Artifacts must postdate every .cairo source, or the hash check above is a stale file
// agreeing with itself.
if (loaded.size === CONTRACTS.length) {
  const oldestArtifact = Math.min(
    ...CONTRACTS.flatMap((c) => [
      statSync(`${c.artifact}.contract_class.json`).mtimeMs,
      statSync(`${c.artifact}.compiled_contract_class.json`).mtimeMs,
    ]),
  )
  const stale = readdirSync('contracts/src')
    .filter((f) => f.endsWith('.cairo'))
    .filter((f) => statSync(`contracts/src/${f}`).mtimeMs > oldestArtifact)
  if (stale.length) {
    record('FAIL', 'artifacts newer than sources', `${stale.join(', ')} changed after the last build`)
  } else {
    record('PASS', 'artifacts newer than sources', 'no .cairo file newer than the artifacts')
  }
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
    record(
      'FAIL',
      'pool implementation unchanged',
      `pool is now ${poolClass} — re-run the compile_actions probes before spending anything`,
    )
  }
} catch (e) {
  record('FAIL', 'pool implementation unchanged', String(e).slice(0, 120))
}

// The oracle Markets' resolve() will read, probed live rather than trusted from the pin.
try {
  const r = await read((p) =>
    p.callContract({
      contractAddress: PRAGMA_ADDRESS,
      entrypoint: 'get_data_median',
      calldata: ['0x0', '0x4254432f555344'], // SpotEntry(BTC/USD)
    }),
  )
  const price = BigInt(r[0] ?? '0x0')
  if (price > 0n) {
    record('PASS', 'Pragma answers BTC/USD', `price ${price} (8 decimals), ${BigInt(r[3] ?? '0x0')} sources`)
  } else {
    record('FAIL', 'Pragma answers BTC/USD', 'zero price — the oracle pin is wrong or the feed is dead')
  }
} catch (e) {
  record('FAIL', 'Pragma answers BTC/USD', String(e).slice(0, 120))
}

const declareHost = await pickDeclareHost()
if (declareHost) {
  record('PASS', 'declare RPC spec version', `${declareHost.nodeUrl} serves ${declareHost.spec}`)
}

for (const c of CONTRACTS) {
  const l = loaded.get(c.name)
  if (!l) continue
  l.declared = await isDeclared(l.classHash)
  if (l.declared === true) record('PASS', `${c.name} already declared`, 'yes — declare will be skipped')
  else if (l.declared === false) record('PASS', `${c.name} already declared`, 'no — will declare')
  else record('FAIL', `${c.name} already declared`, 'UNKNOWN — refusing to guess')
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
      `${fmtStrk(balance)} against a ${fmtStrk(MIN_BALANCE_WEI)} floor for the whole sequence`,
    )
  } catch (e) {
    record('FAIL', 'deployer STRK balance', String(e).slice(0, 120))
  }
}

// ---------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------

const mark = { PASS: '  ok  ', FAIL: ' FAIL ', SKIP: ' skip ' }
console.log(
  `\nMarkets + Launch deploy — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`,
)
for (const c of checks) console.log(`[${mark[c.status]}] ${c.name.padEnd(32)} ${c.detail}`)

const failed = checks.filter((c) => c.status === 'FAIL')

if (wantEstimate && !failed.length && DEPLOYER_ADDRESS && DEPLOYER_PRIVATE_KEY) {
  const account = new Account({
    provider: new RpcProvider({ nodeUrl: declareHost?.nodeUrl ?? NET.rpc[0] }),
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  })
  let total = 0n
  for (const c of CONTRACTS) {
    const l = loaded.get(c.name)!
    if (l.declared === true) {
      console.log(`\n${c.name}: already declared, no declare fee`)
      continue
    }
    try {
      const fee = await account.estimateDeclareFee({ contract: l.sierra, casm: l.casm })
      total += BigInt(fee.overall_fee)
      console.log(`\n${c.name} declare estimate: ${fmtStrk(BigInt(fee.overall_fee))}`)
    } catch (e) {
      console.log(`\n${c.name} declare estimate unavailable: ${String(e).slice(0, 160)}`)
    }
  }
  if (total > 0n) console.log(`\ntotal declare estimate: ${fmtStrk(total)} (deploys land on top)`)
}

if (failed.length) {
  console.error(`\nNOT READY — ${failed.length} failed: ${failed.map((c) => c.name).join(', ')}`)
  process.exit(1)
}

if (!execute) {
  console.log(
    `\nREADY. Spent nothing, wrote nothing. Would, in order:\n` +
      CONTRACTS.map((c) => {
        const l = loaded.get(c.name)!
        const declare = l.declared === true ? 'skip declare (exists)' : 'declare'
        return `  ${c.name}: ${declare}${c.deploy ? ` + deploy ${c.constructorNote}` : ' only'}`
      }).join('\n') +
      `\n\nTo spend real STRK:\n  npx tsx scripts/ops/deploy-markets-launch.ts --execute\n`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------------
// From here down it costs money.
// ---------------------------------------------------------------------------------

const provider = new RpcProvider({ nodeUrl: declareHost!.nodeUrl })
const account = new Account({
  provider,
  address: DEPLOYER_ADDRESS!,
  signer: DEPLOYER_PRIVATE_KEY!,
})

const out: Record<string, unknown> = {
  network: ACTIVE_NETWORK,
  chainId: NET.chainId,
  pragma: PRAGMA_ADDRESS,
  poolClassHash: EXPECTED_POOL_CLASS_HASH,
  declaredVia: declareHost!.nodeUrl,
}

for (const c of CONTRACTS) {
  const l = loaded.get(c.name)!
  let declareTx: string | null = null

  if (l.declared !== true) {
    console.log(`\ndeclaring ${c.name} (${l.classHash}) ...`)
    const res = await account.declare({ contract: l.sierra, casm: l.casm })
    await provider.waitForTransaction(res.transaction_hash)
    declareTx = res.transaction_hash
    console.log(`  declared in ${declareTx}`)
  } else {
    console.log(`\n${c.name} class already declared — skipping declare`)
  }

  let deployTx: string | null = null
  let contractAddress: string | null = null
  if (c.deploy && c.constructorCalldata) {
    const calldata = c.constructorCalldata()
    console.log(`  deploying ${c.name}${c.constructorNote} ...`)
    const res = await account.deployContract({ classHash: l.classHash, constructorCalldata: calldata })
    await provider.waitForTransaction(res.transaction_hash)
    deployTx = res.transaction_hash
    contractAddress = res.contract_address
    // Evidence discipline: the address is verified against the chain, never trusted from the
    // response — getClassHashAt returning OUR hash is independent proof of what is deployed.
    const onChain = await read((p) => p.getClassHashAt(contractAddress!))
    if (BigInt(onChain) !== BigInt(l.classHash)) {
      throw new Error(`${c.name} at ${contractAddress} holds class ${onChain}, not ${l.classHash}`)
    }
    console.log(`  deployed at ${contractAddress} (verified)`)
  }

  out[c.name] = {
    classHash: l.classHash,
    compiledClassHash: l.compiledClassHash,
    declareTx: declareTx ?? 'class was already declared before this run',
    ...(c.deploy ? { deployTx, contractAddress } : { note: 'declare only — graduate() deploys instances' }),
  }
}

out.verifiedAtBlock = await read((p) => p.getBlockNumber())
out.deployedAt = new Date().toISOString()

mkdirSync('evidence', { recursive: true })
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)
console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(out)
