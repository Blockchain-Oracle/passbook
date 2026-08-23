// Sponsorship budgeting (FR-053 / AD-7, story 1.5). The funded relayer key pays for a cold
// visitor's first registration — bounded by a per-visitor cap AND a global daily budget, and
// failing OPEN into pay-your-own-way (never a locked door). Pure decision + an in-memory store
// with atomic single-claim semantics for invite codes.

/** Shown when the daily budget is spent — the flow still offers the self-funded path (FR-012). */
export const BUDGET_EXHAUSTED_NOTICE =
  'Sponsored registrations are paused until 00:00 UTC. ' +
  'You can still create an account from a funded Starknet wallet.'

export interface BudgetCaps {
  perVisitor: number   // max sponsored actions for one visitor id
  daily: number        // max sponsored actions across all visitors per UTC day
}

export interface BudgetState {
  utcDay: string                  // 'YYYY-MM-DD' the counts belong to
  dailyCount: number
  perVisitor: Record<string, number>
}

export type SponsorDecision =
  | { allow: true }
  | { allow: false; reason: 'visitor-cap' | 'daily-budget'; notice: string }

/** UTC day key for `t` (ms). Used for the 00:00-UTC daily reset boundary. */
export function utcDayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export function emptyBudget(t: number): BudgetState {
  return { utcDay: utcDayKey(t), dailyCount: 0, perVisitor: {} }
}

/** Rolls the state to `now`'s UTC day, zeroing the counters if the day changed. Pure. */
export function rolledToDay(state: BudgetState, now: number): BudgetState {
  const day = utcDayKey(now)
  return day === state.utcDay ? state : emptyBudget(now)
}

/** Pure decision — does NOT mutate. `commitSponsorship` applies the effect. */
export function decideSponsorship(state: BudgetState, caps: BudgetCaps, visitorId: string, now: number): SponsorDecision {
  const s = rolledToDay(state, now)
  if (s.dailyCount >= caps.daily) {
    return { allow: false, reason: 'daily-budget', notice: BUDGET_EXHAUSTED_NOTICE }
  }
  if ((s.perVisitor[visitorId] ?? 0) >= caps.perVisitor) {
    return { allow: false, reason: 'visitor-cap', notice: BUDGET_EXHAUSTED_NOTICE }
  }
  return { allow: true }
}

/** Returns the state after recording one sponsored action for `visitorId` at `now`. Pure. */
export function commitSponsorship(state: BudgetState, visitorId: string, now: number): BudgetState {
  const s = rolledToDay(state, now)
  return {
    utcDay: s.utcDay,
    dailyCount: s.dailyCount + 1,
    perVisitor: { ...s.perVisitor, [visitorId]: (s.perVisitor[visitorId] ?? 0) + 1 },
  }
}

/**
 * A stateful budget with an atomic single-claim ledger for invite codes. `tryClaim` burns a code
 * exactly once — a second claim of the same code returns false without spending budget (one
 * sponsorship per code, burned before submission). JS is single-threaded so the check-then-set is
 * atomic within the process; a multi-process deployment must back `claimed` with a store that
 * offers the same atomicity (documented, not assumed).
 */
export class SponsorshipLedger {
  private state: BudgetState
  private readonly claimed = new Set<string>()
  constructor(private readonly caps: BudgetCaps, now: number = Date.now()) {
    this.state = emptyBudget(now)
  }

  decide(visitorId: string, now: number = Date.now()): SponsorDecision {
    return decideSponsorship(this.state, this.caps, visitorId, now)
  }

  /** Records a sponsored action if the decision allows; returns the decision made. */
  spend(visitorId: string, now: number = Date.now()): SponsorDecision {
    const d = this.decide(visitorId, now)
    if (d.allow) this.state = commitSponsorship(this.state, visitorId, now)
    return d
  }

  /** Atomic one-time claim of an invite code. True the first time, false forever after. */
  tryClaim(code: string): boolean {
    if (this.claimed.has(code)) return false
    this.claimed.add(code)
    return true
  }
}
