//
// Periodic backup verification: the escalating-interval ladder, the store seam, and the composed
// periodic check. Every function is pure and takes `now`; storage is an injected seam whose
// default REFUSES (an unwired app reads as not backed up rather than as fine).
//

import { BACKUP_VERIFICATION_FAILED } from './backup-copy.js'
import { readsAsBackedUp, type BackupStatus, type ShieldedBalancePresence } from './backup-status.js'
import { verifyBackupAgainstKey, type BackupVerification } from './backup-verify.js'

export type { BackupStatus, ShieldedBalancePresence } from './backup-status.js'

/** The ladder, in days. Verified checks climb it; a failed check steps back down. */
export const BACKUP_CADENCE_DAYS = [3, 7, 14, 28] as const

const DAY_MS = 24 * 60 * 60 * 1000

export interface CadenceState {
  /** Index into `BACKUP_CADENCE_DAYS`. Clamped on read, so a corrupted value cannot escape. */
  intervalIndex: number
  /** Epoch ms of the last PASSING verification, or `null` if there has never been one. */
  lastVerifiedAt: number | null
}

export function initialCadence(): CadenceState {
  return { intervalIndex: 0, lastVerifiedAt: null }
}

// THE one place an index is made safe: NaN/fraction/out-of-range fall to the conservative end.
function clampIndex(index: number): number {
  if (!Number.isInteger(index)) {
    return Number.isFinite(index) ? Math.min(Math.max(Math.floor(index), 0), BACKUP_CADENCE_DAYS.length - 1) : 0
  }
  return Math.min(Math.max(index, 0), BACKUP_CADENCE_DAYS.length - 1)
}

export function intervalDays(state: CadenceState): number {
  return BACKUP_CADENCE_DAYS[clampIndex(state.intervalIndex)]!
}

/** Epoch ms, or `null` for "never verified" — which is not a date and must not render as one. */
export function nextCheckDue(state: CadenceState): number | null {
  if (state.lastVerifiedAt === null || !Number.isFinite(state.lastVerifiedAt)) return null
  return state.lastVerifiedAt + intervalDays(state) * DAY_MS
}

/** Never verified, an unusable clock, or a FUTURE `lastVerifiedAt` all read as due. */
export function isCheckDue(state: CadenceState, now: number): boolean {
  if (!Number.isFinite(now)) return true
  if (state.lastVerifiedAt !== null && Number.isFinite(state.lastVerifiedAt) && state.lastVerifiedAt > now) return true
  const due = nextCheckDue(state)
  return due === null || now >= due
}

/** The interval advances ONLY when the session is known to hold value; `lastVerifiedAt` always moves. */
export function advanceOnVerified(state: CadenceState, now: number, balance: ShieldedBalancePresence): CadenceState {
  const index = clampIndex(state.intervalIndex)
  const advance = balance === 'present' && index < BACKUP_CADENCE_DAYS.length - 1
  return { intervalIndex: advance ? index + 1 : index, lastVerifiedAt: now }
}

/** Step back and ask again immediately: the field means "last PASSING check", and there was not one. */
export function stepBackOnFailure(state: CadenceState): CadenceState {
  return { intervalIndex: Math.max(clampIndex(state.intervalIndex) - 1, 0), lastVerifiedAt: null }
}

export interface VerificationOutcome {
  cadence: CadenceState
  status: BackupStatus
}

/** The ONLY producer of `backed-up`. "Passed" means `verifyBackupAgainstKey` returned ok. */
export function onVerificationPassed(state: CadenceState, now: number, balance: ShieldedBalancePresence): VerificationOutcome {
  return { cadence: advanceOnVerified(state, now, balance), status: 'backed-up' }
}

/** A definite `not-backed-up`, not `unknown`: we did not fail to find out, we found out. */
export function onVerificationFailed(state: CadenceState): VerificationOutcome {
  return { cadence: stepBackOnFailure(state), status: 'not-backed-up' }
}

// ── The store seam ────────────────────────────────────────────────────────────────────────

export type StoredCadence =
  | { kind: 'absent' }
  | { kind: 'present'; state: CadenceState; status: BackupStatus }
  | { kind: 'unreadable'; reason: string }

export interface BackupCadenceStore {
  load(): StoredCadence
  save(next: { state: CadenceState; status: BackupStatus }): void
}

/** Refuses in as many words — never an in-memory stub that looks like a real store on a fresh account. */
export const REFUSING_CADENCE_STORE: BackupCadenceStore = {
  load: () => ({ kind: 'unreadable', reason: 'no cadence store is wired yet (story 1.11 owns persistence)' }),
  save: () => {
    throw new Error('no cadence store is wired yet (story 1.11 owns persistence)')
  },
}

export function statusFromStore(stored: StoredCadence): BackupStatus {
  if (!stored || typeof stored !== 'object') return 'unknown'
  if (stored.kind !== 'present') return 'unknown'
  return stored.status === 'backed-up' || stored.status === 'not-backed-up' || stored.status === 'unknown'
    ? stored.status
    : 'unknown'
}

/** A malformed ladder falls back to the fresh one — the shortest interval. */
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

export interface BackupCadenceReading {
  status: BackupStatus
  /** The fail-closed answer. */
  backedUp: boolean
  cadence: CadenceState
  checkDue: boolean
  /** When the next check falls due; `null` only when never verified. Use `checkDue` to decide. */
  dueAt: number | null
}

/** The one call a surface makes. A throwing or empty store reads as unreadable, never as fine. */
export function readBackupCadence(now: number, store: BackupCadenceStore = REFUSING_CADENCE_STORE): BackupCadenceReading {
  let stored: StoredCadence
  try {
    stored = store.load()
    if (!stored || typeof stored !== 'object') {
      stored = { kind: 'unreadable', reason: `the cadence store returned ${String(stored)}` }
    }
  } catch (e) {
    stored = { kind: 'unreadable', reason: String(e) }
  }
  const status = statusFromStore(stored)
  const cadence = cadenceFromStore(stored)
  return { status, backedUp: readsAsBackedUp(status), cadence, checkDue: isCheckDue(cadence, now), dueAt: nextCheckDue(cadence) }
}

// ── The composed periodic check ───────────────────────────────────────────────────────────

export interface PeriodicVerificationInput {
  file: string
  recoveryCode: string
  /** The key this account is using NOW. */
  accountKey: string
  now: number
  cadence: CadenceState
  balance?: ShieldedBalancePresence
  /** A save failure never fails the check. */
  store?: BackupCadenceStore
  verify?: typeof verifyBackupAgainstKey
}

export interface PeriodicVerificationResult {
  verification: BackupVerification
  outcome: VerificationOutcome
  /** The sentence for this result, or `null` when it passed. */
  message: string | null
  /** False when the check passed but persisting it did not. The check still counted. */
  persisted: boolean
}

/** Check the backup, move the ladder, persist — three steps a surface must not do two-thirds of. */
export async function runPeriodicVerification(input: PeriodicVerificationInput): Promise<PeriodicVerificationResult> {
  const verify = input.verify ?? verifyBackupAgainstKey
  const balance = input.balance ?? 'unknown'
  let verification: BackupVerification
  try {
    verification = await verify(input.file, input.recoveryCode, input.accountKey)
  } catch {
    // The verifier is injectable; a check that could not run is a check that did not pass.
    verification = { ok: false, reason: 'undecryptable', message: BACKUP_VERIFICATION_FAILED }
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
  return { verification, outcome, message: verification.ok ? null : verification.message, persisted }
}
