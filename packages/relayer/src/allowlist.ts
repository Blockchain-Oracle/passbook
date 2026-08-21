import type { Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'

//
// The relayer signs with a funded key and pays the fee. Whatever this file permits,
// anyone who can reach the port can make that key do — so every entry here is spending
// authority granted to the network, and should be read that way before it is widened.
//
// Operational rule that backs this up: fund the relayer with only what the current
// batch needs. The allowlist is the primary control; a small balance is what stops a
// carelessly-widened allowlist from becoming a total loss.
//

/** A real submission is one approve plus a pool call. Anything long is not ours. */
export const MAX_CALLS_PER_SUBMISSION = 8

export interface SubmissionPolicy {
  /** The deployed MessageBook, once evidence/deployment.json exists. */
  messageBook?: string
}

/**
 * Felts have no canonical zero-padding — `0x040337b1…` and `0x40337b1…` are the same
 * address. Comparing these as strings would be both wrong and a bypass, so they are
 * always compared as numbers. A value that will not parse is not an address.
 */
function sameAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

function refuse(call: Call): Error {
  return new Error(
    `refusing to sign ${call.entrypoint} on ${call.contractAddress}: not an allowlisted call`,
  )
}

/**
 * `approve` is permitted only with the pool as spender. An approve to anyone else is a
 * drain with one extra step, so the spender argument is checked, not just the name.
 */
function assertApprovesOnlyThePool(call: Call): void {
  const { calldata } = call
  // Named-argument objects cannot be read positionally. Refuse what cannot be inspected
  // rather than waving through an approve whose spender is unknown to this process.
  if (!Array.isArray(calldata) || calldata.length === 0) {
    throw new Error('refusing STRK.approve: calldata is not an array this server can inspect')
  }
  const spender = calldata[0]
  if (typeof spender !== 'string' && typeof spender !== 'number' && typeof spender !== 'bigint') {
    throw new Error('refusing STRK.approve: the spender argument is not a felt')
  }
  if (!sameAddress(String(spender), NET.pool)) {
    throw new Error(
      `refusing STRK.approve to ${String(spender)}: the pool is the only permitted spender`,
    )
  }
}

function assertCallAllowed(call: Call, policy: SubmissionPolicy): void {
  const to = call.contractAddress

  if (sameAddress(to, NET.pool)) {
    // The submission itself. `compile_actions` is a free view and is never submitted.
    if (call.entrypoint !== 'apply_actions') throw refuse(call)
    return
  }

  if (policy.messageBook && sameAddress(to, policy.messageBook)) {
    // The only external MessageBook exposes; message_count and seal_root are views.
    if (call.entrypoint !== 'privacy_invoke') throw refuse(call)
    return
  }

  if (sameAddress(to, STRK_TOKEN)) {
    // `transfer` here would hand the whole relayer balance to the caller. It is the
    // single most important thing this allowlist exists to refuse.
    if (call.entrypoint !== 'approve') throw refuse(call)
    assertApprovesOnlyThePool(call)
    return
  }

  throw refuse(call)
}

/** Throws unless every call is one the relayer is willing to sign and pay for. */
export function assertSubmittable(calls: Call[], policy: SubmissionPolicy = {}): void {
  if (calls.length > MAX_CALLS_PER_SUBMISSION) {
    throw new Error(
      `refusing a batch of ${calls.length} calls: the limit is ${MAX_CALLS_PER_SUBMISSION}`,
    )
  }
  for (const call of calls) assertCallAllowed(call, policy)
}
