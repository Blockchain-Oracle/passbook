// Sponsorship budgeting. The funded relayer key pays for a cold
// visitor's first registration — bounded by a per-visitor cap AND a global daily budget, and
// failing OPEN into pay-your-own-way (never a locked door). Pure decision + a stateful ledger
// with an atomic single-claim set, persisted through an injected store.

import { createHash } from 'node:crypto'
import type { PersistedLedger, SponsorshipStore } from './sponsorship-store.js'

// The notice a spent send cap answers with. Defined in `protocol/src/relayer-wire.ts` alongside
// the field it travels in — the browser renders it verbatim, so it is part of the wire contract
// rather than a string this package owns. Re-exported here so existing importers are unchanged.
export { SEND_CAP_NOTICE } from '../../protocol/src/relayer-wire.js'

/** Shown when the daily budget is spent — the flow still offers the self-funded path. */
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

/**
 * Rolls the state to `now`'s UTC day, zeroing the counters if the day changed. Pure.
 *
 * `keepPerKey` is what separates a DAILY budget from a ONCE-PER-ACCOUNT grant. An IP-keyed budget
 * is a rate limit and must reset — tomorrow's visitor is not today's. The account allowance is not
 * a rate limit at all: it is the three transactions we said we would cover for an account, and an
 * offer that quietly renews every midnight is a different, much larger offer than the one the
 * screen makes. So that ledger keeps its per-account counts across the boundary and rolls only the
 * shared daily brake, which really is per-day.
 */
export function rolledToDay(state: BudgetState, now: number, keepPerKey = false): BudgetState {
  const day = utcDayKey(now)
  if (day === state.utcDay) return state
  return keepPerKey ? { utcDay: day, dailyCount: 0, perVisitor: state.perVisitor } : emptyBudget(now)
}

/**
 * Pure decision — does NOT mutate. `commitSponsorship` applies the effect.
 *
 * `notice` is a parameter because the same counting machinery meters two different things: the
 * sponsorship budget and the send cap. It defaults to the registration copy; what it prevents is a
 * send being refused with a sentence about account creation.
 */
export function decideSponsorship(
  state: BudgetState,
  caps: BudgetCaps,
  visitorId: string,
  now: number,
  notice: string = BUDGET_EXHAUSTED_NOTICE,
  keepPerKey = false,
): SponsorDecision {
  const s = rolledToDay(state, now, keepPerKey)
  // THE DAILY BUDGET IS CHECKED FIRST: it is the relayer's solvency floor and not a courtesy.
  if (s.dailyCount >= caps.daily) {
    return { allow: false, reason: 'daily-budget', notice }
  }
  if ((s.perVisitor[visitorId] ?? 0) >= caps.perVisitor) {
    return { allow: false, reason: 'visitor-cap', notice }
  }
  return { allow: true }
}

/** Returns the state after recording one sponsored action for `visitorId` at `now`. Pure. */
export function commitSponsorship(state: BudgetState, visitorId: string, now: number, keepPerKey = false): BudgetState {
  const s = rolledToDay(state, now, keepPerKey)
  return {
    utcDay: s.utcDay,
    dailyCount: s.dailyCount + 1,
    perVisitor: { ...s.perVisitor, [visitorId]: (s.perVisitor[visitorId] ?? 0) + 1 },
  }
}

/**
 * Returns the state after UNDOING one recorded action for `visitorId`. Pure.
 *
 * DELIBERATELY DOES NOT ROLL THE DAY, unlike every other function here. `rolledToDay` moves state
 * FORWARD to `now`; handed a state that has already advanced past `now` it answers with an empty
 * budget stamped in the past, which as a refund would silently zero the day's counters for
 * everyone. The caller checks the day instead and declines to refund across the boundary.
 *
 * Floors at zero on both counters rather than trusting its input: a refund is only ever issued
 * against a spend made moments earlier, so a negative would mean something else already unwound it.
 */
function revertSponsorship(state: BudgetState, visitorId: string): BudgetState {
  const had = state.perVisitor[visitorId] ?? 0
  const perVisitor = { ...state.perVisitor }
  if (had <= 1) delete perVisitor[visitorId]
  else perVisitor[visitorId] = had - 1
  return { utcDay: state.utcDay, dailyCount: Math.max(0, state.dailyCount - 1), perVisitor }
}

