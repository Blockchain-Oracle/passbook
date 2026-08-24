//
// Deploys an OpenZeppelin account contract to SN_MAIN.
//
// Starknet has no EOAs. An address derived from a keypair is COUNTERFACTUAL until a
// DEPLOY_ACCOUNT transaction creates the contract at it, and a declare signed by an
// address with no contract behind it fails validation. So this runs before anything
// else that signs — including scripts/deploy-message-book.ts.
//
//   npx tsx scripts/deploy-account.ts                      # checks only, spends nothing
//   npx tsx scripts/deploy-account.ts --role=relayer       # the other account
//   npx tsx scripts/deploy-account.ts --execute            # SPENDS REAL STRK
//
// Dry run is the default and spending needs `--execute`, same as the other scripts.
// Only the `--execute` path writes evidence/account-deployment.json.
//
// IDEMPOTENT BY DESIGN. An account that is already deployed is a PASS, not a failure,
// and `--execute` skips it rather than paying twice. This will be re-run.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Account, RpcProvider, ec, hash } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../packages/protocol/src/constants.js'
import { loadDotEnv } from '../packages/protocol/src/env.js'
// The class hash lives in account-lib.ts — an import-safe module — precisely so the
// OTHER session scripts can share it without triggering this file's top-level run.
import { OZ_ACCOUNT_CLASS_HASH } from './account-lib.js'

// Before any process.env read.
const envFile = loadDotEnv()

const OUTPUT_FILE = 'evidence/account-deployment.json'

/**
 * Deploying an account costs far less than declaring a contract, but the account must
 * also survive whatever it is being funded to do next. This floor only guards the
 * deployment itself; `--estimate` output below is the number that matters.
 */
const MIN_BALANCE_WEI = 1n * 10n ** 18n

/** Only hosts serving a spec version starknet@10.5.0 supports may be broadcast to. */
const SUPPORTED_SPEC = new Set(['0.9.0', '0.10.0', '0.10.2', '0.10.3'])

const execute = process.argv.includes('--execute')
const roleArg = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1] ?? 'deployer'
if (roleArg !== 'deployer' && roleArg !== 'relayer') {
  console.error(`--role must be "deployer" or "relayer", got "${roleArg}"`)
  process.exit(1)
}
const role = roleArg as 'deployer' | 'relayer'
const ADDRESS_VAR = role === 'deployer' ? 'DEPLOYER_ADDRESS' : 'RELAYER_ADDRESS'
const KEY_VAR = role === 'deployer' ? 'DEPLOYER_PRIVATE_KEY' : 'RELAYER_PRIVATE_KEY'

type Status = 'PASS' | 'FAIL' | 'SKIP'
const checks: { status: Status; name: string; detail: string }[] = []
const record = (status: Status, name: string, detail: string) =>
  checks.push({ status, name, detail })

