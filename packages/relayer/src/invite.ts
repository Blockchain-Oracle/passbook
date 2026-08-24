// The invite substrate (FR-014 / FR-060, story 1.14).
//
// `RECIPIENT_NOT_REGISTERED` is this app's most common hard error, and an invite is the fix for
// it rather than a growth feature. This module is the whole domain: minting a code against a
// rolling per-inviter allowance, burning it atomically before any submission entitlement exists,
// and consuming it once against a sponsored registration.
//
// THE ONE THING A BURNED CODE BUYS is a waiver of the PER-VISITOR sponsorship cap. It is not a
// budget bypass. The waiver exists because "abu's invite covers it once" has to hold for a
// stranger on a NAT-shared mobile IP whose per-visitor cap other strangers already spent — that
// is the realistic case, not an edge one. The global daily budget is the relayer's solvency
// floor (story 1.5) and stays unconditional, so an invite never becomes a promise the treasury
// cannot keep; when the budget is gone, an invited visitor gets the same honest degrade into
// pay-your-own-way that everyone else gets.
//
// BEARER-CODE EXPOSURE, COSTED ONCE SO NOBODY HAS TO GUESS LATER: 32^6 is about 1.07e9 codes;
// the live population is at most allowance x inviters — bounded globally by the daily mint
// ceiling, so cheap addresses cannot inflate it — and expires; claim attempts are capped per
// visitor per UTC day, on `/invite/claim`, on `/invite/status` misses AND on `/submit`'s invite
// vet, so there is no unmetered route that answers "is this code live"; and the prize for
// guessing one is a single sponsored registration, which buys an account that can receive but
// not send — worth zero to a farmer (Flow W2 abuse layer ii). Those together are what make six
// characters enough. Anyone who later wants a code to carry value has to redo this arithmetic
// first.

import { createHash, randomBytes } from 'node:crypto'
import {
  INVITE_ALPHABET,
  INVITE_ALREADY_USED_NOTICE,
  INVITE_CODE_LENGTH,
  inviteExhaustedNotice,
  normalizeInviteCode,
  type InviteRefusalReason,
  type InviteState,
} from '../../protocol/src/relayer-wire.js'
import { utcDayKey } from './sponsorship.js'
import type { ClaimAttemptState, InviteRecord, InviteStore, PersistedInvites } from './invite-store.js'

// The alphabet, the length and the normaliser are the WIRE'S, defined once in relayer-wire.ts —
// the relayer mints from the same characters the browser parses links against, and two copies of
// that rule is two copies that can drift apart silently. Re-exported so existing importers keep
// working and the tests can pin that both sides really are one definition.
export { INVITE_ALPHABET, INVITE_ALREADY_USED_NOTICE, INVITE_CODE_LENGTH, inviteExhaustedNotice }

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * A fresh code, from the CSPRNG and from nothing else.
 *
 * NEVER DERIVED from the inviter, the recipient, an account, a key or a counter. A derived code
 * is a code an observer can enumerate, and enumerating codes here means spending other people's
 * allowances. `& 31` is unbiased because the alphabet is exactly 32 long — with any other length
 * this masking would quietly favour the first characters, which is the standard way a token
 * generator loses half its entropy without anything looking wrong.
 */
export function mintCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (const b of bytes) code += INVITE_ALPHABET[b & 31]
  return code
}

/** The wire's normaliser under the name this package has always exported it as. */
export const normalizeCode = normalizeInviteCode

/** The numbers that bound the whole feature. All of them are the operator's to choose. */
export interface InviteConfig {
  /** Codes one inviter may mint inside `windowMs`. */
  allowance: number
  /** The rolling window the allowance is measured over. 24h is the shape the copy promises. */
  windowMs: number
  /** How long a minted code stays claimable. */
  ttlMs: number
  /** Claim attempts one visitor may make per UTC day, successful or not. */
  claimAttemptsPerDay: number
  /**
   * Mints per rolling 24 hours across EVERY inviter. The per-inviter allowance bounds what one
   * address can give away; this bounds what all of them together can, because addresses are
   * cheap (IPv6, a botnet) and each live code weakens the 32^6 arithmetic a little. The window
   * here is a fixed day rather than `windowMs`, because it is a solvency-shaped ceiling like
   * the daily budgets, not a fairness-shaped one like the allowance.
   */
  mintDailyGlobal: number
}

