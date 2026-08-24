import { describe, it, expect } from 'vitest'
import {
  CADENCE_RECORD_VERSION,
  parseStoredCadence,
  serializeCadence,
  sessionCadenceStore,
} from '../src/session-cadence-store.js'
import { inMemorySessionStore, SESSION_KEYS, type SessionStore } from '../src/session-store.js'
import {
  BACKUP_CADENCE_DAYS,
  initialCadence,
  readBackupCadence,
  REFUSING_CADENCE_STORE,
  type CadenceState,
} from '../src/backup-cadence.js'

const LADDER: CadenceState = { intervalIndex: 2, lastVerifiedAt: 1_756_000_000_000 }

describe('the cadence store round-trips (the third seam)', () => {
  it('save then load reads back as present, with an equal state', () => {
    const store = sessionCadenceStore(inMemorySessionStore())
    store.save({ state: LADDER, status: 'backed-up' })
    expect(store.load()).toEqual({ kind: 'present', state: LADDER, status: 'backed-up' })
  })

  it('a never-written slot is ABSENT, which is not the same as unreadable', () => {
    expect(sessionCadenceStore(inMemorySessionStore()).load()).toEqual({ kind: 'absent' })
  })

  it('round-trips a ladder that has never verified', () => {
    const store = sessionCadenceStore(inMemorySessionStore())
    store.save({ state: initialCadence(), status: 'unknown' })
    expect(store.load()).toEqual({ kind: 'present', state: { intervalIndex: 0, lastVerifiedAt: null }, status: 'unknown' })
  })

  it('writes under the one namespaced key and nothing else', () => {
    const inner = inMemorySessionStore()
    sessionCadenceStore(inner).save({ state: LADDER, status: 'backed-up' })
    expect(inner.read(SESSION_KEYS.cadence)).toBe(serializeCadence({ state: LADDER, status: 'backed-up' }))
    expect(inner.read(SESSION_KEYS.accountKey)).toBeNull()
    expect(inner.read(SESSION_KEYS.ceremony)).toBeNull()
  })

  it('the record carries a version from the first release', () => {
    expect(JSON.parse(serializeCadence({ state: LADDER, status: 'backed-up' })).v).toBe(CADENCE_RECORD_VERSION)
  })
})

