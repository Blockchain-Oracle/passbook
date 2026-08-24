import { describe, it, expect } from 'vitest'
import * as session from '../src/session.js'
import { forgetAccountKey } from '../src/session-key.js'

//
// `session.ts` is the front door epic 6 builds against, and until this file existed nothing
// imported it — vitest only transpiles what a test reaches, and there is no typecheck in the
// test gate. A syntax error in the barrel, or an export silently dropped during a rename, would
// have shipped green and surfaced as a broken import in somebody else's story. Importing it
// here is the cheapest possible parse: the module is loaded, so it must at least be valid, and
// the names below must at least exist.
//

describe('the session barrel loads and surfaces the three adapters (G6)', () => {
  it('is a module that parses and evaluates at all', () => {
    expect(typeof session).toBe('object')
  })

  it('surfaces the storage tier', () => {
    for (const name of [
      'browserSessionStore',
      'inMemorySessionStore',
      'localStorageSessionStore',
      'probeLocalStorage',
      'refusingSessionStore',
    ] as const) {
      expect(typeof session[name], name).toBe('function')
    }
    expect(typeof session.REFUSING_SESSION_STORE).toBe('object')
    expect(Object.values(session.SESSION_KEYS)).toHaveLength(3)
  })

  it('surfaces the key adapter', () => {
    for (const name of ['loadOrCreateAccountKey', 'saveCeremony', 'loadCeremony'] as const) {
      expect(typeof session[name], name).toBe('function')
    }
  })

  it('surfaces the lock adapter', () => {
    for (const name of [
      'createSessionLock',
      'makeAcquireSubmitLock',
      'reduceLock',
      'isLeader',
      'beatsInLockOrder',
      'parseLockMessage',
      'broadcastLockChannel',
      'initialLockState',
    ] as const) {
      expect(typeof session[name], name).toBe('function')
    }
  })

  it('surfaces the cadence adapter', () => {
    for (const name of ['sessionCadenceStore', 'parseStoredCadence', 'serializeCadence'] as const) {
      expect(typeof session[name], name).toBe('function')
    }
  })

  it('surfaces every sentence a surface has to render', () => {
    expect(session.ACCOUNT_OPEN_IN_ANOTHER_TAB).toBe(
      'This account is open in another tab. That tab is submitting.',
    )
    expect(typeof session.SESSION_STORAGE_UNAVAILABLE).toBe('string')
    expect(session.SUBMISSION_ALREADY_IN_PROGRESS).toBe('A submission is already in progress in this tab.')
    // The thrown reasons a caller may want to branch on.
    for (const name of [
      'SUBMIT_LOCK_ALREADY_HELD',
      'SUBMIT_LOCK_CLOSED',
      'SUBMIT_LOCK_NO_CHANNEL',
      'DUPLICATE_TAB_ID',
      'SESSION_STORE_UNWIRED',
    ] as const) {
      expect(typeof session[name], name).toBe('string')
      expect(session[name].length).toBeGreaterThan(0)
    }
  })

  it('boots the whole tier through the front door, with three imports and no others', () => {
    // What epic 6 actually does, executed. If this compiles and runs, the barrel is wired.
    const store = session.inMemorySessionStore()

    const key = session.loadOrCreateAccountKey(store)
    expect(key.ok && key.created).toBe(true)

    const lock = session.createSessionLock({
      channel: { post: () => {}, listen: () => {}, close: () => {} },
      timer: { setTimeout: () => 0, clearTimeout: () => {} },
    })
    const acquire: () => Promise<() => void> = session.makeAcquireSubmitLock(lock)
    expect(typeof acquire).toBe('function')
    lock.close()

    const cadence = session.sessionCadenceStore(store)
    expect(cadence.load()).toEqual({ kind: 'absent' })
  })

  it('does NOT surface forgetAccountKey — it erases the account key', () => {
    // Deliberately absent from the front door. It exists so a test can reach a fresh state, and
    // a destructive function should not be one autocomplete away from the boot sequence. Still
    // reachable from the module itself, which is the friction that makes the call deliberate.
    expect('forgetAccountKey' in session).toBe(false)
    expect(typeof forgetAccountKey).toBe('function')
  })
})
