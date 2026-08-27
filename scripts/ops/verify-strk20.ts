//
// Run the JUDGES' OWN verification against our `strk20.json`, before they do.
//
//   npx tsx scripts/ops/verify-strk20.ts
//
// Read-only. Three RPC calls per transaction and one per contract, no signing, nothing spent.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────
//
// `reference/hackathon/scripts/build-projects.mjs` is the indexer the judges run. Its
// `verifyTransactions` decides whether each declared transaction counts, and the rule that has
// already zeroed real projects is subtle enough to get wrong from memory:
//
//   **If `contracts` is non-empty, EVERY declared transaction must ALSO run through one of them.**
//
// Airlock and Mosby Pass both sit at `verified_txs: 0` with real, successful pool transactions
// because of exactly this. While `contracts` is empty the check is skipped entirely (`mine` stays
// `null` and passes) — so the moment our contracts are listed, a transaction that was fine
// yesterday can fail today without anything about it changing.
//
// This file is that rule, transcribed line for line from their source rather than paraphrased, so
// the answer we get here is the answer they will get.
//
// ── THE TWO WAYS A TRANSACTION CAN BE "OURS", AND WHY BOTH MATTER ─────────────────────────
//
// Their check tries events first — an event emitted FROM one of our contract addresses — and falls
// back to scanning the raw calldata for the address. Both are reproduced. Our three evidence
// transactions should pass on EVENTS (`BetPlaced`, `Claimed`, `Bought` all emit from our
// contracts), and if any of them only passes on the calldata fallback that is worth knowing: it
// means the contract did not emit what we expected it to.
//
import { readFileSync } from 'node:fs'

import { NET } from '../../packages/protocol/src/constants.js'

const POOL = NET.pool
const RPC = process.env.MAINNET_RPC_URL || 'https://rpc.starknet.lava.build'

const sameAddress = (a: string, b: string) => {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

async function rpc(method: string, params: unknown[]): Promise<any | null> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json = (await res.json()) as { result?: unknown; error?: unknown }
    return json.error ? null : (json.result ?? null)
  } catch {
    return null
  }
}

/**
 * Which file to check. Defaults to the real submission; a path argument lets a candidate rewrite be
 * rehearsed WITHOUT touching `strk20.json` — which matters, because the file being checked is the
 * one the judges read and a half-edited copy of it is the worst thing to leave lying around.
 */
const target = process.argv[2] ?? 'strk20.json'

const entry = JSON.parse(readFileSync(target, 'utf8')) as {
  transactions?: unknown
  contracts?: unknown
  demo_video?: string
  demo_url?: string
}

console.log(`file: ${target}`)
console.log(`rpc:  ${RPC}`)
console.log(`pool: ${POOL}\n`)

// ── Contracts, resolved the way they resolve them ────────────────────────────────────────
const declaredContracts = Array.isArray(entry.contracts) ? entry.contracts : []
const own: string[] = []

console.log(`contracts (${declaredContracts.length})`)
for (const raw of declaredContracts) {
  const address = typeof raw === 'string' ? raw : (raw as { address?: string })?.address
  if (!address || !/^0x[0-9a-fA-F]+$/.test(address)) {
    console.log(`  FAIL  ${String(address)} is not a felt`)
    continue
  }
  const classHash = await rpc('starknet_getClassHashAt', ['latest', address])
  if (classHash) {
    own.push(address)
    console.log(`  ok    ${address}  class ${String(classHash).slice(0, 14)}…`)
  } else {
    console.log(`  FAIL  ${address} is not deployed on mainnet`)
  }
}
if (declaredContracts.length === 0) {
  console.log('  (none — the mine rule is SKIPPED entirely while this list is empty)')
}

// ── Transactions ─────────────────────────────────────────────────────────────────────────
const declaredTxs = Array.isArray(entry.transactions) ? entry.transactions : []
console.log(`\ntransactions (${declaredTxs.length}${declaredTxs.length > 10 ? ', only the first 10 are read' : ''})`)

let verified = 0
const failures: string[] = []

for (const raw of declaredTxs.slice(0, 10)) {
  const hash = typeof raw === 'string' ? raw.trim() : ''
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(hash)) {
    failures.push(`"${hash}" is not a transaction hash`)
    console.log(`  FAIL  ${hash} — not a transaction hash`)
    continue
  }

  const receipt = await rpc('starknet_getTransactionReceipt', [hash])
  if (!receipt) {
    failures.push(`${hash} not found on mainnet`)
    console.log(`  FAIL  ${hash.slice(0, 14)}… — not found on mainnet`)
    continue
  }

  const events: { from_address: string }[] = receipt.events ?? []
  const ok = receipt.execution_status === 'SUCCEEDED'
  const pool = events.some((e) => sameAddress(e.from_address, POOL))

  // Their exact two-step. `null` when no contracts are declared, which PASSES.
  let mine: boolean | null = null
  let how = 'n/a (no contracts declared)'
  if (own.length) {
    mine = events.some((e) => own.some((a) => sameAddress(e.from_address, a)))
    how = 'events'
    if (!mine) {
      const tx = await rpc('starknet_getTransactionByHash', [hash])
      const calldata: string[] = Array.isArray(tx?.calldata) ? tx.calldata : []
      mine = calldata.some((felt) => own.some((a) => sameAddress(felt, a)))
      how = mine ? 'calldata fallback' : 'neither'
    }
  }

  const short = `${hash.slice(0, 14)}…`
  if (!ok) {
    failures.push(`${hash} reverted`)
    console.log(`  FAIL  ${short} — reverted`)
  } else if (!pool) {
    failures.push(`${hash} did not touch the pool`)
    console.log(`  FAIL  ${short} — did not touch the pool`)
  } else if (mine === false) {
    failures.push(`${hash} touched the pool, but not through this project's contracts`)
    console.log(`  FAIL  ${short} — touched the pool, but not through our contracts`)
  } else {
    verified += 1
    console.log(`  ok    ${short} — pool ✓, mine ✓ (${how}), ${events.length} events`)
    // A transaction that only qualifies through the calldata fallback is passing, but not for the
    // reason we designed it to: our contracts are supposed to EMIT on every evidence path.
    if (how === 'calldata fallback') {
      console.log(`        NOTE: matched on calldata, not events — the contract emitted nothing we own.`)
    }
  }
}

// ── The rest of the file, checked because an empty field is a silent zero ─────────────────
console.log('')
if (!entry.demo_url) console.log('  WARN  demo_url is empty')
if (!entry.demo_video) console.log('  WARN  demo_video is empty')

console.log(`\nverified_txs would be ${verified} of ${declaredTxs.length}.`)
if (failures.length) {
  console.log('\nWhat the judges would see:')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(
    '\nThe mine rule is the usual cause: with a non-empty `contracts`, every listed transaction\n' +
      'must also run through one of them. Dropping an unqualifying transaction is the fix —\n' +
      'emptying `contracts` to make it pass would trade the contracts for the transaction.',
  )
  process.exit(1)
}
console.log('Every declared transaction qualifies.')
