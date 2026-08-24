//
// FREE end-to-end exercise of `register.ts`'s prove leg against the live mainnet prover
// (story 1.12).
//
// TRACKED, not scratch: this is the only thing that runs `proveRegistration` against the
// REAL SDK and the REAL proving service, so it is how you check that the guards still
// match what the SDK produces — the unit tests drive a mocked SDK and hand-built spans.
//
// Proving costs nothing and submits nothing. It stops one step short of the paid
// submission, which is story 1.13's authorised gate and is deliberately not here.
//
//   npx tsx scripts/probes/registration-prove.ts
//
import { Account, RpcProvider } from 'starknet'
import { NET } from '../../packages/protocol/src/constants.js'
import { loadDotEnvVerbose } from '../../packages/protocol/src/env.js'
import { readPoolConstants } from '../../packages/protocol/src/pool.js'
import { preflightRegistration } from '../../packages/protocol/src/registration.js'
import {
  assembleRegistrationCalls,
  proveRegistration,
  PROVING_BLOCK_LAG,
} from '../../packages/protocol/src/register.js'

loadDotEnvVerbose()

const address = process.env.DEPLOYER_ADDRESS
const privateKey = process.env.DEPLOYER_PRIVATE_KEY
if (!address || !privateKey) {
  console.error('DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY must both be set.')
  process.exit(1)
}

const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
const account = new Account({ provider, address, signer: privateKey })

// The probe's stand-in for a root account key. In the app this is generated locally and
// is NEVER a wallet signing key — see identity.ts (D33).
const accountKey = privateKey

const live = await readPoolConstants()
console.log('live pool   :', live)

// Abort unless the slot is actually free, exactly as the compile-actions sibling does.
// `SetViewingKey` is write-once: proving against an address that already holds a key
// produces a proof for a transaction that can only ever revert NON_ZERO_VALUE, and
// reading that output as a green run is how a probe starts lying.
const route = await preflightRegistration(accountKey, address)
console.log('preflight   :', route)
if (route.route !== 'unregistered') {
  console.error(`\nABORT: preflight says "${route.route}". This probe needs an unregistered address.`)
  process.exit(1)
}

const provingBlockId = Math.max(0, live.blockNumber - PROVING_BLOCK_LAG)
console.log(`proving at block ${provingBlockId} (head ${live.blockNumber}, ` +
  `validity window ${live.proofValidityBlocks} blocks)`)

const proved = await proveRegistration({ accountKey, account, provingBlockId })
console.log('\n=== PROVED — nothing submitted ===')
console.log('call        :', proved.call.entrypoint, 'on', proved.call.contractAddress)
console.log('calldata len:', (proved.call.calldata as string[]).length)
console.log('proofFacts  :', proved.proofFacts)

const calls = assembleRegistrationCalls(proved.call, live.feeWei)
console.log('\nsubmission batch:', calls.map((c) => c.entrypoint))
console.log('approve calldata:', calls[0]!.calldata)
console.log('\nThe next step would COST STRK. That is story 1.13, not this probe.')