/**
 * Returns the state after giving ONE KEY its unit back while leaving the day's total alone. Pure.
 *
 * ── THE DAY'S COUNT RECORDS WHAT WE BROADCAST; THE PER-KEY COUNT RECORDS WHAT A USER GOT ──
 *
 * `revertSponsorship` unwinds a spend that bought nothing at all, so it takes both counters down.
 * This one is for a transaction that DID reach the chain and then reverted: the user got nothing,
 * but the gas left our wallet for good. Returning the day's unit too would uncap us — every revert
 * would hand the daily budget back, and a caller able to make transactions revert could spend the
 * wallet at a few STRK a time with no ceiling anywhere. The per-visitor cap is a courtesy and can
 * be given back; the daily budget is the solvency floor `decideSponsorship` checks first, and it
 * must keep counting what we actually paid for.
 */
function refundVisitorUnit(state: BudgetState, visitorId: string): BudgetState {
  const had = state.perVisitor[visitorId] ?? 0
  const perVisitor = { ...state.perVisitor }
  if (had <= 1) delete perVisitor[visitorId]
  else perVisitor[visitorId] = had - 1
  return { utcDay: state.utcDay, dailyCount: state.dailyCount, perVisitor }
}

/**
 * A stateful budget with an atomic single-claim set (the faucet's once-per-address keys),
 * durable across restarts.
 *
 * `tryClaim` burns a key exactly once — a second claim of the same key returns false without
 * spending budget. The check-then-set is
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
    /**
     * ONCE PER KEY, NOT PER DAY. Set for the account allowance, whose three transactions are a
     * one-time grant: the per-account counts survive midnight and only the shared daily brake
     * resets. Left false for every IP-keyed budget, which is a rate limit and must reset.
     */
    readonly lifetime: boolean = false,
  ) {
    const loaded = store.load()
    this.salt = loaded.salt
    // Roll on the way in, so a ledger last written yesterday does not spend today's first
    // request against yesterday's exhausted counters.
    this.state = rolledToDay(loaded.budget, now, lifetime)
    this.claimed = new Set(loaded.claimed)
  }

  decide(visitorId: string, now: number = Date.now()): SponsorDecision {
    return decideSponsorship(this.state, this.caps, visitorId, now, this.notice, this.lifetime)
  }

  /**
   * How many of this visitor's units are left, and how many they started with — the pair a user
   * can be shown ("2 of 3 left") without a submission being attempted.
   *
   * THE DAILY BUDGET IS FOLDED IN, and it has to be: a visitor with two personal units left is
   * shown zero once the shared daily budget is spent, because that is what they will actually get.
   * A counter that promises what the next request will refuse is worse than no counter.
   *
   * Read-only. `spend` remains the only thing that moves a number.
   */
  remaining(visitorId: string, now: number = Date.now()): { remaining: number; of: number } {
    const s = rolledToDay(this.state, now, this.lifetime)
    const personal = Math.max(0, this.caps.perVisitor - (s.perVisitor[visitorId] ?? 0))
    const shared = Math.max(0, this.caps.daily - s.dailyCount)
    return { remaining: Math.min(personal, shared), of: this.caps.perVisitor }
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
      const next = commitSponsorship(this.state, visitorId, now, this.lifetime)
      this.store.save({ salt: this.salt, budget: next, claimed: [...this.claimed] })
      this.state = next
    }
    return d
  }

  /**
   * Gives one spent unit back, for a submission that provably never reached the chain.
   *
   * ── WHY THE SPEND STILL HAPPENS FIRST ─────────────────────────────────────────────────────
   *
   * Recording before the broadcast is what stops two concurrent requests sharing one check, and
   * that property is worth keeping. What it cost was a user paying for a refusal: a batch that
   * died inside fee estimation never existed, and the counter had already been decremented, so
   * the next attempt was told its covered transactions were used up. This unwinds exactly that
   * case — never an ambiguous one, where a transaction may be in flight and the unit is owed.
   *
   * Persists before mutating, like `spend`: a failed write leaves the unit spent, which is the
   * safe direction. A refund that cannot be durably recorded must not exist only in memory.
   */
  refund(visitorId: string, now: number = Date.now()): void {
    // A spend recorded before a UTC rollover went with the day it belonged to — the DAY'S counters
    // have already been zeroed, so decrementing them would rewrite the new day's totals.
    //
    // A lifetime ledger is the exception, and has to be: its per-account count did NOT reset at
    // midnight, so the unit it is owed is still sitting there. It gets the per-key half back and
    // not the daily half, which is the courtesy refund by another name.
    const sameDay = utcDayKey(now) === this.state.utcDay
    if (!sameDay && !this.lifetime) return
    const rolled = rolledToDay(this.state, now, this.lifetime)
    const next = sameDay ? revertSponsorship(rolled, visitorId) : refundVisitorUnit(rolled, visitorId)
    this.store.save({ salt: this.salt, budget: next, claimed: [...this.claimed] })
    this.state = next
  }

  /**
   * Gives one key its unit back after a transaction that WAS broadcast and then reverted.
   *
   * A revert is the case the plain `refund` cannot serve: the transaction reached a block, so it is
   * not true that nothing happened — the network charged us for everything it executed before the
   * failure — and it is also not true that the user got what they paid a unit for. They got
   * nothing. So the unit goes back and the day's total stays put; see `refundVisitorUnit` for why
   * that asymmetry is the thing keeping the wallet bounded.
   *
   * Same day guard and same persist-before-mutate order as `refund`, for the same reasons.
   */
  refundCourtesy(visitorId: string, now: number = Date.now()): void {
    if (utcDayKey(now) !== this.state.utcDay && !this.lifetime) return
    const next = refundVisitorUnit(rolledToDay(this.state, now, this.lifetime), visitorId)
    this.store.save({ salt: this.salt, budget: next, claimed: [...this.claimed] })
    this.state = next
  }

  /**
   * Whether `code` has already been burned. Read-only — `tryClaim` remains the only thing that
   * spends one.
   *
   * It exists so a screen can stop OFFERING something that will be refused. Without it the only
   * way to learn a drip was already taken is to ask for it and read a 429, which means the button
   * has to be shown, pressed, and then fail — and a user cannot tell that apart from a broken
   * faucet. Asking is free; being refused is not.
   */
  hasClaimed(code: string): boolean {
    return this.claimed.has(code)
  }

  /**
   * Hands a burned claim back, for a transaction that provably did not deliver what the claim paid
   * for.
   *
   * ── THE ONLY LEGITIMATE CALLER IS A REFUND PATH ───────────────────────────────────────────
   *
   * `tryClaim` is permanent on purpose: a starter amount is for starting, and a second one is a
   * withdrawal. But permanence is only fair if the claim BOUGHT something. A drip whose transaction
   * never reached the chain, or reached it and reverted, left the account with nothing and its one
   * chance burned — the same injustice the meters' revert refund exists to undo, and worse, because
   * this one never comes back at midnight.
   *
   * So this exists, and it must stay reachable only from a place that has a receipt (or a proven
   * absence of one). Calling it anywhere a request can steer would turn a once-per-account gift
   * into an unmetered one.
   */
  releaseClaim(code: string): void {
    if (!this.claimed.has(code)) return
    const next: PersistedLedger = {
      salt: this.salt,
      budget: this.state,
      claimed: [...this.claimed].filter((c) => c !== code),
    }
    this.store.save(next)
    this.claimed.delete(code)
  }

  /** Atomic one-time claim of a key (the faucet's `drip:<felt>`). True the first time, false forever after. */
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

/**
 * The opaque id one visitor is counted under, for one UTC day: `sha256(salt|day|ip)`.
 * Opaque at rest and day-scoped, but NOT one-way against a leak of the file — the salt sits
 * beside the hashes, so the ledger file is sensitive.
 */
export function visitorId(ip: string, salt: string, now: number): string {
  // `|` is safe as a separator: the salt is hex, the day is YYYY-MM-DD, the ip is a literal.
  return createHash('sha256').update(`${salt}|${utcDayKey(now)}|${ip}`).digest('hex').slice(0, 32)
}
