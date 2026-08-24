//
// Periodic backup verification: the cadence ladder and the fail-closed status
// (FR-013, story 1.8, AC5).
//
// Signal's escalating-interval model, applied to the one thing here that cannot be replaced.
// A user who verified their backup last week is asked again in a week; one who keeps
// verifying is asked less often; one whose check FAILS is asked sooner, because a backup that
// just failed to open is the state this whole mechanism exists to detect.
//
// EVERY FUNCTION IS PURE AND TAKES `now`. The clock is a parameter, following
// `relayer/src/sponsorship.ts`: `Date.now()` belongs at the edge, and a ladder that reads the
// clock internally can only be tested by waiting three real days. Nothing in this file
// touches storage or the network either — persistence is story 1.11 and balances are 1.9, and
// both arrive as injected seams that default to "unknown".
//
// ── THE FAIL-CLOSED RULE (Abu ruling, 2026-08-24) ─────────────────────────────────────────
// Backup status is a TRI-STATE internally, and `unknown` collapses to `not-backed-up` at one
// named boundary — `collapseBackupStatus`, below, and nowhere else.
//
// The direction matters and it is the opposite of what the seams' defaults tempt you into.
// "We could not read whether this account is backed up" must produce the nag, not silence.
// Collapsing the other way means a corrupt store, an unwired seam or a first-run race quietly
// reports a safe account, and the one screen that would have told the user to save their key
// never appears. Failing this way is merely annoying; failing the other way is unrecoverable.
// It also makes shipping 1.8 before 1.9 and 1.11 strictly conservative rather than risky:
// with both seams unwired, every account reads as not backed up.
//

import { verifyBackupAgainstKey, type BackupVerification } from './identity.js'
import { BACKUP_STATE_UNKNOWN_NAG, BACKUP_VERIFICATION_FAILED, NO_BACKUP_NAG } from './backup-copy.js'

/** The ladder, in days. Verified checks climb it; a failed check steps back down. */
export const BACKUP_CADENCE_DAYS = [3, 7, 14, 28] as const

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What we know about an account's backup. Three values, not two.
 *
 * `unknown` is not a synonym for `not-backed-up`; it is the difference between "this user has
 * no backup" and "we could not find out", and the two have different causes even though —
 * per the ruling above — they produce the same behaviour. Keeping them distinct internally is
 * what lets a diagnostic say which one happened.
 */
export type BackupStatus = 'backed-up' | 'not-backed-up' | 'unknown'

/**
 * THE named collapse boundary. The only place `unknown` becomes an answer.
 *
 * Every caller asks this rather than comparing a status to a string, so there is exactly one
 * line in the codebase where the fail-closed direction is decided, and changing it is a
 * one-line diff that a reviewer cannot miss.
 */
export function collapseBackupStatus(status: BackupStatus): 'backed-up' | 'not-backed-up' {
  return status === 'backed-up' ? 'backed-up' : 'not-backed-up'
}

/** Convenience over the boundary above. Does not re-decide anything — it calls it. */
export function readsAsBackedUp(status: BackupStatus): boolean {
  return collapseBackupStatus(status) === 'backed-up'
}

// ── The ladder ────────────────────────────────────────────────────────────────────────────

/**
 * Where an account sits on the cadence ladder.
 *
 * `lastVerifiedAt` is the last time a check actually PASSED — not the last time one was
 * attempted. A failed check clears it, so the next check is due immediately rather than in
 * whatever interval the account had climbed to.
 */
export interface CadenceState {
  /** Index into `BACKUP_CADENCE_DAYS`. Clamped on read, so a corrupted value cannot escape. */
  intervalIndex: number
  /** Epoch ms of the last passing verification, or `null` if there has never been one. */
  lastVerifiedAt: number | null
}

/** A fresh ladder: the shortest interval, never verified. */
export function initialCadence(): CadenceState {
  return { intervalIndex: 0, lastVerifiedAt: null }
}

/**
 * The current interval in days, clamping the index into the ladder.
 *
 * Clamped rather than trusted because the index can arrive from a persisted store that story
 * 1.11 owns and this module does not validate. An out-of-range index would otherwise make
 * `BACKUP_CADENCE_DAYS[i]` undefined and every downstream arithmetic `NaN` — and a `NaN`
 * due-date compares false against everything, so the check would silently never be due
 * again. Clamping turns a corrupt index into a conservative one.
 */
