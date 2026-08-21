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

/**
 * How much more than one fee an approve may authorise. Above one because the fee can
 * rise between the read and the submission; small because this multiple IS the blast
 * radius — it is the most a single accepted submission can cost us.
 */
export const APPROVE_FEE_MULTIPLE = 3n

export interface SubmissionPolicy {
  /** The deployed MessageBook, once evidence/deployment.json exists. */
  messageBook?: string
  /**
   * Ceiling for a STRK approve, derived from the LIVE fee — never a hardcoded 6 STRK.
   * Absent means no approve may be signed: without a fee to measure against there is
   * no bound, and an unbounded approve is the balance rather than one submission.
   */
  maxApproveWei?: bigint
}

/** A felt address as it is actually written: 0x-prefixed hex, at most 64 digits. */
const FELT_HEX = /^0x[0-9a-fA-F]{1,64}$/

/**
 * `BigInt()` happily parses things that are not addresses — `["0x040337b1…"]` stringifies
 * straight through it, and a padded `"  0x0403…  "` short-string encodes instead. Either
 * would let the allowlist inspect one thing while `__execute__` signs another. Today both
 * merely revert and cost gas, which means the gate is saved by the payload being garbage
 * rather than by the check. So shape is validated before value, everywhere.
 */
function assertFeltAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FELT_HEX.test(value)) {
    throw new Error(`refusing ${label}: ${JSON.stringify(value)} is not a 0x-prefixed felt address`)
  }
  return value
}

/**
 * Felts have no canonical zero-padding — `0x040337b1…` and `0x40337b1…` are the same
 * address. Comparing these as strings would be both wrong and a bypass, so they are
 * always compared as numbers. Callers validate shape first; this only compares value.
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

const U128_CEILING = 1n << 128n

/**
 * `approve` is permitted only with the pool as spender AND only up to a ceiling drawn
 * from the live fee. The spender check alone is not enough: `approve(pool, MAX_U256)`
 * is a fully allowlisted call that hands the pool the entire balance rather than one
 * fee, which is the difference between losing a submission and losing the wallet.
 */
function assertApproveIsBounded(call: Call, policy: SubmissionPolicy): void {
  const { calldata } = call
  // Named-argument objects cannot be read positionally. Refuse what cannot be inspected
  // rather than waving through an approve whose spender is unknown to this process.
  if (!Array.isArray(calldata)) {
    throw new Error('refusing STRK.approve: calldata is not an array this server can inspect')
  }
  // ERC20 approve(spender: felt, amount: u256) is exactly three felts. A short or long
  // one decodes to something other than what was inspected here.
  if (calldata.length !== 3) {
    throw new Error(
      `refusing STRK.approve: expected 3 calldata felts (spender, amount_low, amount_high), got ${calldata.length}`,
    )
  }

  const spender = assertFeltAddress(calldata[0], 'STRK.approve spender')
  if (!sameAddress(spender, NET.pool)) {
    throw new Error(`refusing STRK.approve to ${spender}: the pool is the only permitted spender`)
  }

  const low = BigInt(assertFeltAddress(calldata[1], 'STRK.approve amount_low'))
  const high = BigInt(assertFeltAddress(calldata[2], 'STRK.approve amount_high'))
  if (low >= U128_CEILING || high >= U128_CEILING) {
    throw new Error('refusing STRK.approve: amount is not a well-formed u256')
  }
  const amount = (high << 128n) | low

  if (policy.maxApproveWei === undefined) {
    throw new Error(
      'refusing STRK.approve: the live fee could not be read, so there is no bound to check it against',
    )
  }
  if (amount > policy.maxApproveWei) {
    throw new Error(
      `refusing STRK.approve of ${amount} wei: above the ${policy.maxApproveWei} wei ceiling drawn from the live fee`,
    )
  }
}

function assertCallAllowed(call: Call, policy: SubmissionPolicy): void {
  const to = assertFeltAddress(call.contractAddress, 'contractAddress')
  if (typeof call.entrypoint !== 'string') {
    throw new Error('refusing a call whose entrypoint is not a string')
  }

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
    assertApproveIsBounded(call, policy)
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
