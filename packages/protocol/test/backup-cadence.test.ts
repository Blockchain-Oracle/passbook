import { describe, it, expect } from 'vitest'
import {
  BACKUP_CADENCE_DAYS, collapseBackupStatus, readsAsBackedUp, initialCadence, intervalDays,
  nextCheckDue, isCheckDue, advanceOnVerified, stepBackOnFailure, statusFromStore,
  cadenceFromStore, readBackupCadence, shouldNagForBackup, REFUSING_CADENCE_STORE,
  onVerificationPassed, onVerificationFailed, runPeriodicVerification, backupNagCopy,
  type BackupStatus, type CadenceState, type ShieldedBalancePresence, type StoredCadence,
  type BackupCadenceStore,
} from '../src/backup-cadence.js'
import { BACKUP_STATE_UNKNOWN_NAG, NO_BACKUP_NAG } from '../src/backup-copy.js'
import { createBackup, generateIdentity } from '../src/identity.js'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 7, 24, 12, 0, 0)
const ALL_STATUSES: BackupStatus[] = ['backed-up', 'not-backed-up', 'unknown']
const ALL_BALANCES: ShieldedBalancePresence[] = ['present', 'absent', 'unknown']

/** A store that answers with exactly what it is given. */
const storeOf = (stored: StoredCadence): BackupCadenceStore => ({
  load: () => stored,
  save: () => {},
})

describe('the fail-closed collapse boundary (AC5, Abu ruling 2026-08-24)', () => {
  it('unknown collapses to not-backed-up — never the reverse', () => {
    expect(collapseBackupStatus('unknown')).toBe('not-backed-up')
    expect(collapseBackupStatus('not-backed-up')).toBe('not-backed-up')
    expect(collapseBackupStatus('backed-up')).toBe('backed-up')
  })

  it('ONLY an explicit backed-up reads as backed up', () => {
    for (const s of ALL_STATUSES) {
      expect(readsAsBackedUp(s), s).toBe(s === 'backed-up')
    }
  })

  it('the tri-state is genuinely three values — unknown is not a synonym', () => {
    // Distinct internally even though two of them behave alike, so a diagnostic can say which
    // happened: "this user has no backup" and "we could not find out" have different causes.
    expect(new Set(ALL_STATUSES).size).toBe(3)
    expect(statusFromStore({ kind: 'absent' })).toBe('unknown')
    expect(statusFromStore({ kind: 'unreadable', reason: 'corrupt' })).toBe('unknown')
    expect(statusFromStore({ kind: 'present', state: initialCadence(), status: 'not-backed-up' }))
      .toBe('not-backed-up')
  })
})

