//
// The prove leg of registration: the lone `SetViewingKey`, the span guards that keep it lone,
// and the fee approve that rides with it. Shared with the relayer's groundskeeper.
//

import { hash, type Call } from 'starknet'
import type { DiscoveryProviderInterface, PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'
import { NET, STRK_TOKEN } from './constants.js'
import { createPoolClient } from './client.js'
import { approveCall } from './submit.js'
import { approveCeiling } from './fee-ceiling.js'
import { CLIENT_ACTION } from './message-book.js'

export interface ProvedRegistration {
  call: Call
  proofFacts: string[]
  /** The proof blob. Rides NEXT TO the facts — the sequencer takes both or neither. */
  proof: string
  provingBlockId: number
}

export interface ProveRegistrationInput {
  accountKey: string
  account: PrivateTransfersUser
  provingBlockId: number
}

// Registration compiles without discovery (proved by a free probe). A silent stub would hide the
// day that stops being true, so every method throws.
const REFUSING_DISCOVERY: DiscoveryProviderInterface = {
  discoverNotes: async () => {
    throw new Error('registration must not reach discovery: discoverNotes was called')
  },
  discoverChannels: async () => {
    throw new Error('registration must not reach discovery: discoverChannels was called')
  },
  discoverRequirement: async () => {
    throw new Error('registration must not reach discovery: discoverRequirement was called')
  },
}

const COMPILE_ACTIONS_SELECTOR = hash.getSelectorFromName('compile_actions')

/**
 * Pulls the `Span<ClientAction>` out of a proof invocation's `__execute__` calldata:
 * `[array_len=1, to, selector, inner_len, ...inner]`, `inner = [sender, viewingKey, ...span]`.
 * Target and selector are checked so the assertion is about what the prover works on.
 */
export function extractClientActionSpan(executeCalldata: readonly string[]): bigint[] {
  if (executeCalldata.length < 4) {
    throw new Error(`proof invocation calldata is too short to be an __execute__: ${executeCalldata.length} felts`)
  }
  if (BigInt(executeCalldata[0]!) !== 1n) {
    throw new Error(`refusing a proof invocation carrying ${executeCalldata[0]} calls: registration is exactly one compile_actions`)
  }
  if (BigInt(executeCalldata[1]!) !== BigInt(NET.pool)) {
    throw new Error(`refusing a proof invocation aimed at ${executeCalldata[1]}: expected the pool ${NET.pool}`)
  }
  if (BigInt(executeCalldata[2]!) !== BigInt(COMPILE_ACTIONS_SELECTOR)) {
    throw new Error(`refusing a proof invocation of selector ${executeCalldata[2]}: expected compile_actions`)
  }
  const innerLength = Number(BigInt(executeCalldata[3]!))
  const inner = executeCalldata.slice(4)
  if (inner.length !== innerLength) {
    throw new Error(
      `compile_actions calldata declares ${innerLength} felts but ${inner.length} follow it — ` +
        'a mismatch means part of this invocation went uninspected',
    )
  }
  if (innerLength < 2) {
    throw new Error(`compile_actions calldata carries ${innerLength} felts: too few for even (sender, viewingKey)`)
  }
  return inner.slice(2).map((f) => BigInt(f))
}

/** Exactly `[1, SetViewingKey, random]` — an `autoSetup`/`autoRegister` extra lands a fourth felt here. */
export function assertLoneSetViewingKey(span: readonly bigint[]): void {
  if (span.length !== 3 || span[0] !== 1n) {
    throw new Error(
      `refusing to prove ${span[0] ?? 0} compiled action(s) (${span.length} felts): ` +
        'sponsored registration is a lone SetViewingKey and nothing else',
    )
  }
  if (span[1] !== BigInt(CLIENT_ACTION.SetViewingKey)) {
    throw new Error(`refusing to prove client action variant ${span[1]}: expected SetViewingKey`)
  }
  if (span[2] === 0n) {
    throw new Error('refusing to prove a registration whose encryption randomness is zero — the pool rejects it as ZERO_RANDOM')
  }
}

/** `proof.data` must be a non-empty string: facts without the blob are not a submittable transaction. */
export function proofBlobFrom(proof: unknown): string {
  const data = (proof as { data?: unknown } | undefined)?.data
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('the prover returned no proof blob alongside its facts; the sequencer rejects proof_facts without proof')
  }
  return data
}

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/** Builds and proves the lone `SetViewingKey`. `build()` takes NO options: each one changes the span. */
export async function proveRegistration(input: ProveRegistrationInput): Promise<ProvedRegistration> {
  const { transfers } = createPoolClient(
    { accountKey: input.accountKey, account: input.account },
    { discovery: REFUSING_DISCOVERY },
  )
  const invocation = await transfers.build().register().createProofInvocation({ provingBlockId: input.provingBlockId })
  assertLoneSetViewingKey(extractClientActionSpan(invocation.invocation.calldata))

  const { call, proof } = (await transfers.executeWithInvocation(invocation, input.provingBlockId)).callAndProof
  if (BigInt(call.contractAddress) !== BigInt(NET.pool) || call.entrypoint !== 'apply_actions') {
    throw new Error(`refusing a proven ${call.entrypoint} on ${call.contractAddress}: expected apply_actions on the pool`)
  }
  const proofFacts = [...proof.proofFacts]
  if (proofFacts.length === 0) throw new Error('the prover returned no proof facts; the pool will not accept the transaction')
  const bad = proofFacts.findIndex((f) => typeof f !== 'string' || !FELT.test(f))
  if (bad !== -1) throw new Error(`the prover returned a proof fact that is not a felt at index ${bad}: ${String(proofFacts[bad])}`)

  return { call, proofFacts, proof: proofBlobFrom(proof), provingBlockId: input.provingBlockId }
}

/** `[STRK.approve(pool, ceiling), apply_actions]` — `collect_fee` pulls from the caller, in the same batch. */
export function assembleRegistrationCalls(applyActions: Call, feeWei: bigint): Call[] {
  if (feeWei <= 0n) throw new Error(`refusing to approve a fee of ${feeWei} wei`)
  return [approveCall(STRK_TOKEN, NET.pool, approveCeiling(feeWei)), applyActions]
}