/**
 * How long a finished record is kept before it is pruned.
 *
 * The file is rewritten whole on every write, so a list that only grows is a write that only
 * gets slower — and a ledger nobody prunes is a ledger nobody can read during an incident. Seven
 * days is well past every ladder this feeds: a sender watching `Invite expired. Nothing had
 * moved.` still sees it, and an invitee who claimed a code a week ago is not mid-ceremony.
 *
 * PRUNING NEVER UN-BURNS ANYTHING THAT MATTERS. A pruned code reads as `invite-not-found`, which
 * refuses; the direction of the mistake is toward refusing, never toward paying twice.
 */
export const INVITE_RETENTION_MS = 7 * 24 * HOUR_MS

/** The id one inviter's rolling allowance is counted under. */
export function inviterKeyFor(ip: string, salt: string): string {
  // NO UTC DAY, unlike `visitorId` in server.ts, and that is the whole reason this function
  // exists rather than reusing that one. A day-salted id resets every allowance at midnight, so
  // `1 more in 19h` would be a promise the ledger silently forgets on the way there.
  //
  // `|` is safe as a separator for the same reason it is there: the salt is hex and every value
  // `clientIp` produces is an IP literal or the word `unknown`, so neither can contain one.
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32)
}

// ── Pure decisions. No I/O, no clock of their own, fully testable without HTTP. ────────────

export type MintDecision =
  | { allow: true; left: number; nextInHours: number | null }
  | {
      allow: false
      reason: 'invite-allowance-exhausted' | 'invite-mint-daily-cap'
      left: 0
      nextInHours: number
      notice: string
    }

/** Mints inside the rolling window, oldest first. */
function mintsInWindow(invites: readonly InviteRecord[], inviterKey: string, config: InviteConfig, now: number): number[] {
  const floor = now - config.windowMs
  return invites
    .filter((i) => i.inviterKey === inviterKey && i.mintedAt > floor)
    .map((i) => i.mintedAt)
    .sort((a, b) => a - b)
}

/**
 * Hours until the oldest mint falls out of the window, or `null` when nothing is pending.
 *
 * `null` rather than `0` for an empty window, because they are different sentences: the row says
 * `Invite · 3 left` when nothing is returning and `Invite · 2 left · 1 more in 19h` when one is.
 * A `0` would render as "1 more in 0h", which is a lie about a thing that is not happening.
 */
function nextReturnInHours(window: readonly number[], config: InviteConfig, now: number): number | null {
  const oldest = window[0]
  if (oldest === undefined) return null
  // Ceiling, so the number never promises a return sooner than it happens. Rounding down would
  // make the row say "1 more in 0h" for the last 59 minutes of the wait.
  return Math.max(1, Math.ceil((oldest + config.windowMs - now) / HOUR_MS))
}

/** Pure decision — does NOT mutate. `InviteLedger.mint` applies the effect. */
export function decideMint(
  invites: readonly InviteRecord[],
  inviterKey: string,
  config: InviteConfig,
  now: number,
): MintDecision {
  // The global ceiling first — a solvency check, like the daily budgets, and like them it is
  // measured over a fixed day regardless of `windowMs`. Its refusal carries a clock too: the
  // hour the oldest of today's mints falls out of the day, because that is when one returns.
  const today = invites.filter((i) => i.mintedAt > now - DAY_MS).map((i) => i.mintedAt)
  if (today.length >= config.mintDailyGlobal) {
    const oldest = Math.min(...today)
    const hours = Math.max(1, Math.ceil((oldest + DAY_MS - now) / HOUR_MS))
    return {
      allow: false,
      reason: 'invite-mint-daily-cap',
      left: 0,
      nextInHours: hours,
      notice: inviteExhaustedNotice(hours),
    }
  }

  const window = mintsInWindow(invites, inviterKey, config, now)
  if (window.length >= config.allowance) {
    // The window being full guarantees a mint inside it, so `nextReturnInHours` is a number
    // here. The fallback exists so a config of `allowance: 0` — a deliberately closed door —
    // still answers with a sentence rather than with `null` reaching the copy builder.
    const hours = nextReturnInHours(window, config, now) ?? Math.ceil(config.windowMs / HOUR_MS)
    return {
      allow: false,
      reason: 'invite-allowance-exhausted',
      left: 0,
      nextInHours: hours,
      notice: inviteExhaustedNotice(hours),
    }
  }
  // BOTH numbers describe the world AFTER this mint, because that is the state the row renders
  // the moment this call returns. Computing `nextInHours` from the pre-mint window would make
  // the LAST mint answer `{ left: 0, nextInHours: null }` — zero left and no clock, which is
  // the locked door this feature refuses to ship — when the truth is that one returns the
  // moment this mint ages out.
  return {
    allow: true,
    left: config.allowance - window.length - 1,
    nextInHours: nextReturnInHours([...window, now], config, now),
  }
}