describe('the cadence ladder (AC5)', () => {
  it('is 3 → 7 → 14 → 28 days', () => {
    expect([...BACKUP_CADENCE_DAYS]).toEqual([3, 7, 14, 28])
  })

  it('advances one rung per verified session that holds a shielded balance', () => {
    let state = initialCadence()
    const seen: number[] = [intervalDays(state)]
    for (let i = 0; i < 5; i++) {
      state = advanceOnVerified(state, T0 + i * DAY, 'present')
      seen.push(intervalDays(state))
    }
    // Climbs the ladder and then stays at the top — never past the end of the array.
    expect(seen).toEqual([3, 7, 14, 28, 28, 28])
  })

  it('does NOT advance without a shielded balance, but still records the passing check', () => {
    for (const balance of ['absent', 'unknown'] as const) {
      const before = initialCadence()
      const after = advanceOnVerified(before, T0, balance)
      expect(intervalDays(after), balance).toBe(3)          // ladder unmoved
      expect(after.lastVerifiedAt, balance).toBe(T0)        // the check still passed
      expect(isCheckDue(after, T0), balance).toBe(false)    // so it is not immediately due again
    }
  })

  it('steps BACKWARD on a failed check, and asks again immediately', () => {
    // In the brief and the UX spine, absent from the story's AC — carried because the
    // artifacts carry it. A ladder that only climbs leaves a just-failed backup on 28 days.
    let state = initialCadence()
    for (let i = 0; i < 3; i++) state = advanceOnVerified(state, T0, 'present')
    expect(intervalDays(state)).toBe(28)

    state = stepBackOnFailure(state)
    expect(intervalDays(state)).toBe(14)
    expect(state.lastVerifiedAt).toBeNull()      // "last PASSING check" — and there was not one
    expect(isCheckDue(state, T0)).toBe(true)
  })

  it('never steps below the shortest interval', () => {
    let state = initialCadence()
    for (let i = 0; i < 5; i++) state = stepBackOnFailure(state)
    expect(intervalDays(state)).toBe(3)
    expect(state.intervalIndex).toBe(0)
  })

  it('a check is due exactly one interval after the last passing one', () => {
    const verified = advanceOnVerified(initialCadence(), T0, 'absent')   // stays on 3 days
    expect(nextCheckDue(verified)).toBe(T0 + 3 * DAY)
    expect(isCheckDue(verified, T0 + 3 * DAY - 1)).toBe(false)
    expect(isCheckDue(verified, T0 + 3 * DAY)).toBe(true)
    expect(isCheckDue(verified, T0 + 4 * DAY)).toBe(true)
  })

  it('never verified reads as due now, and as no date at all', () => {
    const fresh = initialCadence()
    expect(nextCheckDue(fresh)).toBeNull()       // not epoch zero — that renders decades overdue
    expect(isCheckDue(fresh, T0)).toBe(true)
    expect(isCheckDue(fresh, 0)).toBe(true)
  })

  it('clamps a corrupted interval index instead of producing NaN', () => {
    // An out-of-range index would make BACKUP_CADENCE_DAYS[i] undefined and every downstream
    // comparison false — so the check would silently never be due again. Clamping turns a
    // corrupt index into a conservative one.
    const corrupt: CadenceState[] = [
      { intervalIndex: -5, lastVerifiedAt: T0 },
      { intervalIndex: 99, lastVerifiedAt: T0 },
      { intervalIndex: 1.5, lastVerifiedAt: T0 },
      { intervalIndex: NaN, lastVerifiedAt: T0 },
    ]
    for (const state of corrupt) {
      const days = intervalDays(state)
      expect(Number.isFinite(days), String(state.intervalIndex)).toBe(true)
      expect(BACKUP_CADENCE_DAYS as readonly number[]).toContain(days)
      expect(Number.isFinite(nextCheckDue(state)!)).toBe(true)
    }
    // A non-finite lastVerifiedAt is "never verified", not a date.
    expect(nextCheckDue({ intervalIndex: 0, lastVerifiedAt: NaN })).toBeNull()
  })

  it('a corrupted ladder is REPAIRED by the next transition, not carried forever', () => {
    // Clamping only inside intervalDays fixed what was displayed and left the stored value
    // broken: `NaN + 1` is `NaN`, so a ladder that once read as NaN could never climb again,
    // and `1.5 + 1` is `2.5`, which is not a rung. The transitions have to clamp too.
    const corrupt: CadenceState[] = [
      { intervalIndex: NaN, lastVerifiedAt: T0 },
      { intervalIndex: 1.5, lastVerifiedAt: T0 },
      { intervalIndex: -5, lastVerifiedAt: T0 },
      { intervalIndex: 99, lastVerifiedAt: T0 },
      { intervalIndex: Infinity, lastVerifiedAt: T0 },
      { intervalIndex: '2' as never, lastVerifiedAt: T0 },
    ]
    for (const state of corrupt) {
      const label = String(state.intervalIndex)
      for (const next of [advanceOnVerified(state, T0, 'present'), stepBackOnFailure(state)]) {
        expect(Number.isInteger(next.intervalIndex), label).toBe(true)
        expect(next.intervalIndex, label).toBeGreaterThanOrEqual(0)
        expect(next.intervalIndex, label).toBeLessThan(BACKUP_CADENCE_DAYS.length)
        expect(BACKUP_CADENCE_DAYS as readonly number[]).toContain(intervalDays(next))
      }
    }
  })

  it('a ladder corrupted to NaN can climb again', () => {
    let state: CadenceState = { intervalIndex: NaN, lastVerifiedAt: null }
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      state = advanceOnVerified(state, T0 + i * DAY, 'present')
      seen.push(intervalDays(state))
    }
    expect(seen).toEqual([7, 14, 28, 28])
  })

  it('a lastVerifiedAt in the FUTURE reads as due, not as three years of silence', () => {
    // It can only come from a wrong device clock or a tampered store. Believing it silently
    // suppresses every verification until that date — the exact failure this mechanism
    // exists to catch, arriving quietly and looking healthy. Treating it as due costs one
    // prompt.
    const skewed: CadenceState = { intervalIndex: 3, lastVerifiedAt: T0 + 365 * DAY }
    expect(isCheckDue(skewed, T0)).toBe(true)
    // A verification one second from now is still the future, and still due.
    expect(isCheckDue({ intervalIndex: 0, lastVerifiedAt: T0 + 1 }, T0)).toBe(true)
    // Exactly now is not the future; the ordinary interval governs.
    expect(isCheckDue({ intervalIndex: 0, lastVerifiedAt: T0 }, T0)).toBe(false)
  })

  it('every ladder function is pure — the input state is never mutated', () => {
    const state = initialCadence()
    const snapshot = { ...state }
    advanceOnVerified(state, T0, 'present')
    stepBackOnFailure(state)
    intervalDays(state)
    isCheckDue(state, T0)
    expect(state).toEqual(snapshot)
  })

  it('takes the clock as a parameter and never reads it — same value, same answer', () => {
    const state = { intervalIndex: 0, lastVerifiedAt: T0 }
    expect(isCheckDue(state, T0 + 2 * DAY)).toBe(isCheckDue(state, T0 + 2 * DAY))
    expect(advanceOnVerified(state, T0, 'present')).toEqual(advanceOnVerified(state, T0, 'present'))
  })
})

