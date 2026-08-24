// Sponsorship budgeting (FR-053 / AD-7, story 1.5). The funded relayer key pays for a cold
// visitor's first registration — bounded by a per-visitor cap AND a global daily budget, and
// failing OPEN into pay-your-own-way (never a locked door). Pure decision + a stateful ledger
// with atomic single-claim semantics for invite codes, persisted through an injected store.

import type { PersistedLedger, SponsorshipStore } from './sponsorship-store.js'

// The notice a spent send cap answers with. Defined in `protocol/src/relayer-wire.ts` alongside
// the field it travels in — the browser renders it verbatim, so it is part of the wire contract
// rather than a string this package owns. Re-exported here so existing importers are unchanged.
export { SEND_CAP_NOTICE } from '../../protocol/src/relayer-wire.js'

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

/**
 * Pure decision — does NOT mutate. `commitSponsorship` applies the effect.
 *
 * `notice` is a parameter because the same counting machinery meters two different things now:
 * the sponsorship budget and the send cap (story 1.16). It defaults to the registration copy, so
 * every existing caller behaves exactly as before; what it prevents is a send being refused with
 * a sentence about account creation.
 */
export function decideSponsorship(
  state: BudgetState,
  caps: BudgetCaps,
  visitorId: string,
  now: number,
  notice: string = BUDGET_EXHAUSTED_NOTICE,
): SponsorDecision {
  const s = rolledToDay(state, now)
  if (s.dailyCount >= caps.daily) {
    return { allow: false, reason: 'daily-budget', notice }
  }
  if ((s.perVisitor[visitorId] ?? 0) >= caps.perVisitor) {
    return { allow: false, reason: 'visitor-cap', notice }
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
 * A stateful budget with an atomic single-claim ledger for invite codes, durable across restarts.
 *
 * `tryClaim` burns a code exactly once — a second claim of the same code returns false without
 * spending budget (one sponsorship per code, burned before submission). The check-then-set is
 * atomic because nothing in it yields: the decision, the mutation and the store write are all
 * synchronous, so two concurrent requests cannot both observe the last unit of budget. That is
 * why `SponsorshipStore` is a synchronous interface and must stay one.
 *
 * The store is a constructor argument with no default on purpose. An in-memory fallback is a
 * relayer that hands the whole daily budget out again on every restart, and the failure is
 * invisible — so the caller states which store it wants, and the type system asks.
 * Multi-process deployment remains out of scope; see sponsorship-store.ts.
 */
export class SponsorshipLedger {
  private state: BudgetState
  private readonly claimed: Set<string>
  /** The key that turns a client IP into the opaque visitor id this budget is keyed by. */
  readonly salt: string

  constructor(
    private readonly caps: BudgetCaps,
    private readonly store: SponsorshipStore,
    now: number = Date.now(),
    /**
     * The copy a refusal carries. Defaults to the registration notice, so a ledger constructed
     * the way 1.5 constructs one is byte-identical to before. The send cap passes its own.
     *
     * PUBLIC, so a caller can check which one it got. Forgetting this argument on a send budget
     * is silent — the ledger works perfectly and answers every refusal with copy about account
     * registration — so `createRelayerServer` reads it back and refuses to start on a mismatch.
     */
    readonly notice: string = BUDGET_EXHAUSTED_NOTICE,
  ) {
    const loaded = store.load()
    this.salt = loaded.salt
    // Roll on the way in, so a ledger last written yesterday does not spend today's first
    // request against yesterday's exhausted counters.
    this.state = rolledToDay(loaded.budget, now)
    this.claimed = new Set(loaded.claimed)
  }

  decide(visitorId: string, now: number = Date.now()): SponsorDecision {
    return decideSponsorship(this.state, this.caps, visitorId, now, this.notice)
  }

  /**
   * Records a sponsored action if the decision allows; returns the decision made.
   *
   * The store is written BEFORE memory is updated, and both mutators do the same. Mutating
   * first and persisting second means a failed write (a full disk, a permissions change)
   * leaves the spend counted in memory and absent from the file — so the count is right until
   * the next restart resurrects the budget, which is the exact bug durability was added to
   * fix, now arriving silently and later. Persisting first makes a write failure a refusal
   * to spend rather than a spend nobody recorded; the exception reaches the caller, who
   * answers 500 rather than signing.
   */
  spend(visitorId: string, now: number = Date.now()): SponsorDecision {
    const d = this.decide(visitorId, now)
    if (d.allow) {
      const next = commitSponsorship(this.state, visitorId, now)
      this.store.save({ salt: this.salt, budget: next, claimed: [...this.claimed] })
      this.state = next
    }
    return d
  }

  /** Atomic one-time claim of an invite code. True the first time, false forever after. */
  tryClaim(code: string): boolean {
    if (this.claimed.has(code)) return false
    const next: PersistedLedger = {
      salt: this.salt,
      budget: this.state,
      claimed: [...this.claimed, code],
    }
    this.store.save(next)
    this.claimed.add(code)
    return true
  }
}