export function intervalDays(state: CadenceState): number {
  return BACKUP_CADENCE_DAYS[clampIndex(state.intervalIndex)]!
}

/**
 * THE one place a ladder index is made safe. Everything that does arithmetic on an index
 * routes through this first.
 *
 * Without it the arithmetic propagates the corruption instead of correcting it: `NaN + 1` is
 * `NaN`, so a ladder that once read as `NaN` could never climb again, and `1.5 + 1` is `2.5`,
 * which is not a rung. Clamping only inside `intervalDays` fixed what was DISPLAYED while
 * leaving the stored value broken forever — the transitions have to clamp too.
 */
function clampIndex(index: number): number {
  if (!Number.isInteger(index)) {
    // Not a rung at all. Fall to the shortest interval, which is the conservative end.
    return Number.isFinite(index) ? Math.min(Math.max(Math.floor(index), 0), BACKUP_CADENCE_DAYS.length - 1) : 0
  }
  return Math.min(Math.max(index, 0), BACKUP_CADENCE_DAYS.length - 1)
}

/**
 * When the next verification is due, as epoch ms — or `null` for "due now, and overdue".
 *
 * `null` rather than a number in the past, because "we have never seen this account verify"
 * is not a date and dressing it up as one (epoch zero, say) produces a countdown that renders
 * as decades overdue.
 */
export function nextCheckDue(state: CadenceState): number | null {
  if (state.lastVerifiedAt === null || !Number.isFinite(state.lastVerifiedAt)) return null
  return state.lastVerifiedAt + intervalDays(state) * DAY_MS
}

/**
 * True when a verification should be asked for at `now`. Never verified reads as due.
 *
 * A `lastVerifiedAt` in the FUTURE also reads as due. It can only arrive from a wrong device
 * clock or a tampered store, and taking it at face value is the worst available outcome: a
 * timestamp a year ahead silently suppresses every verification for a year, which is the one
 * failure mode this whole mechanism exists to prevent, arriving quietly and looking healthy.
 * Treating it as due costs one prompt.
 */
export function isCheckDue(state: CadenceState, now: number): boolean {
  // A clock we cannot read is not a clock that says "not yet". Every comparison against `NaN`
  // is false, so an unusable `now` would fall through to `now >= due` and answer NO — silently
  // suppressing every check for as long as the bad value persists. Fail closed: ask.
  if (!Number.isFinite(now)) return true
  if (state.lastVerifiedAt !== null && Number.isFinite(state.lastVerifiedAt) && state.lastVerifiedAt > now) {
    return true
  }
  const due = nextCheckDue(state)
  return due === null || now >= due
}

/**
 * Whether this session has a shielded balance — story 1.9's seam, as a tri-state.
 *
 * A boolean would force the unwired and unreadable cases to pick a side silently, and the
 * side they would pick (`false`) is indistinguishable from a genuinely empty account.
 */
export type ShieldedBalancePresence = 'present' | 'absent' | 'unknown'

/**
 * Records a PASSING verification at `now`.
 *
 * The interval advances ONLY when the session is known to hold a shielded balance (the brief:
 * "advancing only on sessions with a shielded balance"). The ladder is a reward for having
 * demonstrated a working backup while value was actually at risk; climbing it on empty
 * sessions would let an account reach the 28-day interval without ever having verified in a
 * session that mattered, and then start holding money at the slowest cadence.
 *
 * `unknown` does not advance. That is the fail-closed direction here too: not advancing costs
 * one extra prompt, advancing wrongly costs three and a half weeks of not asking.
 *
 * `lastVerifiedAt` moves regardless, because the check did pass — an account that verifies on
 * every empty session should not be asked again on every single one of them.
 */
export function advanceOnVerified(
  state: CadenceState,
  now: number,
  balance: ShieldedBalancePresence,
): CadenceState {
  // Sanitize BEFORE the arithmetic, so a corrupted ladder is repaired by the next verification
  // rather than being carried forward permanently.
  const index = clampIndex(state.intervalIndex)
  const advance = balance === 'present' && index < BACKUP_CADENCE_DAYS.length - 1
  return { intervalIndex: advance ? index + 1 : index, lastVerifiedAt: now }
}