export type ClaimDecision =
  | { allow: true; record: InviteRecord; replay?: true }
  | { allow: false; reason: InviteRefusalReason; notice?: string }

/** The count of claim attempts already made by `visitor` today, rolling the day if it turned. */
function attemptsToday(attempts: ClaimAttemptState, now: number): ClaimAttemptState {
  const day = utcDayKey(now)
  return day === attempts.utcDay ? attempts : { utcDay: day, counts: {} }
}

/**
 * Pure decision — does NOT mutate.
 *
 * THE ATTEMPT CAP IS CHECKED FIRST, before the code is even looked up, and that order is the
 * anti-guessing control rather than an optimisation: checking existence first would let a capped
 * visitor keep distinguishing "no such code" from "already used" for free, which is exactly the
 * oracle an enumeration run wants.
 *
 * `claimant` is a CLIENT-MINTED idempotency token, not an identity. It exists because the
 * visitor id cannot do this job: visitor ids are IP-scoped, so behind one NAT the loser of a
 * double-claim IS the winner as far as an IP hash can tell, and keying the replay on it would
 * hand the loser a win. A random token the winning browser holds and resends is the only party
 * that can honestly say "that was me".
 */
export function decideClaim(
  state: PersistedInvites,
  code: string,
  visitor: string,
  config: InviteConfig,
  now: number,
  claimant?: string,
): ClaimDecision {
  const attempts = attemptsToday(state.attempts, now)
  if ((attempts.counts[visitor] ?? 0) >= config.claimAttemptsPerDay) {
    return { allow: false, reason: 'invite-too-many-attempts' }
  }
  const record = state.invites.find((i) => i.code === code)
  if (!record) return { allow: false, reason: 'invite-not-found' }
  // ALREADY-USED IS CHECKED BEFORE EXPIRY. A claimed code that later ages out is still a code
  // somebody won, and telling the loser of a race that it "expired" would send them looking for
  // a new link when what they need to know is that the invite is gone.
  if (record.claimedAt !== undefined) {
    // THE WINNER RETRYING IS NOT A LOSER. A claim POST whose response was lost — a dropped
    // radio, a killed tab — gets retried by the very browser that won the burn, and answering
    // it `invite-already-used` would lock the real invitee out of the invite they hold. The
    // burn recorded the winner's claimant token, so the same browser presenting the same token
    // gets the same yes, idempotently, until the code is consumed. A different person behind
    // the same NAT holds a different token and correctly reads as the loser — which is why
    // this is a token and not the visitor id.
    if (
      claimant !== undefined &&
      record.claimedBy !== undefined &&
      record.claimedBy === claimant &&
      record.consumedAt === undefined
    ) {
      return { allow: true, record, replay: true }
    }
    return { allow: false, reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE }
  }
  if (now >= record.expiresAt) return { allow: false, reason: 'invite-expired' }
  return { allow: true, record }
}

export type ConsumeDecision =
  | { allow: true; record: InviteRecord }
  | { allow: false; reason: InviteRefusalReason }

/**
 * Pure decision — does NOT mutate. Whether a burned code may pay for one sponsored registration.
 *
 * EXPIRY IS NOT RE-CHECKED HERE, and that is a decision rather than an oversight. The TTL bounds
 * how long a code stays CLAIMABLE — the window in which a link can still be picked up. Once it is
 * claimed the burn has happened, and refusing the submission afterwards would strand a real
 * invitee in the middle of the five-screen ceremony for the crime of reading carefully. What
 * stops a claimed-and-forgotten code from being an open-ended liability is that it waives one
 * cap, the global budget still binds behind it, and the record is pruned after
 * `INVITE_RETENTION_MS`.
 */
export function decideConsume(
  invites: readonly InviteRecord[],
  code: string,
  _now: number,
): ConsumeDecision {
  const record = invites.find((i) => i.code === code)
  if (!record) return { allow: false, reason: 'invite-not-found' }
  if (record.claimedAt === undefined) return { allow: false, reason: 'invite-not-claimed' }
  if (record.consumedAt !== undefined) return { allow: false, reason: 'invite-consumed' }
  return { allow: true, record }
}

/**
 * What the sender's ladder sees. `consumed` reads as `claimed` — see `InviteState` for why.
 *
 * A CLAIMED CODE PAST ITS TTL READS AS `claimed`, NOT `expired`. The ladder's question is whether
 * anybody turned up, and somebody did.
 */
export function inviteStateOf(record: InviteRecord | undefined, now: number): InviteState | null {
  if (!record) return null
  if (record.claimedAt !== undefined) return 'claimed'
  return now >= record.expiresAt ? 'expired' : 'unclaimed'
}

