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
// KNOWN RESIDUAL — bounded, accepted, and written down so the next person finds it
// rather than rediscovering it. A submission approves up to the ceiling while
// `collect_fee` pulls one fee, so roughly one fee's worth of allowance can be left
// standing afterwards. Nothing stops a later allowlisted, approve-free submission from
// consuming that remainder. It is bounded because the allowance is never set above the
// ceiling, which is itself capped by ABSOLUTE_MAX_APPROVE_WEI — so the exposure is at
// most one ceiling's worth at any instant, not a growing total. Approving exactly one
// fee would close it, at the cost of reverting whenever the fee moves between the read
// and the execution, which is the risk the multiple exists to absorb.
//

/** A real submission is one approve plus a pool call. Anything long is not ours. */
export const MAX_CALLS_PER_SUBMISSION = 8

// The approve ceiling lives in `protocol/src/fee-ceiling.ts`, because the client that
// BUILDS the approve needs the identical formula — if the two drifted, our own gate would
// refuse every real submission. Moved verbatim; re-exported here so this module's public
// surface, and every existing import of it, is unchanged.
export {
  APPROVE_FEE_MULTIPLE,
  ABSOLUTE_MAX_APPROVE_WEI,
  approveCeiling,
} from '../../protocol/src/fee-ceiling.js'

export interface SubmissionPolicy {
  /** The deployed MessageBook, once evidence/deployment.json exists. */
  messageBook?: string
  /**
   * The deployed Markets contract, once evidence/markets-launch-deployment.json exists.
   *
   * ABSENT MEANS PERMITTED NOTHING, which is the direction that fails safe: before the deploy
   * lands there is no address to compare against, so every call to it is refused by the closing
   * `throw refuse(call)` rather than waved through. Same for `launch`.
   */
  markets?: string
  /** The deployed Launch contract, on the same terms. */
  launch?: string
  /**
   * Ceiling for a STRK approve, derived from the LIVE fee — never a hardcoded 6 STRK.
   * Absent means no approve may be signed: without a fee to measure against there is
   * no bound, and an unbounded approve is the balance rather than one submission.
   */
  maxApproveWei?: bigint
}

/**
 * The direct entrypoints a keeper is allowed to call, per contract.
 *
 * ── WHY THESE THREE AND NOTHING ELSE ──────────────────────────────────────────────────────
 *
 * All three are permissionless by design, take no value, and compute an answer that is a pure
 * function of chain state the caller cannot influence: `resolve` reads Pragma and writes the winner
 * it read, `void` needs a timer to have elapsed, `graduate` needs every unit sold. Signing them
 * spends gas and nothing else — there is no branch of any of them that can pay the caller.
 *
 * That is exactly why they are safe to allowlist and exactly why they are worth allowlisting: a
 * market nobody settles strands everyone's money until `void` opens, and the honest fix is a keeper
 * that cannot do anything except settle markets correctly.
 *
 * `sweep` is deliberately NOT here. It moves the raise to an address the caller names, and while it
 * needs the creator's secret to succeed, an allowlisted `sweep` would mean this key signs
 * transactions carrying somebody's bearer secret in plaintext calldata.
 */
const KEEPER_ENTRYPOINTS = {
  markets: ['resolve', 'void'],
  launch: ['graduate'],
} as const

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

/** The Cairo field order, `2^251 + 17·2^192 + 1`. Every felt is strictly below it. */
const STARK_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n

/**
 * Generous by an order of magnitude and still a bound. The observed mainnet prove returns
 * nine facts; 128 leaves room for a prover that grows its output without this becoming
 * the thing that breaks a real submission, while refusing the thousands a body limit alone
 * would permit.
 */