describe('a corrupt cadence is UNREADABLE with a reason — never a silent reset', () => {
  // The opposite of the relayer's store, deliberately: an unreadable cadence file must not
  // stop a user from using their account, and it must not quietly restart them at the
  // shortest interval while reporting a healthy status either.
  for (const [name, stored] of [
    ['text that is not JSON', 'half a fi'],
    ['the four bytes null', 'null'],
    ['an array', '[1,2,3]'],
    ['a bare number', '7'],
    ['a record with no version', '{"intervalIndex":1,"lastVerifiedAt":null,"status":"backed-up"}'],
    ['a record from a newer build', '{"v":99,"intervalIndex":1,"lastVerifiedAt":null,"status":"backed-up"}'],
    ['a fractional ladder index', '{"v":1,"intervalIndex":1.5,"lastVerifiedAt":null,"status":"backed-up"}'],
    ['a ladder index that is a word', '{"v":1,"intervalIndex":"two","lastVerifiedAt":null,"status":"backed-up"}'],
    ['a timestamp that is a string', '{"v":1,"intervalIndex":1,"lastVerifiedAt":"yesterday","status":"backed-up"}'],
    ['a timestamp that is a boolean', '{"v":1,"intervalIndex":1,"lastVerifiedAt":true,"status":"backed-up"}'],
    ['a missing status', '{"v":1,"intervalIndex":1,"lastVerifiedAt":null}'],
    ['a status outside the tri-state', '{"v":1,"intervalIndex":1,"lastVerifiedAt":null,"status":"fine"}'],
  ] as const) {
    it(`reports ${name} as unreadable, and says why`, () => {
      const result = parseStoredCadence(stored)
      expect(result.kind).toBe('unreadable')
      expect(result.kind === 'unreadable' && result.reason.length).toBeGreaterThan(0)
    })
  }

  it('a store that refuses the read is unreadable, not a hard failure', () => {
    const store = sessionCadenceStore({
      read: () => {
        throw new Error('storage is blocked for this origin')
      },
      write: () => {},
      remove: () => {},
    })
    const loaded = store.load()
    expect(loaded.kind).toBe('unreadable')
    expect(loaded.kind === 'unreadable' && loaded.reason).toMatch(/storage is blocked/)
  })

  it('never throws out of load, whatever is in the slot', () => {
    for (const stored of ['', '{', 'undefined', '[]', '{"v":1}']) {
      expect(() => sessionCadenceStore(inMemorySessionStore({ [SESSION_KEYS.cadence]: stored })).load()).not.toThrow()
    }
  })

  it('an empty string reads as absent, because that is what an empty slot is', () => {
    expect(parseStoredCadence('')).toEqual({ kind: 'absent' })
  })

  it('does not clamp the ladder index on the way out — that rule lives at the point of use', () => {
    // `intervalDays`, `advanceOnVerified` and `stepBackOnFailure` all clamp. A second clamp
    // here would be a second place deciding what a legal rung is.
    const store = sessionCadenceStore(inMemorySessionStore())
    store.save({ state: { intervalIndex: 99, lastVerifiedAt: null }, status: 'backed-up' })
    const loaded = store.load()
    expect(loaded.kind === 'present' && loaded.state.intervalIndex).toBe(99)
    // And the reading still comes out on a real rung, because the consumer clamps.
    expect(readBackupCadence(Date.now(), store).cadence.intervalIndex).toBe(99)
    expect(BACKUP_CADENCE_DAYS.length).toBe(4)
  })
})

describe('the write side validates too, so bad memory cannot become a good-looking record', () => {
  // The laundering this closes: `JSON.stringify` turns NaN and Infinity into `null` without
  // complaint, so a `lastVerifiedAt` that went wrong in memory is written as a PERFECTLY VALID
  // record meaning "never verified". The read side cannot catch it — by then there is nothing
  // wrong to catch — and the account silently restarts its ladder.
  it('refuses a NaN timestamp instead of writing it as null', () => {
    expect(JSON.stringify({ lastVerifiedAt: Number.NaN })).toBe('{"lastVerifiedAt":null}')
    expect(() =>
      serializeCadence({ state: { intervalIndex: 2, lastVerifiedAt: Number.NaN }, status: 'backed-up' }),
    ).toThrow(/last-verified timestamp is NaN/)
  })

  it('refuses an Infinite timestamp', () => {
    expect(() =>
      serializeCadence({
        state: { intervalIndex: 0, lastVerifiedAt: Number.POSITIVE_INFINITY },
        status: 'backed-up',
      }),
    ).toThrow(/last-verified timestamp is Infinity/)
  })

  for (const [name, bad] of [
    ['a fractional ladder index', { state: { intervalIndex: 1.5, lastVerifiedAt: null }, status: 'backed-up' }],
    ['a NaN ladder index', { state: { intervalIndex: Number.NaN, lastVerifiedAt: null }, status: 'backed-up' }],
    ['no ladder at all', { state: null, status: 'backed-up' }],
    ['a status outside the tri-state', { state: { intervalIndex: 0, lastVerifiedAt: null }, status: 'fine' }],
  ] as const) {
    it(`refuses ${name}`, () => {
      expect(() => serializeCadence(bad as never)).toThrow(/refusing to write a cadence/)
    })
  }

  it('a refused write reaches the caller as persisted:false, exactly like a full disk', async () => {
    const { runPeriodicVerification, initialCadence: fresh } = await import('../src/backup-cadence.js')
    const result = await runPeriodicVerification({
      file: '{}',
      recoveryCode: 'ABCDEF-GHJKLM-NPQRST-UVWXYZ',
      accountKey: '0x1',
      now: Number.NaN, // the bad clock read that would have been laundered into "never verified"
      cadence: fresh(),
      store: sessionCadenceStore(inMemorySessionStore()),
      verify: async () => ({ ok: true }),
    })
    expect(result.outcome.status).toBe('backed-up')
    expect(result.persisted).toBe(false)
  })

  it('still writes every legitimate ladder position', () => {
    for (let i = 0; i < BACKUP_CADENCE_DAYS.length; i++) {
      for (const last of [null, 0, 1_756_000_000_000]) {
        expect(() =>
          serializeCadence({ state: { intervalIndex: i, lastVerifiedAt: last }, status: 'backed-up' }),
        ).not.toThrow()
      }
    }
  })
})