describe('a verification attempt sets the ladder AND the status (AC5 matrix)', () => {
  it('a passing check in a session with a balance advances and reports backed-up', () => {
    const out = onVerificationPassed(initialCadence(), T0, 'present')
    expect(out.status).toBe('backed-up')
    expect(intervalDays(out.cadence)).toBe(7)
    expect(readsAsBackedUp(out.status)).toBe(true)
  })

  it('a passing check without a balance still reports backed-up, but does not advance', () => {
    const out = onVerificationPassed(initialCadence(), T0, 'absent')
    expect(out.status).toBe('backed-up')
    expect(intervalDays(out.cadence)).toBe(3)
  })

  it('a failing check steps backward and reports not-backed-up — not unknown', () => {
    // We did not fail to find out; we found out. The file and code were tried against the key
    // and did not open it, so the account is KNOWN to have no working backup.
    let state = initialCadence()
    for (let i = 0; i < 2; i++) state = advanceOnVerified(state, T0, 'present')
    expect(intervalDays(state)).toBe(14)

    const out = onVerificationFailed(state)
    expect(out.status).toBe('not-backed-up')
    expect(out.status).not.toBe('unknown')
    expect(intervalDays(out.cadence)).toBe(7)
    expect(readsAsBackedUp(out.status)).toBe(false)
    expect(isCheckDue(out.cadence, T0)).toBe(true)
  })

  it('backed-up is only ever produced by a passing verification', () => {
    // Completing the ceremony means a file was written, not that it was ever opened again.
    // Only a real decrypt-and-compare proves the backup works.
    expect(onVerificationFailed(initialCadence()).status).not.toBe('backed-up')
    expect(statusFromStore({ kind: 'absent' })).not.toBe('backed-up')
    expect(statusFromStore({ kind: 'unreadable', reason: 'x' })).not.toBe('backed-up')
  })
})

