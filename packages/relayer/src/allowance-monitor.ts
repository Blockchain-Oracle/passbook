// Allowance-floor monitor (FR-053 / AD-7, story 1.5). The relayer holds a standing ERC-20 approval
// to the pool for fees; when it drops below a floor, `apply_actions` starts reverting on the
// allowance — a silent revert that would look like OUR bug. Ops must be paged BEFORE that, and the
// user must see the ordinary relayer-down state, never a distinct "allowance exhausted" string.

export type AllowanceHealth = 'healthy' | 'low' | 'exhausted'

/**
 * Classifies the standing allowance against a floor. `low` is the page-ops warning band (still
 * functional); `exhausted` means the next submission will revert on the allowance. The floor is a
 * multiple of the live fee so it tracks fee changes rather than a hardcoded number.
 */
export function classifyAllowance(currentWei: bigint, floorWei: bigint): AllowanceHealth {
  if (currentWei < floorWei) return 'exhausted'
  // Warn while there is less than 2× the floor left — time to top up before it bites.
  if (currentWei < floorWei * 2n) return 'low'
  return 'healthy'
}

/** The floor: enough to cover a burst of submissions at the live fee (default 10×). Runtime, not hardcoded. */
export function allowanceFloor(liveFeeWei: bigint, burst = 10n): bigint {
  return liveFeeWei * burst
}

/**
 * What the USER is shown for a given allowance health. `low`/`healthy` are invisible to users
 * (an ops concern); `exhausted` degrades to the ordinary relayer-down state — never a distinct
 * "allowance exhausted" bug string (FR-053).
 */
export function userFacingState(h: AllowanceHealth): 'ok' | 'relayer-down' {
  return h === 'exhausted' ? 'relayer-down' : 'ok'
}

/** Whether ops should be paged. Both `low` (pre-emptive) and `exhausted` page. */
export function shouldPageOps(h: AllowanceHealth): boolean {
  return h !== 'healthy'
}