/**
 * Records a FAILED verification: the interval steps backward and the account is asked again
 * immediately.
 *
 * The backward step is in the brief and the UX spine but not in the story's acceptance
 * criteria — it is carried here because the artifacts carry it, and because a ladder that
 * only ever climbs would keep an account whose backup just failed to open on a 28-day
 * cadence. `lastVerifiedAt` is cleared rather than set to `now`: the field means "last
 * PASSING check", and there was not one.
 */
export function stepBackOnFailure(state: CadenceState): CadenceState {
  return { intervalIndex: Math.max(clampIndex(state.intervalIndex) - 1, 0), lastVerifiedAt: null }
}

/** What a verification attempt leaves behind: a new ladder position AND a new status. */
export interface VerificationOutcome {
  cadence: CadenceState
  status: BackupStatus
}

/**
 * A verification that PASSED. The ladder may advance (see `advanceOnVerified`) and the status
 * becomes a definite `backed-up` — the only event in the system that produces that value.
 *
 * "PASSED" MEANS `verifyBackupAgainstKey` IN `identity.ts` RETURNED `ok`, and nothing weaker.
 * That helper decrypts the file with the code AND checks the key inside is the one this
 * account is using now. Calling this after a bare `restoreBackup` success would mark a backup
 * of a PREVIOUS identity as verified — the file opens perfectly and protects nothing the user
 * currently owns, which is precisely the state after a sweep to a new key.
 *
 * Nothing else may set `backed-up`. A ceremony completing means a file was written, not that
 * it was ever successfully opened again.
 */
export function onVerificationPassed(
  state: CadenceState,
  now: number,
  balance: ShieldedBalancePresence,
): VerificationOutcome {
  return { cadence: advanceOnVerified(state, now, balance), status: 'backed-up' }
}

/**
 * A verification that FAILED: the ladder steps backward and the status becomes a definite
 * `not-backed-up` — not `unknown`.
 *
 * The distinction is real. We did not fail to find out; we found out. The user's file and code
 * were tried against their key and did not open it, so the account is known to have no working
 * backup and the copy for that moment (`BACKUP_VERIFICATION_FAILED`) says so plainly.
 *
 * Both failure halves of `verifyBackupAgainstKey` land here, including `different-key` — a
 * file that decrypted cleanly but holds an identity this account no longer uses is not a
 * backup of this account, however intact it is.
 */
export function onVerificationFailed(state: CadenceState): VerificationOutcome {
  return { cadence: stepBackOnFailure(state), status: 'not-backed-up' }
}

// ── The seams (1.9 discovery/balances, 1.11 persistence) ──────────────────────────────────

/**
 * What the cadence store hands back. Three cases, because "never written" and "written and
 * unreadable" are different events even though both currently produce `unknown`.
 *
 * Note the deliberate divergence from `relayer/src/sponsorship-store.ts`, whose corrupt-file
 * rule is a hard startup failure. There, an unreadable ledger that is treated as empty hands
 * the whole daily budget out twice, so refusing to start is the conservative move. Here the
 * conservative move is the opposite: an unreadable cadence file must not stop a user from
 * using their account, it must make the product assume the worst about the backup and say so.
 * Same principle — fail toward the cheaper mistake — landing in different places.
 */
export type StoredCadence =
  | { kind: 'absent' }
  | { kind: 'present'; state: CadenceState; status: BackupStatus }
  | { kind: 'unreadable'; reason: string }

/** Story 1.11 owns the durable implementation. Synchronous, like the sponsorship store. */
export interface BackupCadenceStore {
  load(): StoredCadence
  save(next: { state: CadenceState; status: BackupStatus }): void
}

/**
 * The default store: it refuses, in as many words.
 *
 * NOT an in-memory stub that quietly succeeds. A stub would make the cadence appear to work
 * while forgetting everything on reload, and — because it would answer `absent` rather than
 * `unreadable` — would look identical to a real store on a fresh account. Story 1.11 replaces
 * this with something durable; until then every read says why it could not answer, and the
 * status collapses to not-backed-up.
 */
