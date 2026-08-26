//
// Sends STRK from the deployer to an address given on the command line.
//
// `fund-relayer.ts` is the same shape with the destination and the amount fixed, because that was
// one authorized decision made once. This one takes both as arguments, because "fund the browser
// account" is a thing that happens more than once and to a different address each time — an
// account derived in a browser is not an address anyone can hardcode.
//
//   npx tsx scripts/ops/fund-address.ts <address> <strk>             # checks only, spends nothing
//   npx tsx scripts/ops/fund-address.ts <address> <strk> --execute   # SPENDS REAL STRK
//
// Dry run is the default and spending needs `--execute`, same as every other script here.
//
// ── WHAT IT REFUSES, AND WHY EACH REFUSAL EXISTS ─────────────────────────────────────────
//
// A destination that is not a felt, an amount that is not positive, a deployer that cannot cover
// the amount plus twice the estimated gas, and an RPC host whose spec version this starknet.js
// cannot broadcast to. The doubled gas is `fund-relayer.ts`'s rule and worth keeping: an estimate
// is not a quote, and a transfer that leaves the sender unable to pay for the transfer is a
// failure that costs a fee to discover.
//
// It does NOT write an evidence file. `fund-relayer.ts` does, because that transfer was a
// one-time, named event in a story. This is an operational top-up and evidence that accumulates
// every time somebody tops something up is evidence nobody reads.
//
import { Account, CallData, RpcProvider, cairo } from 'starknet'
import { ACTIVE_NETWORK, NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'
import { pickBroadcastHost, strkBalance } from './account-lib.js'

const execute = process.argv.includes('--execute')
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const [rawDestination, rawAmount] = positional

function abort(message: string): never {
  console.error(`\nREFUSED: ${message}\n`)
  process.exit(1)
}

const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(6)} STRK`

if (!rawDestination || !rawAmount) {
  abort('usage: npx tsx scripts/ops/fund-address.ts <address> <strk> [--execute]')
}

let destination: string
try {
  destination = `0x${BigInt(rawDestination).toString(16)}`
} catch {
  abort(`the destination ${JSON.stringify(rawDestination)} is not an address`)
}

// Parsed as a decimal STRK figure and scaled exactly. `Number` would lose the low digits of an
// 18-decimal amount, which is the half that decides what actually arrives.
const [whole = '0', fraction = ''] = rawAmount.split('.')
if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d+$/.test(fraction))) {
  abort(`the amount ${JSON.stringify(rawAmount)} is not a number of STRK`)
}
if (fraction.length > 18) abort('STRK has 18 decimals; that amount has more')
const amountWei = BigInt(whole) * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18))
if (amountWei <= 0n) abort('the amount must be greater than zero')

loadDotEnvVerbose()

const deployerAddress = process.env.DEPLOYER_ADDRESS
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
if (!deployerAddress || !deployerKey) {
  abort('DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY must both be set in .env')
}

console.log(`\nfund address — ${execute ? 'EXECUTE (SPENDS REAL STRK)' : 'DRY RUN (spends nothing)'}`)
console.log(`network  ${ACTIVE_NETWORK} (${NET.chainId})`)
console.log(`from     ${deployerAddress}`)
console.log(`to       ${destination}`)
console.log(`amount   ${fmt(amountWei)}\n`)

if (BigInt(destination) === BigInt(deployerAddress)) {
  abort('the destination is the deployer itself — that transfer would only cost gas')
}

const nodeUrl = await pickBroadcastHost()
const provider = new RpcProvider({ nodeUrl })
const account = new Account({ provider, address: deployerAddress, signer: deployerKey })

const before = await strkBalance(deployerAddress)
const destinationBefore = await strkBalance(destination)
console.log(`deployer holds      ${fmt(before)}`)
console.log(`destination holds   ${fmt(destinationBefore)}`)

if (before < amountWei) {
  abort(`the deployer holds ${fmt(before)}, which is less than the ${fmt(amountWei)} requested`)
}

const transfer = {
  contractAddress: STRK_TOKEN,
  entrypoint: 'transfer',
  calldata: CallData.compile([destination, cairo.uint256(amountWei)]),
}

const fee = await account.estimateInvokeFee([transfer])
const estimated = BigInt(fee.overall_fee ?? 0n)
console.log(`estimated gas       ${fmt(estimated)}`)

// TWICE the estimate, per `fund-relayer.ts`: an estimate is not a quote, and discovering the
// shortfall costs a fee.
if (before < amountWei + estimated * 2n) {
  abort(
    `the deployer cannot cover ${fmt(amountWei)} plus twice the estimated gas ` +
      `(${fmt(estimated * 2n)}); it holds ${fmt(before)}`,
  )
}

if (!execute) {
  console.log(
    `\nDRY RUN COMPLETE — nothing was spent.\n` +
      `Would transfer ${fmt(amountWei)} to ${destination} via ${nodeUrl}.\n` +
      `To spend real STRK:\n  npx tsx scripts/ops/fund-address.ts ${rawDestination} ${rawAmount} --execute\n`,
  )
  process.exit(0)
}

console.log(`\nbroadcasting via ${nodeUrl} ...`)
const { transaction_hash } = await account.execute([transfer])
console.log(`transaction ${transaction_hash}`)
await provider.waitForTransaction(transaction_hash)

// Read back rather than trusting the receipt: "the transaction succeeded" is a weaker claim than
// "the money is there now".
const after = await strkBalance(destination)
console.log(`\ndestination now holds ${fmt(after)} (was ${fmt(destinationBefore)})`)
console.log(`deployer now holds    ${fmt(await strkBalance(deployerAddress))}`)
console.log(`\n${NET.explorer}/tx/${transaction_hash}\n`)