const fmtStrk = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(4)} STRK`

async function read<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  const errors: unknown[] = []
  for (const nodeUrl of NET.rpc) {
    try {
      return await fn(new RpcProvider({ nodeUrl }))
    } catch (e) {
      errors.push(e)
    }
  }
  throw new Error(`all RPC hosts failed: ${String(errors[0])}`, { cause: errors })
}

/** Three-valued: `null` means "could not find out", which never justifies spending. */
async function isDeployed(address: string): Promise<string | null | false> {
  let sawNotFound = false
  for (const nodeUrl of NET.rpc) {
    try {
      return await new RpcProvider({ nodeUrl }).getClassHashAt(address)
    } catch (e) {
      if (/Contract not found|CONTRACT_NOT_FOUND|not found/i.test(String(e))) sawNotFound = true
    }
  }
  return sawNotFound ? false : null
}

async function pickBroadcastHost(): Promise<{ nodeUrl: string; spec: string } | null> {
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
  record('FAIL', 'broadcast RPC spec version', `no host in window. Saw: ${seen.join(', ')}`)
  return null
}

// ---------------------------------------------------------------------------------
// Pre-flight — all free, all before anything is signed.
// ---------------------------------------------------------------------------------

record(
  envFile.loaded ? 'PASS' : 'SKIP',
  '.env',
  envFile.loaded ? `loaded ${envFile.path}` : (envFile.reason ?? 'not loaded'),
)

const address = process.env[ADDRESS_VAR]
const privateKey = process.env[KEY_VAR]

if (address) record('PASS', ADDRESS_VAR, address)
else record('FAIL', ADDRESS_VAR, 'not set — see .env.example')
if (privateKey) record('PASS', KEY_VAR, 'set')
else record('FAIL', KEY_VAR, 'not set — see .env.example')

if (ACTIVE_NETWORK === 'mainnet') record('PASS', 'ACTIVE_NETWORK', 'mainnet')
else record('FAIL', 'ACTIVE_NETWORK', `"${ACTIVE_NETWORK}" — production must ship on mainnet`)

/**
 * The address MUST derive from the key, and the derivation is not negotiable: the salt
 * and the constructor calldata are both the public key.
 *
 * If this does not match, the key in `.env` does not control the funded address, and a
 * deployment would create an account at some OTHER address — stranding the funds and
 * costing a fee for a contract nobody can use. It is the single most important check in
 * this file, which is why it stops the run rather than warning.
 */
let publicKey = ''
let derived = ''
if (privateKey && address) {
  try {
    publicKey = ec.starkCurve.getStarkKey(privateKey)
    derived = hash.calculateContractAddressFromHash(
      publicKey, // salt
      OZ_ACCOUNT_CLASS_HASH,
      [publicKey], // constructor calldata
      0, // deployerAddress — 0 for a self-deploying account
    )
    const matches = BigInt(derived) === BigInt(address)
    record(
      matches ? 'PASS' : 'FAIL',
      'address derives from key',
      matches
        ? `${derived} (OZ class, salt = pubkey)`
        : `derived ${derived}\n      but ${ADDRESS_VAR} is ${address}\n` +
          `      The key in .env does not control that address. Deploying would create an\n` +
          `      account somewhere else and strand the funds. Refusing.`,
    )
  } catch (e) {
    record('FAIL', 'address derives from key', `could not derive: ${String(e).slice(0, 140)}`)
  }
} else {
  record('SKIP', 'address derives from key', 'address or key missing')
}

try {
  const chainId = await read((p) => p.getChainId())
  const ok = BigInt(chainId) === BigInt(NET.chainId)
  record(ok ? 'PASS' : 'FAIL', 'RPC reports SN_MAIN', ok ? `${chainId} (SN_MAIN)` : `RPC says ${chainId}`)
} catch (e) {
  record('FAIL', 'RPC reports SN_MAIN', `could not reach any RPC: ${String(e).slice(0, 120)}`)
}

// The account class must exist on chain, or the deployment reverts.
try {
  await read((p) => p.getClass(OZ_ACCOUNT_CLASS_HASH))
  record('PASS', 'OZ account class declared', OZ_ACCOUNT_CLASS_HASH)
} catch (e) {
  record('FAIL', 'OZ account class declared', `${OZ_ACCOUNT_CLASS_HASH} not found: ${String(e).slice(0, 100)}`)
}

let alreadyDeployed: string | null | false = null
if (address) {
  alreadyDeployed = await isDeployed(address)
  if (typeof alreadyDeployed === 'string') {
    const isOz = BigInt(alreadyDeployed) === BigInt(OZ_ACCOUNT_CLASS_HASH)
    record(
      'PASS',
      'account already deployed',
      isOz
        ? `yes, class ${alreadyDeployed} — nothing to do`
        : `yes, but class ${alreadyDeployed} is NOT the OZ class. Left alone.`,
    )
  } else if (alreadyDeployed === false) {
    record('PASS', 'account already deployed', 'no — this is what the deployment fixes')
  } else {
    record('FAIL', 'account already deployed', 'UNKNOWN — no RPC gave a definitive answer')
  }
}

let balance = -1n
if (address) {
  try {
    const r = await read((p) =>
      p.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [address] }),
    )
    balance = BigInt(r[0]!) + (BigInt(r[1] ?? '0x0') << 128n)
    // The account pays for its own deployment out of this balance, so it must be funded
    // BEFORE deployment — which is the opposite of most chains and easy to get wrong.
    if (balance >= MIN_BALANCE_WEI) record('PASS', `${role} STRK balance`, fmtStrk(balance))
    else
      record(
        'FAIL',
        `${role} STRK balance`,
        `${fmtStrk(balance)} — below the ${fmtStrk(MIN_BALANCE_WEI)} floor. The account pays ` +
          `for its own\n      deployment, so it must be funded first. Send STRK to ${address}.`,
      )
  } catch (e) {
    record('FAIL', `${role} STRK balance`, `could not read: ${String(e).slice(0, 120)}`)
  }
}

const broadcastHost = await pickBroadcastHost()
if (broadcastHost) {
  record(
    'PASS',
    'broadcast RPC spec version',
    `${broadcastHost.nodeUrl} serves ${broadcastHost.spec} (supported)`,
  )
}

// ---------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------

const mark = { PASS: '  ok  ', FAIL: ' FAIL ', SKIP: ' skip ' }
console.log(
  `\naccount deploy [${role}] — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`,
)
console.log(`network ${ACTIVE_NETWORK} · broadcast ${broadcastHost?.nodeUrl ?? '(none in window)'}\n`)
for (const c of checks) console.log(`[${mark[c.status]}] ${c.name.padEnd(30)} ${c.detail}`)

const failed = checks.filter((c) => c.status === 'FAIL')

// Already deployed and nothing to do — report success and stop, in both modes. This is
// the idempotent path and it must not look like a failure on a re-run.
if (!failed.length && typeof alreadyDeployed === 'string') {
  console.log(
    `\nNOTHING TO DO — the ${role} account is already deployed at\n  ${address}\n` +
      `Nothing was spent.` +
      (execute ? `\n${OUTPUT_FILE} was NOT rewritten: this run deployed nothing.` : ''),
  )
  process.exit(0)
}

const deployFeeNote =
  privateKey && address && !failed.length && broadcastHost
    ? await (async () => {
        try {
          // Signs locally and asks the node the price. Submits nothing.
          const account = new Account({
            provider: new RpcProvider({ nodeUrl: broadcastHost.nodeUrl }),
            address,
            signer: privateKey,
          })
          const fee = await account.estimateAccountDeployFee({
            classHash: OZ_ACCOUNT_CLASS_HASH,
            constructorCalldata: [publicKey],
            addressSalt: publicKey,
            contractAddress: address,
          })
          return `estimated deployment fee: ${fmtStrk(BigInt(fee.overall_fee))} (nothing submitted)`
        } catch (e) {
          return `fee estimate unavailable: ${String(e).slice(0, 200)}`
        }
      })()
    : null
if (deployFeeNote) console.log(`\n${deployFeeNote}`)

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
      `Would DEPLOY_ACCOUNT the ${role} account:\n` +
      `  address     ${address}\n` +
      `  class       ${OZ_ACCOUNT_CLASS_HASH}\n` +
      `  salt        the public key\n` +
      `  calldata    [the public key]\n\n` +
      `To spend real STRK and do it for real:\n` +
      `  npx tsx scripts/deploy-account.ts --role=${role} --execute\n`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------------
// From here down it costs money. Nothing above this line did.
// ---------------------------------------------------------------------------------

const provider = new RpcProvider({ nodeUrl: broadcastHost!.nodeUrl })
const account = new Account({ provider, address: address!, signer: privateKey! })

console.log(`\ndeploying the ${role} account via ${broadcastHost!.nodeUrl} ...`)
const res = await account.deployAccount({
  classHash: OZ_ACCOUNT_CLASS_HASH,
  constructorCalldata: [publicKey],
  addressSalt: publicKey,
  contractAddress: address!,
})
await provider.waitForTransaction(res.transaction_hash)

// Read back from the chain rather than trusting the response: this record is evidence,
// and "the transaction succeeded" is a weaker claim than "the class is there now".
const onChain = await read((p) => p.getClassHashAt(res.contract_address))
if (BigInt(onChain) !== BigInt(OZ_ACCOUNT_CLASS_HASH)) {
  throw new Error(
    `deployed address ${res.contract_address} holds class ${onChain}, not ` +
      `${OZ_ACCOUNT_CLASS_HASH} — NOT writing ${OUTPUT_FILE}`,
  )
}
if (BigInt(res.contract_address) !== BigInt(address!)) {
  throw new Error(
    `deployed to ${res.contract_address}, not the funded ${address} — NOT writing ${OUTPUT_FILE}`,
  )
}

// Merged, not overwritten: the two roles deploy in separate runs and the second must not
// erase the first's record.
const existing = existsSync(OUTPUT_FILE)
  ? (JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as Record<string, unknown>)
  : {}
const out = {
  ...existing,
  [role]: {
    address: res.contract_address,
    classHash: OZ_ACCOUNT_CLASS_HASH,
    transactionHash: res.transaction_hash,
    verifiedClassHashAt: onChain,
    verifiedAtBlock: await read((p) => p.getBlockNumber()),
    network: ACTIVE_NETWORK,
    chainId: NET.chainId,
    deployedVia: broadcastHost!.nodeUrl,
    deployedAt: new Date().toISOString(),
  },
}
mkdirSync('evidence', { recursive: true })
writeFileSync(OUTPUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

console.log(`\nwrote ${OUTPUT_FILE}`)
console.log(out[role])
console.log(`\nverify independently:\n  ${NET.explorer}/contract/${res.contract_address}`)