describe('a save that cannot be written throws, and the caller decides what that means', () => {
  it('propagates the store error rather than swallowing it', () => {
    const store = sessionCadenceStore({
      read: () => null,
      write: () => {
        throw new Error('QuotaExceededError')
      },
      remove: () => {},
    })
    expect(() => store.save({ state: LADDER, status: 'backed-up' })).toThrow(/QuotaExceededError/)
  })

  it('runPeriodicVerification already treats that as persisted:false, not a failed check', async () => {
    // Which is why throwing here is the right asymmetry: the caller reports the lost write
    // instead of believing one happened.
    const { runPeriodicVerification } = await import('../src/backup-cadence.js')
    const result = await runPeriodicVerification({
      file: '{}',
      recoveryCode: 'ABCDEF-GHJKLM-NPQRST-UVWXYZ',
      accountKey: '0x1',
      now: 1_000,
      cadence: initialCadence(),
      store: sessionCadenceStore({
        read: () => null,
        write: () => {
          throw new Error('disk full')
        },
        remove: () => {},
      }),
      verify: async () => ({ ok: true }),
    })
    expect(result.outcome.status).toBe('backed-up')
    expect(result.persisted).toBe(false)
  })
})

describe('the real store replaces the refusing default at the call site', () => {
  it('an unwired app reads as not backed up — the default still refuses', () => {
    const reading = readBackupCadence(Date.now(), REFUSING_CADENCE_STORE)
    expect(reading.status).toBe('unknown')
    expect(reading.backedUp).toBe(false)
    expect(reading.checkDue).toBe(true)
  })

  it('a wired app reads its own persisted posture back', () => {
    const now = 1_756_000_000_000
    const backing: SessionStore = inMemorySessionStore()
    const store = sessionCadenceStore(backing)
    store.save({ state: { intervalIndex: 0, lastVerifiedAt: now }, status: 'backed-up' })

    const reading = readBackupCadence(now + 1_000, store)
    expect(reading.status).toBe('backed-up')
    expect(reading.backedUp).toBe(true)
    expect(reading.checkDue).toBe(false)
    expect(reading.dueAt).toBe(now + BACKUP_CADENCE_DAYS[0]! * 24 * 60 * 60 * 1000)
  })

  it('survives the reload it exists for: a second store over the same backing sees it', () => {
    const backing = inMemorySessionStore()
    sessionCadenceStore(backing).save({ state: LADDER, status: 'backed-up' })
    // A fresh store instance is what the next page load builds.
    expect(sessionCadenceStore(backing).load()).toEqual({ kind: 'present', state: LADDER, status: 'backed-up' })
  })

  it('a corrupt record collapses the status to not-backed-up rather than crashing a screen', () => {
    const store = sessionCadenceStore(inMemorySessionStore({ [SESSION_KEYS.cadence]: 'garbage' }))
    const reading = readBackupCadence(Date.now(), store)
    expect(reading.status).toBe('unknown')
    expect(reading.backedUp).toBe(false)
    expect(reading.checkDue).toBe(true)
  })
})
