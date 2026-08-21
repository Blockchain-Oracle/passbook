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
 * How much more than one fee an approve may authorise. This multiple IS the blast
 * radius, so it is derived rather than picked — do not widen it without redoing this:
 *
 *   - What is actually needed is 1x. `collect_fee` pulls exactly one fee per submission.
 *   - Headroom exists for one reason only: the pool's fee is mutable with ZERO upgrade
 *     delay, so it can change between our read and the execution.
 *   - It is sized against precedent, not imagination. The largest fee change in this
 *     pool's history is 4 -> 6 STRK, or 1.5x. Two covers a repeat of the worst observed
 *     jump, with margin, and nothing beyond it.
 *   - The failure directions are asymmetric, which is what settles the number. Too
 *     tight and the transaction reverts, costing gas. Too loose and a funded wallet
 *     carries standing spend authority. Bias toward the revert.
 *
 * What makes this a ceiling rather than a per-request rate limit: ERC-20 `approve`
 * SETS the allowance, it does not add to it. So the standing authority at any instant
 * is this multiple times the fee — repeated requests overwrite, they do not accumulate.
 */
export const APPROVE_FEE_MULTIPLE = 2n

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

/**
 * Whether this batch needs the fee-derived ceiling — i.e. whether it contains anything
 * that will reach the approve check. Lets the server skip a live RPC read for batches
 * that have no approve in them, so chain availability is not a precondition for
 * accepting every submission.
 *
 * Deliberately the same predicate `assertCallAllowed` uses to route to the approve
 * branch. It fails closed in both directions: a malformed address returns false here
 * and is then refused on shape, and anything that reaches the approve check without a
 * ceiling is refused for having no bound. Neither path can sign an unbounded approve.
 */
export function needsApproveCeiling(calls: Call[]): boolean {
  return calls.some(
    (call) =>
      typeof call?.contractAddress === 'string' &&
      FELT_HEX.test(call.contractAddress) &&
      sameAddress(call.contractAddress, STRK_TOKEN) &&
      call.entrypoint === 'approve',
  )
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