export const REFUSING_CADENCE_STORE: BackupCadenceStore = {
  load: () => ({
    kind: 'unreadable',
    reason: 'no cadence store is wired yet (story 1.11 owns persistence)',
  }),
  save: () => {
    throw new Error('no cadence store is wired yet (story 1.11 owns persistence)')
  },
}

/**
 * The tri-state status for what the store returned. Neither absent nor unreadable is a "no" —
 * both are "we do not know", and `collapseBackupStatus` is what turns that into behaviour.
 */
export function statusFromStore(stored: StoredCadence): BackupStatus {
  // A store that answered `null` or `undefined` without throwing has not said "backed up".
  // It is a store that returned nothing, which is the definition of unknown.
  if (!stored || typeof stored !== 'object') return 'unknown'
  if (stored.kind !== 'present') return 'unknown'
  // A stored value outside the tri-state is not a status. It reads as `unknown` — which
  // collapses to not-backed-up — rather than being passed through to a comparison that would
  // quietly answer "not backed up" for the right reason by accident, or "backed up" for the
  // wrong one if the collapse were ever inverted.
  return stored.status === 'backed-up' || stored.status === 'not-backed-up' || stored.status === 'unknown'
    ? stored.status
    : 'unknown'
}

/**
 * The cadence to work from: whatever was stored, or a fresh shortest-interval ladder.
 *
 * A store can answer `present` and still hand back rubbish — `state: null`, a missing field,
 * a string where a timestamp goes — because the store is story 1.11's and this module does
 * not own its file format. An unvalidated `null` here reaches `intervalDays` as a property
 * read on null and throws out of a status check that is supposed to fail closed, not crash.
 * A malformed ladder falls back to the fresh one, which is the shortest interval: the same
 * conservative direction the unknown status collapses in.
 */
export function cadenceFromStore(stored: StoredCadence): CadenceState {
  if (!stored || typeof stored !== 'object') return initialCadence()
  if (stored.kind !== 'present') return initialCadence()
  const s = stored.state as Partial<CadenceState> | null | undefined
  if (!s || typeof s !== 'object') return initialCadence()
  const last = s.lastVerifiedAt
  if (last !== null && (typeof last !== 'number' || !Number.isFinite(last))) return initialCadence()
  if (typeof s.intervalIndex !== 'number') return initialCadence()
  return { intervalIndex: s.intervalIndex, lastVerifiedAt: last ?? null }
}

/** What the nag and the verification prompt need, from one read. */
export interface BackupCadenceReading {
  status: BackupStatus
  /** The fail-closed answer. `unknown` has already been collapsed here. */
  backedUp: boolean
  cadence: CadenceState
  checkDue: boolean
  /**
   * When the next check falls due, epoch ms — a PAST timestamp when it is already overdue.
   * `null` only when there has never been a passing verification, which is not a date and
   * must not be rendered as one. Use `checkDue`, not the sign of this, to decide whether to
   * ask; this is for showing the user when.
   */
  dueAt: number | null
}

/**
 * Reads the current backup posture. The one call a surface makes; every seam defaults to a
 * refusal, so an unwired app reads as not backed up rather than as fine.
 */
export function readBackupCadence(
  now: number,
  store: BackupCadenceStore = REFUSING_CADENCE_STORE,
): BackupCadenceReading {
  let stored: StoredCadence
  try {
    stored = store.load()
    // A store can also fail by ANSWERING nothing — returning null or undefined without
    // throwing, which a partially-implemented 1.11 store will do long before it throws.
    // Normalized here so every downstream reader sees a real `StoredCadence`.
    if (!stored || typeof stored !== 'object') {
      stored = { kind: 'unreadable', reason: `the cadence store returned ${String(stored)}` }
    }
  } catch (e) {
    // A store that throws has not said "backed up". Same collapse, reason preserved.
    stored = { kind: 'unreadable', reason: String(e) }
  }
  const status = statusFromStore(stored)
  const cadence = cadenceFromStore(stored)
  return {
    status,
    backedUp: readsAsBackedUp(status),
    cadence,
    checkDue: isCheckDue(cadence, now),
    dueAt: nextCheckDue(cadence),
  }
}

/**
 * Whether the persistent nag should be shown: an account holding value with no backup.
 *
 * Both inputs fail closed, and they fail closed in the same direction for once — an unknown
 * backup status reads as "no backup", and an unknown balance reads as "there may be value
 * here". The nag is a hairline strip, so the cost of showing it to an empty, backed-up
 * account is a line of text; the cost of hiding it from a funded, unbacked one is the account.
 */