describe('the injected seams default to refusal, never to a silent success (AC5)', () => {
  it('the default store refuses to answer, and says why', () => {
    const stored = REFUSING_CADENCE_STORE.load()
    expect(stored.kind).toBe('unreadable')
    expect(stored.kind === 'unreadable' && stored.reason).toMatch(/1\.11/)
    // And it refuses to pretend it saved anything, rather than dropping writes silently.
    expect(() => REFUSING_CADENCE_STORE.save({ state: initialCadence(), status: 'backed-up' }))
      .toThrow(/1\.11/)
  })

  it('an unwired app reads as NOT backed up — shipping 1.8 early is conservative', () => {
    const reading = readBackupCadence(T0)
    expect(reading.status).toBe('unknown')
    expect(reading.backedUp).toBe(false)
    expect(reading.checkDue).toBe(true)
  })

  it('a store that THROWS collapses the same way, with the reason preserved', () => {
    const reading = readBackupCadence(T0, {
      load: () => { throw new Error('the cadence file is corrupt') },
      save: () => {},
    })
    expect(reading.status).toBe('unknown')
    expect(reading.backedUp).toBe(false)
  })

  it('reads a real stored backup as backed up, with its ladder intact', () => {
    const state: CadenceState = { intervalIndex: 2, lastVerifiedAt: T0 }
    const reading = readBackupCadence(T0 + DAY, storeOf({ kind: 'present', state, status: 'backed-up' }))
    expect(reading.status).toBe('backed-up')
    expect(reading.backedUp).toBe(true)
    expect(reading.cadence).toEqual(state)
    expect(reading.dueAt).toBe(T0 + 14 * DAY)
    expect(reading.checkDue).toBe(false)
  })

  it('an absent store starts a fresh ladder rather than inventing history', () => {
    expect(cadenceFromStore({ kind: 'absent' })).toEqual(initialCadence())
    expect(cadenceFromStore({ kind: 'unreadable', reason: 'x' })).toEqual(initialCadence())
  })

  it('a store that answers `present` with rubbish falls back to a fresh ladder', () => {
    // The store is story 1.11's and this module does not own its file format, so `present`
    // can still carry nonsense. An unvalidated `state: null` reaches intervalDays as a
    // property read on null and THROWS out of a status check that is supposed to fail closed.
    const rubbish = [
      null, undefined, 'a string', 42, [],
      { intervalIndex: 1 },                                  // no lastVerifiedAt at all
      { lastVerifiedAt: T0 },                                // no index
      { intervalIndex: '2', lastVerifiedAt: T0 },            // index is a string
      { intervalIndex: 1, lastVerifiedAt: 'yesterday' },     // timestamp is a string
      { intervalIndex: 1, lastVerifiedAt: Infinity },
    ]
    for (const state of rubbish) {
      const stored = { kind: 'present', state, status: 'backed-up' } as never as StoredCadence
      expect(() => cadenceFromStore(stored), JSON.stringify(state) ?? 'undefined').not.toThrow()
      expect(cadenceFromStore(stored), JSON.stringify(state) ?? 'undefined').toEqual(initialCadence())
      // And the whole read still answers, fail-closed, instead of throwing.
      expect(() => readBackupCadence(T0, storeOf(stored))).not.toThrow()
      expect(readBackupCadence(T0, storeOf(stored)).checkDue).toBe(true)
    }
  })

  it('a status outside the tri-state reads as unknown, never as backed up', () => {
    for (const status of [null, undefined, 'yes', 'BACKED-UP', 1, {}]) {
      const stored = { kind: 'present', state: initialCadence(), status } as never as StoredCadence
      expect(statusFromStore(stored), String(status)).toBe('unknown')
      expect(readBackupCadence(T0, storeOf(stored)).backedUp, String(status)).toBe(false)
    }
  })

  it('dueAt is a past timestamp when overdue, and null only when never verified', () => {
    // The documented contract, asserted, because the comment and the code disagreed once.
    const verified: CadenceState = { intervalIndex: 0, lastVerifiedAt: T0 }
    const reading = readBackupCadence(T0 + 99 * DAY, storeOf({ kind: 'present', state: verified, status: 'backed-up' }))
    expect(reading.checkDue).toBe(true)
    expect(reading.dueAt).toBe(T0 + 3 * DAY)
    expect(reading.dueAt).toBeLessThan(T0 + 99 * DAY)      // in the past, not null

    const never = readBackupCadence(T0, storeOf({ kind: 'present', state: initialCadence(), status: 'not-backed-up' }))
    expect(never.dueAt).toBeNull()
    expect(never.checkDue).toBe(true)
  })

  it('no combination of unknown seams ever reads as backed up', () => {
    // The property that matters, over the whole cross product rather than a sampled case.
    for (const stored of [
      { kind: 'absent' } as const,
      { kind: 'unreadable', reason: 'corrupt' } as const,
      { kind: 'present', state: initialCadence(), status: 'unknown' } as const,
      { kind: 'present', state: initialCadence(), status: 'not-backed-up' } as const,
    ]) {
      expect(readBackupCadence(T0, storeOf(stored)).backedUp, stored.kind).toBe(false)
    }
  })
})