export const MAX_PROOF_FACTS = 128

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

  // The app contracts. `privacy_invoke` is the pool-facing entrypoint on both; the keeper calls
  // are the permissionless settlement ones. Everything else — `sweep` above all — is refused.
  for (const [name, entrypoints] of Object.entries(KEEPER_ENTRYPOINTS) as [
    'markets' | 'launch',
    readonly string[],
  ][]) {
    const address = policy[name]
    if (address && sameAddress(to, address)) {
      if (call.entrypoint === 'privacy_invoke') return
      if (entrypoints.includes(call.entrypoint)) return
      throw refuse(call)
    }
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
 * Validates the prover facts that ride alongside a submission (story 1.12).
 *
 * They go into the transaction's V3 details rather than into any call's calldata, so
 * `assertSubmittable` never sees them — which is exactly why they need their own gate.
 * They reach `calculateInvokeTransactionHash`, so a value that is not felt-shaped either
 * throws inside signing or, worse, coerces: `BigInt(["0x1"])` is `1n`, and an array that
 * stringifies to a number would be signed as one. Shape before value, same as addresses.
 *
 * Count is capped as well as shape. The body limit alone is not a bound worth having:
 * one megabyte of `"0x1",` is roughly fifteen thousand felts, all of them signed into a
 * transaction this wallet pays the gas for. A real prove returns nine.
 */
export function assertProofFacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`refusing proofFacts: ${describe(value)} is not an array`)
  }
  if (value.length > MAX_PROOF_FACTS) {
    throw new Error(
      `refusing ${value.length} proofFacts: the limit is ${MAX_PROOF_FACTS}, and a real ` +
        'mainnet prove returns nine',
    )
  }
  // An empty array is not "no facts" — it is a caller who meant to send some and sent
  // none. Omitting the field is how a submission says it has none, and the two must not
  // be spelled the same way, or a prover returning nothing looks like a plain submission.
  if (value.length === 0) {
    throw new Error('refusing an empty proofFacts array: omit the field entirely instead')
  }
  // `Array.from`, not `.map`: `map` SKIPS holes. `JSON.parse` cannot produce a sparse
  // array, but this function is exported and the next caller may not be the HTTP body
  // parser — and a hole that skips its own check arrives at signing as `undefined`.
  return Array.from({ length: value.length }, (_, i) => {
    const fact = value[i]
    if (typeof fact !== 'string' || !FELT.test(fact)) {
      throw new Error(`refusing proofFacts[${i}]: ${describe(fact)} is not a felt`)
    }
    // Shape is not range. `FELT` admits 78 decimal digits and 64 hex ones, both of which
    // reach past the Stark prime, and a value above it is reduced modulo P on the way in
    // — so the fact that gets signed is not the fact that was inspected. Refuse instead.
    if (BigInt(fact) >= STARK_PRIME) {
      throw new Error(
        `refusing proofFacts[${i}]: ${fact} is not below the Stark field prime, so it ` +
          'would be silently reduced into a different value than the one checked here',
      )
    }
    return fact
  })
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
  return matches(call, STRK_TOKEN, 'approve')
}

/** Exported so `/submit` can require one before it will carry proofFacts. */
export function isPoolApplyActions(call: Call): boolean {
  return matches(call, NET.pool, 'apply_actions')
}

function isMessageBookInvoke(call: Call, policy: SubmissionPolicy): boolean {
  return policy.messageBook !== undefined && matches(call, policy.messageBook, 'privacy_invoke')
}

/**
 * Every `privacy_invoke` in the batch, across the WHOLE app-contract set rather than per contract.
 *
 * Counted together on purpose. Per-contract counting would permit one invoke on MessageBook plus
 * one on Markets plus one on Launch in a single batch — three of the action the one-per-batch rule
 * exists to bound, each of them individually "at most one". The pool reaches all three through
 * `InvokeExternal` anyway, so a direct call is already the unusual path and there is no flow that
 * legitimately needs two.
 */
function isAppContractInvoke(call: Call, policy: SubmissionPolicy): boolean {
  if (isMessageBookInvoke(call, policy)) return true
  for (const name of ['markets', 'launch'] as const) {
    const address = policy[name]
    if (address !== undefined && matches(call, address, 'privacy_invoke')) return true
  }
  return false
}

/**
 * Every direct keeper call in the batch. Bounded for the same gas reason as the invokes — this
 * wallet is funded for one batch — and because a loop of `resolve` calls is a way to spend the
 * relayer's balance on transactions that each do nothing after the first.
 */