export function shouldNagForBackup(
  status: BackupStatus,
  balance: ShieldedBalancePresence,
): boolean {
  return !readsAsBackedUp(status) && balance !== 'absent'
}

/**
 * WHICH nag sentence to show, or `null` for none.
 *
 * The behaviour and the wording are decided separately on purpose. `shouldNagForBackup`
 * collapses `unknown` into "nag", because that is the fail-closed action; this routes on the
 * UNCOLLAPSED status, because the two states are not the same claim. "This account has no
 * backup" is a fact, and an unreadable store is not evidence for it — the user may have a
 * Recovery File in their password manager and a cadence file we simply could not read.
 *
 * So: fail closed in what we DO, stay honest in what we SAY. Both paths nag.
 */
export function backupNagCopy(
  status: BackupStatus,
  balance: ShieldedBalancePresence,
): string | null {
  if (!shouldNagForBackup(status, balance)) return null
  return status === 'not-backed-up' ? NO_BACKUP_NAG : BACKUP_STATE_UNKNOWN_NAG
}

// ── The composed periodic check (AC5) ─────────────────────────────────────────────────────

/** Everything `runPeriodicVerification` needs. The seams default to refusal, as everywhere. */
export interface PeriodicVerificationInput {
  /** The Recovery File the user just dropped on the verification screen. */
  file: string
  /** The code they typed beside it. Canonicalized downstream — paste tolerance is built in. */
  recoveryCode: string
  /** The key this account is using NOW. The comparison that makes this more than a decrypt. */
  accountKey: string
  now: number
  cadence: CadenceState
  balance?: ShieldedBalancePresence
  /** Persisted through, when 1.11 has wired one. A save failure never fails the check. */
  store?: BackupCadenceStore
  /** Injected only by tests; the default is the real composed check. */
  verify?: typeof verifyBackupAgainstKey
}

export interface PeriodicVerificationResult {
  verification: BackupVerification
  outcome: VerificationOutcome
  /** The sentence for this result, or `null` when it passed. Already per-kind. */
  message: string | null
  /** False when the check passed but persisting it did not. The check still counted. */
  persisted: boolean
}

/**
 * One periodic verification, end to end: check the backup, move the ladder, persist the result.
 *
 * COMPOSED FOR THE SAME REASON `verifyBackupAgainstKey` IS. That function exists because a
 * caller with only `restoreBackup` reaches for decrypt-success and calls it verified; this one
 * exists because a caller with only `verifyBackupAgainstKey` still has to remember to advance
 * the ladder on a pass, step it back on a fail, and save either — three steps, in order, where
 * skipping the third means the check the user just performed is forgotten on reload and they
 * are asked again tomorrow. A surface should not be able to do two thirds of this correctly.
 *
 * A FAILED SAVE DOES NOT FAIL THE CHECK. The verification genuinely happened and the in-memory
 * outcome is correct; losing the write means it will be asked for again sooner than necessary,
 * which is the harmless direction. `persisted` reports it rather than hiding it.
 */
export async function runPeriodicVerification(
  input: PeriodicVerificationInput,
): Promise<PeriodicVerificationResult> {
  const verify = input.verify ?? verifyBackupAgainstKey
  const balance = input.balance ?? 'unknown'

  let verification: BackupVerification
  try {
    verification = await verify(input.file, input.recoveryCode, input.accountKey)
  } catch (e) {
    // `verifyBackupAgainstKey` promises never to throw, but it is injectable, and a seam that
    // threw must not take the whole check with it. A check that could not run is a check that
    // did not pass.
    verification = { ok: false, reason: 'undecryptable', message: BACKUP_VERIFICATION_FAILED }
    void e
  }

  const outcome = verification.ok
    ? onVerificationPassed(input.cadence, input.now, balance)
    : onVerificationFailed(input.cadence)

  let persisted = false
  if (input.store) {
    try {
      input.store.save({ state: outcome.cadence, status: outcome.status })
      persisted = true
    } catch {
      persisted = false
    }
  }

  return {
    verification,
    outcome,
    message: verification.ok ? null : verification.message,
    persisted,
  }
}
