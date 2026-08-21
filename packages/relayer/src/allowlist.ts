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
 * SETS the allowance, it does not add to it. Separate requests therefore overwrite one
 * another and cannot accumulate.
 *
 * That is true ACROSS requests and false WITHIN one, which is the distinction an earlier
 * version of this comment blurred — and blurring it is what hid a real bug. A single
 * batch of `[approve, apply_actions, approve, apply_actions, …]` re-sets the allowance
 * between pulls, so N approves in one signed transaction cost N times the fee no matter
 * what this multiple says. `assertSubmittable` therefore refuses any batch carrying more
 * than one approve, and that rule is what makes this number mean what it claims.
 */
export const APPROVE_FEE_MULTIPLE = 2n

/**
 * A hard ceiling that depends on nobody else's number.
 *
 * `APPROVE_FEE_MULTIPLE` bounds us to twice the LIVE fee — but `get_fee_amount()` is set
 * by a pool admin outside this repository, at zero upgrade delay. That is the same
 * mutability the multiple exists to absorb, so on its own the bound reads "twice whatever
 * a third party currently says", which is not a bound at all.
 *
 * 60 STRK is ten times the 6 STRK measured on mainnet: comfortably above any plausible
 * fee change, far below a balance worth losing. The effective ceiling is the LOWER of the
 * two, so a fee rise past 30 STRK stops raising our exposure and starts causing reverts —
 * which is the correct direction to fail when the number is not ours to trust.
 */
export const ABSOLUTE_MAX_APPROVE_WEI = 60_000_000_000_000_000_000n

/** The effective ceiling: whichever of the two bounds binds first. */
export function approveCeiling(liveFeeWei: bigint): bigint {
  const derived = liveFeeWei * APPROVE_FEE_MULTIPLE
  return derived < ABSOLUTE_MAX_APPROVE_WEI ? derived : ABSOLUTE_MAX_APPROVE_WEI
}

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

/**
 * A felt in the two encodings that actually reach this server.
 *
 * Hex is what a hand-written call carries. DECIMAL is what starknet.js emits: verified,
 * `CallData.compile([pool, cairo.uint256(fee)])` returns
 * `["1814936321941532183679178948991547227199883572895129352162421598057876324650",
 *   "6000000000000000000", "0"]`. A hex-only pattern refuses every one of those, so it
 * would have rejected the first real submission the moment compiled calldata was wired
 * in — failing closed, but failing. 76 digits is the felt maximum; 78 leaves margin
 * without admitting free-form text.
 *
 * Still refused, which is the point of validating shape at all: arrays that stringify to
 * an address, whitespace-padded strings, numbers, null, and objects with a toString.
 */
const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/**
 * Never throws. `JSON.stringify` raises TypeError on a bigint, and a refusal whose own
 * formatting throws is exactly the class of failure the server's backstop exists to
 * catch — a security check must not be the thing that creates one.
 */
function describe(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unprintable]'
    }
  }
}

/**
 * `BigInt()` happily parses things that are not addresses — `["0x040337b1…"]` stringifies
 * straight through it, and a padded `"  0x0403…  "` short-string encodes instead. Either
 * would let the allowlist inspect one thing while `__execute__` signs another. Today both
 * merely revert and cost gas, which means the gate is saved by the payload being garbage
 * rather than by the check. So shape is validated before value, everywhere.
 */
function assertFeltAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FELT.test(value)) {
    throw new Error(`refusing ${label}: ${describe(value)} is not a felt address`)
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
  return calls.some(isStrkApprove)
}

function isStrkApprove(call: Call): boolean {
  return (
    typeof call?.contractAddress === 'string' &&
    FELT.test(call.contractAddress) &&
    sameAddress(call.contractAddress, STRK_TOKEN) &&
    call.entrypoint === 'approve'
  )
}

/** Throws unless every call is one the relayer is willing to sign and pay for. */
export function assertSubmittable(calls: Call[], policy: SubmissionPolicy = {}): void {
  if (calls.length > MAX_CALLS_PER_SUBMISSION) {
    throw new Error(
      `refusing a batch of ${calls.length} calls: the limit is ${MAX_CALLS_PER_SUBMISSION}`,
    )
  }

  // The per-call ceiling bounds one approve; a batch can hold eight. Because `approve`
  // SETS the allowance, `[approve, apply_actions, approve, apply_actions, …]` re-arms it
  // between pulls, so four approves cost four fees inside a single signed transaction
  // while every individual call sits under the limit. One approve per batch is what
  // makes the ceiling bound the transaction rather than merely the call.
  const approves = calls.filter(isStrkApprove).length
  if (approves > 1) {
    throw new Error(
      `refusing a batch with ${approves} approves: one submission pays one fee, and ` +
        `re-setting the allowance between calls would multiply it`,
    )
  }

  for (const call of calls) assertCallAllowed(call, policy)
}