describe('an unreadable clock and an unreadable store both fail closed (C13/C14)', () => {
  it('a non-finite `now` reads as due rather than silently suppressing every check', () => {
    // Every comparison against NaN is false, so an unusable clock used to fall through to
    // `now >= due` and answer NO — suppressing verification for as long as the bad value
    // persisted, with nothing anywhere reporting a problem.
    const verified: CadenceState = { intervalIndex: 0, lastVerifiedAt: T0 }
    expect(isCheckDue(verified, T0 + 1)).toBe(false)          // a good clock still governs
    for (const now of [NaN, Infinity, -Infinity]) {
      expect(isCheckDue(verified, now), String(now)).toBe(true)
      expect(isCheckDue(initialCadence(), now), String(now)).toBe(true)
    }
  })

  it('a store that ANSWERS nothing is unknown, not backed up', () => {
    // A partially-implemented 1.11 store returns null long before it throws.
    for (const answer of [null, undefined, 'nonsense', 42]) {
      const store = { load: () => answer as never, save: () => {} }
      expect(() => readBackupCadence(T0, store), String(answer)).not.toThrow()
      const reading = readBackupCadence(T0, store)
      expect(reading.status, String(answer)).toBe('unknown')
      expect(reading.backedUp, String(answer)).toBe(false)
      expect(reading.checkDue, String(answer)).toBe(true)
      expect(statusFromStore(answer as never), String(answer)).toBe('unknown')
      expect(cadenceFromStore(answer as never), String(answer)).toEqual(initialCadence())
    }
  })
})

describe('runPeriodicVerification — the composed check (C15)', () => {
  const PASSED = { ok: true } as const
  const failed = (reason: string, message = 'nope') =>
    ({ ok: false, reason, message }) as never

  it('verifies, advances the ladder, and persists — in one call', async () => {
    const saved: Array<{ state: CadenceState; status: BackupStatus }> = []
    const result = await runPeriodicVerification({
      file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
      cadence: initialCadence(), balance: 'present',
      store: { load: () => ({ kind: 'absent' }), save: (n) => { saved.push(n) } },
      verify: async () => PASSED,
    })
    expect(result.verification.ok).toBe(true)
    expect(result.outcome.status).toBe('backed-up')
    expect(intervalDays(result.outcome.cadence)).toBe(7)      // advanced
    expect(result.message).toBeNull()
    expect(result.persisted).toBe(true)
    expect(saved).toEqual([{ state: result.outcome.cadence, status: 'backed-up' }])
  })

  it('steps the ladder BACK and persists that too, on a failed check', async () => {
    const saved: Array<{ state: CadenceState; status: BackupStatus }> = []
    const result = await runPeriodicVerification({
      file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
      cadence: { intervalIndex: 2, lastVerifiedAt: T0 },
      store: { load: () => ({ kind: 'absent' }), save: (n) => { saved.push(n) } },
      verify: async () => failed('different-key', 'that is not your key'),
    })
    expect(result.outcome.status).toBe('not-backed-up')
    expect(intervalDays(result.outcome.cadence)).toBe(7)      // stepped back from 14
    expect(result.message).toBe('that is not your key')       // per-kind, carried through
    expect(saved).toEqual([{ state: result.outcome.cadence, status: 'not-backed-up' }])
  })

  it('a failed SAVE does not fail the check — the verification still happened', async () => {
    const result = await runPeriodicVerification({
      file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
      cadence: initialCadence(), balance: 'present',
      store: { load: () => ({ kind: 'absent' }), save: () => { throw new Error('disk full') } },
      verify: async () => PASSED,
    })
    expect(result.verification.ok).toBe(true)
    expect(result.outcome.status).toBe('backed-up')
    // Reported rather than hidden. Losing the write means asking again sooner than necessary,
    // which is the harmless direction.
    expect(result.persisted).toBe(false)
  })

  it('works with no store at all, and says so', async () => {
    const result = await runPeriodicVerification({
      file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
      cadence: initialCadence(), verify: async () => PASSED,
    })
    expect(result.outcome.status).toBe('backed-up')
    expect(result.persisted).toBe(false)
  })

  it('a verifier that throws is a check that did not pass', async () => {
    const result = await runPeriodicVerification({
      file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
      cadence: initialCadence(),
      verify: async () => { throw new Error('WebCrypto unavailable') },
    })
    expect(result.verification.ok).toBe(false)
    expect(result.outcome.status).toBe('not-backed-up')
  })

  it('does not advance the ladder without a shielded balance', async () => {
    for (const balance of ['absent', 'unknown', undefined] as const) {
      const result = await runPeriodicVerification({
        file: 'f', recoveryCode: 'c', accountKey: '0x1', now: T0,
        cadence: initialCadence(), balance, verify: async () => PASSED,
      })
      expect(intervalDays(result.outcome.cadence), String(balance)).toBe(3)
      expect(result.outcome.status, String(balance)).toBe('backed-up')
    }
  })

  it('runs the REAL composed check by default, not a stub', async () => {
    // No `verify` injected: this goes through verifyBackupAgainstKey and real crypto.
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, {
      backupBlock: 1, auditorKeyAtBackupBlock: '0x1', registrationBlock: null,
    })
    const pass = await runPeriodicVerification({
      file: made.file, recoveryCode: made.recoveryCode, accountKey: privateKey,
      now: T0, cadence: initialCadence(), balance: 'present',
    })
    expect(pass.outcome.status).toBe('backed-up')

    // And a backup of a DIFFERENT identity fails, which decrypt-success alone would not catch.
    const fail = await runPeriodicVerification({
      file: made.file, recoveryCode: made.recoveryCode,
      accountKey: generateIdentity().privateKey,
      now: T0, cadence: initialCadence(), balance: 'present',
    })
    expect(fail.outcome.status).toBe('not-backed-up')
    expect(!fail.verification.ok && fail.verification.reason).toBe('different-key')
  })
})