/**
 * Drops records nothing will ask about again. Pure; the ledger persists the result.
 *
 * A record is kept while EITHER clock still needs it: the retention window (the sender's ladder,
 * the double-pay refusal) or the mint window (`windowMs` may be configured LONGER than the
 * retention, and pruning a mint still inside it would make `mintsInWindow` undercount — an
 * allowance that quietly leaks extra mints, which is the direction a ceiling must never fail).
 */
export function pruned(
  invites: readonly InviteRecord[],
  now: number,
  windowMs: number = 0,
): InviteRecord[] {
  return invites.filter((i) => {
    if (now - i.mintedAt < windowMs) return true
    const finishedAt = Math.max(i.expiresAt, i.claimedAt ?? 0, i.consumedAt ?? 0)
    return now - finishedAt < INVITE_RETENTION_MS
  })
}

// ── The stateful ledger ───────────────────────────────────────────────────────────────────

/**
 * The invite ledger: an allowance, a set of one-time codes, and an atomic burn.
 *
 * `claim` burns a code exactly once. Two concurrent claims of the same code cannot both win,
 * and the reason is the same one `SponsorshipLedger` documents: nothing between the decision,
 * the store write and the memory mutation yields, so there is no window for a second request to
 * observe the unburned state. That is why `InviteStore` is synchronous and must stay one.
 *
 * THE STORE IS WRITTEN BEFORE MEMORY IS MUTATED, on every mutator here, following the 1-5
 * spend-before-mutate discipline. Mutating first and persisting second means a failed write
 * leaves a burn recorded in memory and absent from the file — correct until the next restart
 * resurrects the code, which is precisely the bug durability was added to fix, arriving silently
 * and later. Persisting first makes a write failure a refusal to burn; the exception reaches the
 * caller, who answers 500 rather than entitling a submission.
 *
 * The store is a constructor argument with no default, for the reason `SponsorshipLedger` gives:
 * an in-memory fallback is a ledger that un-burns every code on restart, and the failure is
 * invisible.
 */
export class InviteLedger {
  private state: PersistedInvites
  /** The key that turns a client address into the opaque ids this ledger is keyed by. */
  readonly salt: string

  constructor(
    readonly config: InviteConfig,
    private readonly store: InviteStore,
    now: number = Date.now(),
  ) {
    const loaded = store.load()
    this.salt = loaded.salt
    // Rolled and pruned on the way in, so a ledger last written days ago does not answer today's
    // first claim against a stale attempt day.
    this.state = {
      salt: loaded.salt,
      invites: pruned(loaded.invites, now, config.windowMs),
      attempts: attemptsToday(loaded.attempts, now),
    }
  }

  /** The id `ip`'s rolling allowance is counted under. */
  inviterKey(ip: string): string {
    return inviterKeyFor(ip, this.salt)
  }

  /** Everything the ledger currently holds. A copy, so a caller cannot mutate the state. */
  snapshot(): PersistedInvites {
    return structuredClone(this.state)
  }

  private persist(next: PersistedInvites): void {
    this.store.save(next)
    this.state = next
  }

  /** Mints a code if the inviter's window has room. Success CARRIES the code, at the type level. */
  mint(inviterKey: string, now: number = Date.now()): MintResult {
    const decision = decideMint(this.state.invites, inviterKey, this.config, now)
    if (!decision.allow) return decision
    const record: InviteRecord = {
      code: mintCode(),
      mintedAt: now,
      expiresAt: now + this.config.ttlMs,
      inviterKey,
    }
    this.persist({
      salt: this.state.salt,
      invites: [...pruned(this.state.invites, now, this.config.windowMs), record],
      attempts: attemptsToday(this.state.attempts, now),
    })
    return { ...decision, code: record.code, expiresAt: record.expiresAt }
  }

  /**
   * Atomic one-time burn. True for exactly one caller, ever.
   *
   * The attempt counter and the burn are ONE store write, not two. Two writes would mean a
   * successful claim whose attempt was never recorded if the second failed — and, worse, a
   * moment in which the file says a code is burned while the attempt that burned it is missing.
   */
  claim(code: string, visitor: string, now: number = Date.now(), claimant?: string): ClaimDecision {
    const decision = decideClaim(this.state, code, visitor, this.config, now, claimant)
    // A visitor already over the cap is refused without recording anything: they are already
    // counted, and incrementing past the cap would grow the number without changing the answer.
    if (!decision.allow && decision.reason === 'invite-too-many-attempts') return decision
    // A replay is the winner re-asking — the burn already happened and was already charged, so
    // there is nothing to write and nothing to count. Answering from memory is what makes the
    // retry free.
    if (decision.allow && decision.replay) return decision

    const attempts = attemptsToday(this.state.attempts, now)
    const next: PersistedInvites = {
      salt: this.state.salt,
      invites: decision.allow
        ? this.state.invites.map((i) =>
            i.code === code ? { ...i, claimedAt: now, claimedBy: claimant } : i,
          )
        : this.state.invites,
      attempts: {
        utcDay: attempts.utcDay,
        counts: { ...attempts.counts, [visitor]: (attempts.counts[visitor] ?? 0) + 1 },
      },
    }
    this.persist(next)
    return decision
  }