function isKeeperCall(call: Call, policy: SubmissionPolicy): boolean {
  for (const [name, entrypoints] of Object.entries(KEEPER_ENTRYPOINTS) as [
    'markets' | 'launch',
    readonly string[],
  ][]) {
    const address = policy[name]
    if (address === undefined) continue
    if (entrypoints.some((entrypoint) => matches(call, address, entrypoint))) return true
  }
  return false
}

function matches(call: Call, address: string, entrypoint: string): boolean {
  return (
    typeof call?.contractAddress === 'string' &&
    FELT.test(call.contractAddress) &&
    sameAddress(call.contractAddress, address) &&
    call.entrypoint === entrypoint
  )
}

/**
 * The closing sentence both one-per-batch rules share. It exists because the cheap fix
 * for either refusal is to raise the count, and that removes the control rather than
 * satisfying it.
 */
const RAISING_IT_IS_WRONG =
  `If a flow genuinely needs more than one, that is a change to what the relayer funds ` +
  `and belongs in allowlist.ts as a decision — raising this count to clear the error ` +
  `would remove the only thing holding a batch to one of each action.`

function assertAtMostOne(count: number, label: string, because: string): void {
  if (count > 1) {
    throw new Error(`refusing a batch with ${count} ${label}: ${because} ${RAISING_IT_IS_WRONG}`)
  }
}

/** Throws unless every call is one the relayer is willing to sign and pay for. */
export function assertSubmittable(calls: Call[], policy: SubmissionPolicy = {}): void {
  if (calls.length > MAX_CALLS_PER_SUBMISSION) {
    throw new Error(
      `refusing a batch of ${calls.length} calls: the limit is ${MAX_CALLS_PER_SUBMISSION}`,
    )
  }

  // ONE SUBMISSION CARRIES AT MOST ONE OF EACH ALLOWLISTED ACTION. The per-call ceiling
  // bounds a single call; a batch can hold eight, and without these rules the ceiling
  // bounds the call rather than the transaction. The legitimate shape is
  // `[STRK.approve(pool, fee), pool.apply_actions(…)]`.
  //
  // The rule is uniform on purpose. Two of these bound fees and the third bounds only
  // gas, and it would be defensible to exempt the third — but "one of each" can be
  // checked at a glance, while "one approve, one apply_actions, unlimited privacy_invoke
  // because that contract has no fee collection" cannot be checked without knowing a
  // fact that lives in someone else's repository. Every composition bug found here came
  // from a control that was correct alone and unexamined in combination.
  assertAtMostOne(
    calls.filter(isStrkApprove).length,
    'approves',
    'one submission pays one fee, and because approve SETS the allowance, re-arming it ' +
      'between calls multiplies the fee inside a single transaction while every call ' +
      'stays under the ceiling.',
  )
  assertAtMostOne(
    calls.filter(isPoolApplyActions).length,
    'apply_actions',
    'one submission pays one fee, and collect_fee() runs once per apply_actions ' +
      'invocation — at the top of the function body, not inside a per-action loop — so ' +
      'each one in a batch is a separate pull from this wallet.',
  )
  assertAtMostOne(
    calls.filter((call) => isAppContractInvoke(call, policy)).length,
    'privacy_invoke calls',
    'this one bounds gas rather than fees — none of the app contracts has a collect_fee — ' +
      'but gas is still paid by a wallet funded for a single batch, and the pool reaches all ' +
      'of them through InvokeExternal anyway, so a direct call is already the unusual path. ' +
      'Counted across the whole app-contract set rather than per contract, so one invoke each ' +
      'on three contracts is refused rather than passing as three separate "at most one"s.',
  )
  assertAtMostOne(
    calls.filter((call) => isKeeperCall(call, policy)).length,
    'keeper calls',
    'resolve, void and graduate each do their whole job the first time they succeed, so a ' +
      'batch of them is one useful transaction and the rest reverting at this wallet’s expense.',
  )

  for (const call of calls) assertCallAllowed(call, policy)
}