describe('the persistent nag (`No backup + balance > 0`)', () => {
  it('shows whenever the backup is not proven and value may be at risk', () => {
    const expected: Record<string, boolean> = {
      'backed-up/present': false, 'backed-up/absent': false, 'backed-up/unknown': false,
      'not-backed-up/present': true, 'not-backed-up/absent': false, 'not-backed-up/unknown': true,
      'unknown/present': true, 'unknown/absent': false, 'unknown/unknown': true,
    }
    for (const status of ALL_STATUSES) {
      for (const balance of ALL_BALANCES) {
        const key = `${status}/${balance}`
        expect(shouldNagForBackup(status, balance), key).toBe(expected[key])
      }
    }
  })

  it('an unknown balance nags — a hairline strip is cheaper than a lost account', () => {
    expect(shouldNagForBackup('unknown', 'unknown')).toBe(true)
  })

  it('never nags an account that is provably backed up', () => {
    for (const balance of ALL_BALANCES) {
      expect(shouldNagForBackup('backed-up', balance), balance).toBe(false)
    }
  })

  it('says something HONEST when the status is unknown rather than absent (C17)', () => {
    // Fail closed in what we DO, honest in what we SAY. "This account has no backup" is a
    // factual claim, and an unreadable store is not evidence for it — the user may have a
    // Recovery File in their password manager and a cadence file we could not read.
    expect(backupNagCopy('not-backed-up', 'present')).toBe(NO_BACKUP_NAG)
    expect(backupNagCopy('unknown', 'present')).toBe(BACKUP_STATE_UNKNOWN_NAG)
    expect(backupNagCopy('unknown', 'present')).not.toBe(NO_BACKUP_NAG)

    // Both still nag — the routing changes the sentence, never the behaviour.
    expect(shouldNagForBackup('unknown', 'present')).toBe(true)
    expect(shouldNagForBackup('not-backed-up', 'present')).toBe(true)
  })

  it('the unknown sentence does not claim the account has no backup', () => {
    expect(BACKUP_STATE_UNKNOWN_NAG).not.toContain('has no backup')
    expect(BACKUP_STATE_UNKNOWN_NAG).toMatch(/can't tell|cannot tell/)
  })

  it('routes to no sentence at all exactly when it should not nag', () => {
    for (const status of ALL_STATUSES) {
      for (const balance of ALL_BALANCES) {
        const copy = backupNagCopy(status, balance)
        expect(copy === null, `${status}/${balance}`).toBe(!shouldNagForBackup(status, balance))
        if (copy !== null) expect([NO_BACKUP_NAG, BACKUP_STATE_UNKNOWN_NAG]).toContain(copy)
      }
    }
  })
})
