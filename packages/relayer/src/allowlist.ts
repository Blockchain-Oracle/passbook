// The relayer signs with a funded key and pays the fee. Whatever this file permits, anyone who
// can reach the port can make that key do — every entry is spending authority granted to the
// network. Operating rule: fund the relayer with only what the current batch needs.
//
// KNOWN RESIDUAL: a submission approves up to the ceiling while `collect_fee` pulls one fee, so
// about one fee's allowance can stand afterwards; bounded by ABSOLUTE_MAX_APPROVE_WEI.
import type { Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import {
  KEEPER_ENTRYPOINTS,
  assertCallAllowed,
  matches,
  type AppContractName,
  type SubmissionPolicy,
} from './allowlist-calls.js'

// The ceiling formula lives in the protocol so the client that BUILDS the approve uses the same one.
export {
  APPROVE_FEE_MULTIPLE,
  ABSOLUTE_MAX_APPROVE_WEI,
  approveCeiling,
} from '../../protocol/src/fee-ceiling.js'

// Only the whole-batch entry points leave this module: the per-call checks are reachable solely
// through `assertSubmittable`, so no caller can skip the one-of-each batch rules.
export {
  MAX_PROOF_FACTS,
  MAX_RESOURCE_BOUNDS_WEI,
  assertProofFacts,
  assertResourceBounds,
  type ResourceBounds,
  type SubmissionPolicy,
} from './allowlist-calls.js'

/** A real submission is one approve plus a pool call. Anything long is not ours. */
export const MAX_CALLS_PER_SUBMISSION = 8

/** Whether this batch needs the fee-derived ceiling, so a chain read is only made when an approve is present. */
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

/** Every `privacy_invoke` across the WHOLE app-contract set — per-contract counting would allow three. */
function isAppContractInvoke(call: Call, policy: SubmissionPolicy): boolean {
  if (policy.messageBook !== undefined && matches(call, policy.messageBook, 'privacy_invoke')) {
    return true
  }
  for (const name of ['markets', 'launch', 'governance'] as const) {
    const address = policy[name]
    if (address !== undefined && matches(call, address, 'privacy_invoke')) return true
  }
  return false
}

/** Every direct keeper call: a loop of `resolve` is one useful tx and the rest reverting at our expense. */
function isKeeperCall(call: Call, policy: SubmissionPolicy): boolean {
  for (const [name, entrypoints] of Object.entries(KEEPER_ENTRYPOINTS) as [
    AppContractName,
    readonly string[],
  ][]) {
    const address = policy[name]
    if (address === undefined) continue
    if (entrypoints.some((entrypoint) => matches(call, address, entrypoint))) return true
  }
  return false
}

// The cheap fix for either refusal is to raise the count, and that removes the control.
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
  // ONE SUBMISSION CARRIES AT MOST ONE OF EACH ALLOWLISTED ACTION: the per-call ceiling bounds a
  // call, and without these rules a batch of eight multiplies it. Uniform on purpose — "one of
  // each" can be checked at a glance.
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