  /**
   * Whether `consume` would succeed, without writing anything.
   *
   * Split out so `/submit` can refuse a bad code BEFORE it charges the sponsorship budget. A
   * single combined call would have to consume first and refund on a budget refusal, and there
   * is no refund: the code would be spent on a registration that never happened.
   */
  consumable(code: string, now: number = Date.now()): ConsumeDecision {
    return decideConsume(this.state.invites, code, now)
  }

  /** Marks a burned code as having paid for its one registration. */
  consume(code: string, now: number = Date.now()): ConsumeDecision {
    const decision = decideConsume(this.state.invites, code, now)
    if (!decision.allow) return decision
    this.persist({
      salt: this.state.salt,
      invites: this.state.invites.map((i) => (i.code === code ? { ...i, consumedAt: now } : i)),
      attempts: attemptsToday(this.state.attempts, now),
    })
    return decision
  }

  /**
   * Where a code stands, for the sender's ladder.
   *
   * THE CAP IS CHECKED FIRST, BEFORE THE LOOKUP, mirroring `decideClaim` and for the same
   * reason: answering hits while refusing misses would let a capped visitor keep distinguishing
   * live codes from dead ones by the shape of the refusal — which is the exact oracle the cap
   * exists to close. A capped sender polling their own real ladder gets the same refusal; their
   * watcher reads it as an absence of information and keeps polling, which is the honest state.
   *
   * A MISS COSTS AN ATTEMPT; A HIT COSTS NOTHING. Charging misses puts the same ceiling on
   * probing that `claim` has, while a sender polling their own real code is never charged for
   * it however long they watch — a sender only accumulates attempts by getting codes WRONG.
   */
  status(code: string, visitor: string, now: number = Date.now()): StatusDecision {
    const attempts = attemptsToday(this.state.attempts, now)
    if ((attempts.counts[visitor] ?? 0) >= this.config.claimAttemptsPerDay) {
      return { found: false, reason: 'invite-too-many-attempts' }
    }

    const state = inviteStateOf(
      this.state.invites.find((i) => i.code === code),
      now,
    )
    if (state !== null) return { found: true, state }

    this.persist({
      salt: this.state.salt,
      invites: this.state.invites,
      attempts: {
        utcDay: attempts.utcDay,
        counts: { ...attempts.counts, [visitor]: (attempts.counts[visitor] ?? 0) + 1 },
      },
    })
    return { found: false, reason: 'invite-not-found' }
  }

  /**
   * `/submit`'s invite vet: `consumable`, but METERED, because `/submit` is otherwise the one
   * route left that answers "is this code live" without spending anything — a body with a
   * plausible calls array and a guessed code would read the typed refusal for free and without
   * limit, walking around the claim cap the same way the unmetered status route would have.
   *
   * Same asymmetry as everywhere else: a refusal charges the visitor an attempt, a valid claimed
   * code charges nothing, and a visitor past the cap is refused before the code is looked up.
   */
  vetForSubmit(code: string, visitor: string, now: number = Date.now()): ConsumeDecision {
    const attempts = attemptsToday(this.state.attempts, now)
    if ((attempts.counts[visitor] ?? 0) >= this.config.claimAttemptsPerDay) {
      return { allow: false, reason: 'invite-too-many-attempts' }
    }
    const decision = decideConsume(this.state.invites, code, now)
    if (decision.allow) return decision
    this.persist({
      salt: this.state.salt,
      invites: this.state.invites,
      attempts: {
        utcDay: attempts.utcDay,
        counts: { ...attempts.counts, [visitor]: (attempts.counts[visitor] ?? 0) + 1 },
      },
    })
    return decision
  }
}

/** What `InviteLedger.mint` answers: refusals as `decideMint` shapes them, success with the code. */
export type MintResult =
  | { allow: true; left: number; nextInHours: number | null; code: string; expiresAt: number }
  | Extract<MintDecision, { allow: false }>

export type StatusDecision =
  | { found: true; state: InviteState }
  | { found: false; reason: 'invite-not-found' | 'invite-too-many-attempts' }
