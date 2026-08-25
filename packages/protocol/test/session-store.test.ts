import { describe, it, expect } from 'vitest'
import {
  browserSessionStore,
  inMemorySessionStore,
  localStorageSessionStore,
  probeLocalStorage,
  refusingSessionStore,
  REFUSING_SESSION_STORE,
  SESSION_KEYS,
  SESSION_STORE_UNWIRED,
  type SessionStore,
} from '../src/session-store.js'
import { SESSION_STORAGE_UNAVAILABLE } from '../src/session-copy.js'

/**
 * A Storage-shaped double, so the probe can be pointed at each way a real one fails.
 *
 * `key(i)` is a real index into the insertion order rather than a stub, because the probe's
 * stale-key sweep enumerates the storage and a `key: () => null` would make the sweep look
 * like it worked while visiting nothing.
 */
function fakeStorage(over: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    ...over,
  } as Storage
}

describe('the session store interface (G1)', () => {
  it('an in-memory store reads back what it was given, and null for what it was not', () => {
    const store = inMemorySessionStore()
    expect(store.read(SESSION_KEYS.cadence)).toBeNull()
    store.write(SESSION_KEYS.accountKey, 'one')
    expect(store.read(SESSION_KEYS.accountKey)).toBe('one')
    store.remove(SESSION_KEYS.accountKey)
    expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
  })

  it('seeds from a plain object, so a test can start from a written state', () => {
    expect(inMemorySessionStore({ [SESSION_KEYS.accountKey]: '0x1' }).read(SESSION_KEYS.accountKey)).toBe('0x1')
  })

  it('there are exactly four keys, and every one of them is namespaced', () => {
    // The list is closed on purpose — see `session.ts`'s storage boundary. A new value arriving
    // here is a decision, not a detail, so the count is asserted.
    //
    // IT WENT FROM THREE TO FOUR IN STORY 1.14, and this line failing is exactly how that
    // decision was surfaced for review. `passbook.invite-intents` holds what the SENDER TYPED
    // when they attached money to an invite — a recipient, a token, an amount, a state. It is
    // not on the MUST-NEVER list because nothing in it is decrypted, discovered or read out of
    // the pool; the full argument is at `session-invite-store.ts`. Anyone raising this number
    // again owes the same argument.
    const keys = Object.values(SESSION_KEYS)
    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(4)
    for (const key of keys) expect(key.startsWith('passbook.')).toBe(true)
  })
})

describe('the default store refuses rather than pretending (G1)', () => {
  it('every method throws, with a named reason', () => {
    expect(() => REFUSING_SESSION_STORE.read(SESSION_KEYS.accountKey)).toThrow(SESSION_STORE_UNWIRED)
    expect(() => REFUSING_SESSION_STORE.write(SESSION_KEYS.accountKey, 'v')).toThrow(SESSION_STORE_UNWIRED)
    expect(() => REFUSING_SESSION_STORE.remove(SESSION_KEYS.accountKey)).toThrow(SESSION_STORE_UNWIRED)
  })

  it('never answers null for a read it could not perform', () => {
    // The distinction the whole tier rests on: "nothing is stored" is a fact a caller acts on
    // by generating a key, and a broken store must not be able to produce it.
    let answered: unknown = 'not called'
    try {
      answered = REFUSING_SESSION_STORE.read(SESSION_KEYS.accountKey)
    } catch {
      answered = 'threw'
    }
    expect(answered).toBe('threw')
  })

  it('carries the reason it was built with', () => {
    expect(() => refusingSessionStore('quota is full').read(SESSION_KEYS.accountKey)).toThrow('quota is full')
  })
})

describe('the localStorage feature probe is a round trip, never a typeof (G1)', () => {
  it('accepts a storage that keeps what it is given', () => {
    const probe = probeLocalStorage(fakeStorage())
    expect(probe.ok).toBe(true)
  })

  it('leaves nothing behind — the probe key is removed', () => {
    const storage = fakeStorage()
    probeLocalStorage(storage)
    expect(storage.length).toBe(0)
  })

  it("REJECTS Node's localStorage stub, which is the exact false positive typeof produces", () => {
    // This is not hypothetical. On a Node that exposes Web Storage, `localStorage` is an object
    // (so `typeof localStorage === 'object'` passes) whose `setItem` is undefined. A presence
    // check hands back a store that throws a TypeError on the first write — which is the write
    // that saves a freshly generated account key.
    //
    // The stub is INSTALLED here, never read off the host. Whether a given Node supplies one is a
    // version fact (25 unflagged Web Storage; 24 keeps it behind --experimental-webstorage), so
    // branching on the host would run this — the load-bearing case — only where the host happens
    // to cooperate. On the pinned major it never does: `probeLocalStorage()` would instead take
    // the no-storage early return, a path `probeLocalStorage(null)` already covers below, and a
    // probe that trusted the global without round-tripping would sail through unnoticed. Owning
    // the stub makes this fact hold identically on every Node.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} })
    try {
      // The double really is the shape a presence check waves through: an object, no `setItem`.
      const stub = (globalThis as { localStorage?: unknown }).localStorage
      expect(typeof stub).toBe('object')
      expect(typeof (stub as { setItem?: unknown })?.setItem).toBe('undefined')

      // And the probe rejects it anyway, because it round trips instead of sniffing.
      expect(probeLocalStorage().ok).toBe(false)
      expect(localStorageSessionStore()).toBeNull()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('rejects a storage whose writes throw — Safari private mode, and a full quota', () => {
    const probe = probeLocalStorage(
      fakeStorage({
        setItem: () => {
          throw new DOMException('QuotaExceededError')
        },
      }),
    )
    expect(probe.ok).toBe(false)
    expect(!probe.ok && probe.reason).toMatch(/round trip threw/)
  })

  it('rejects a storage that accepts a write and forgets it', () => {
    // A write-only probe would wave this through. Reading the value back is what catches it.
    const probe = probeLocalStorage(fakeStorage({ setItem: () => {}, getItem: () => null }))
    expect(probe.ok).toBe(false)
    expect(!probe.ok && probe.reason).toMatch(/does not keep what it is given/)
  })

  it('rejects a storage that reads back something else entirely', () => {
    const probe = probeLocalStorage(fakeStorage({ getItem: () => 'someone elses value' }))
    expect(probe.ok).toBe(false)
  })

  it('reports the absence of any storage rather than throwing', () => {
    const probe = probeLocalStorage(null)
    expect(probe.ok).toBe(false)
    expect(!probe.ok && probe.reason).toMatch(/no localStorage/)
  })
})

describe('a store over a working localStorage (G1)', () => {
  it('round-trips through the real Storage API', () => {
    const storage = fakeStorage()
    const store = localStorageSessionStore(storage) as SessionStore
    expect(store).not.toBeNull()
    store.write(SESSION_KEYS.accountKey, '0xabc')
    expect(storage.getItem(SESSION_KEYS.accountKey)).toBe('0xabc')
    expect(store.read(SESSION_KEYS.accountKey)).toBe('0xabc')
    store.remove(SESSION_KEYS.accountKey)
    expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
  })

  it('browserSessionStore hands back the durable store when there is one', () => {
    const store = browserSessionStore(fakeStorage())
    store.write(SESSION_KEYS.accountKey, 'v')
    expect(store.read(SESSION_KEYS.accountKey)).toBe('v')
  })

  it('browserSessionStore refuses — never falls back to memory — when there is not', () => {
    // An in-memory fallback here is an account whose key is forgotten on the next reload,
    // after the pool has already written its viewing key once and refused to write another.
    const store = browserSessionStore(null)
    expect(() => store.write(SESSION_KEYS.accountKey, 'v')).toThrow(SESSION_STORAGE_UNAVAILABLE)
    expect(() => store.read(SESSION_KEYS.accountKey)).toThrow(SESSION_STORAGE_UNAVAILABLE)
    expect(() => store.remove(SESSION_KEYS.accountKey)).toThrow(SESSION_STORAGE_UNAVAILABLE)
  })

  it('the refusal IS the exported sentence, so the copy cannot drift from the condition', () => {
    // The same discipline the lock follows with `ACCOUNT_OPEN_IN_ANOTHER_TAB`: the sentence a
    // surface renders is produced by the code path that describes it, not typed twice.
    const error = (() => {
      try {
        browserSessionStore(null).read(SESSION_KEYS.accountKey)
        return null
      } catch (e) {
        return e as Error
      }
    })()
    expect(error).not.toBeNull()
    expect(error!.message.startsWith(SESSION_STORAGE_UNAVAILABLE)).toBe(true)
  })

  it('the refusal also names what the probe actually found, for the log', () => {
    expect(() =>
      browserSessionStore(
        fakeStorage({
          setItem: () => {
            throw new Error('blocked by the user')
          },
        }),
      ).read(SESSION_KEYS.accountKey),
    ).toThrow(/blocked by the user/)
  })

  it('reaching a localStorage that throws on ACCESS is a refusal, not a boot crash', () => {
    // Firefox with cookies blocked for the origin: the property getter itself throws, before
    // any method is called. Nothing else in the probe would catch it.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      const probe = probeLocalStorage()
      expect(probe.ok).toBe(false)
      expect(!probe.ok && probe.reason).toMatch(/reaching localStorage threw/)
      expect(localStorageSessionStore()).toBeNull()
      // And the boot path answers with a store, not an exception.
      const store = browserSessionStore()
      expect(() => store.read(SESSION_KEYS.accountKey)).toThrow(SESSION_STORAGE_UNAVAILABLE)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('two tabs probing at the same moment do not read each other out of a working storage', () => {
    // On one fixed probe key, tab A writes, tab B overwrites, and A reads back B's witness and
    // declares a perfectly healthy localStorage broken — refusing to create an account in a
    // browser that was fine. The keys carry a nonce so each probe only ever reads its own.
    const storage = fakeStorage()
    const keysSeen: string[] = []
    const racing = fakeStorage({
      setItem: (k: string, v: string) => {
        keysSeen.push(k)
        storage.setItem(k, v)
        // The other tab's probe, interleaved at the worst possible moment.
        probeLocalStorage(storage)
      },
      getItem: (k: string) => storage.getItem(k),
      removeItem: (k: string) => storage.removeItem(k),
    })

    expect(probeLocalStorage(racing).ok).toBe(true)
    expect(keysSeen.every((k) => k.startsWith('passbook.storage-probe.'))).toBe(true)
    // Two different keys, so neither probe could have read the other's witness.
    expect(new Set(keysSeen).size).toBe(keysSeen.length)
    // Nothing left behind by either probe.
    expect(storage.length).toBe(0)
  })

  it('the nonce does not repeat, even across probes in the same millisecond', () => {
    // `Math.random()` alone is the weak part: two tabs restored together start from the same
    // page, and some engines seed a fresh context's PRNG in a way that makes the first draw
    // correlate. A monotonic counter cannot collide within a context.
    const keys: string[] = []
    const storage = fakeStorage({
      setItem: (k: string) => void keys.push(k),
      getItem: () => null,
      removeItem: () => {},
    })
    for (let i = 0; i < 500; i++) probeLocalStorage(storage)
    expect(new Set(keys).size).toBe(500)
  })

  it('sweeps probe keys a crashed tab left behind', () => {
    // Per-probe keys fixed the read-each-other race and introduced this in its place: a tab
    // killed between setItem and removeItem leaves its key forever, which on a single fixed key
    // was self-healing. Quota is finite and nothing will ever read these again.
    const storage = fakeStorage()
    // Keys carry their write time as the first nonce segment, base 36. These are from an hour
    // ago, which is the only thing that makes them safe to remove.
    const anHourAgo = (Date.now() - 3_600_000).toString(36)
    storage.setItem(`passbook.storage-probe.${anHourAgo}-1-abandoned`, 'probe-x')
    storage.setItem(`passbook.storage-probe.${anHourAgo}-2-abandoned`, 'probe-y')
    storage.setItem(SESSION_KEYS.accountKey, '0xabc')

    expect(probeLocalStorage(storage).ok).toBe(true)

    expect(storage.getItem(`passbook.storage-probe.${anHourAgo}-1-abandoned`)).toBeNull()
    expect(storage.getItem(`passbook.storage-probe.${anHourAgo}-2-abandoned`)).toBeNull()
    // And it swept ONLY those — the account key is untouched.
    expect(storage.getItem(SESSION_KEYS.accountKey)).toBe('0xabc')
    expect(storage.length).toBe(1)
  })

  it('does NOT sweep a probe key that another tab is using right now', () => {
    // The sweep must not put back the race the per-probe keys removed. A blanket "delete every
    // probe key but mine" deletes the in-flight key of a tab probing concurrently, and that tab
    // then reads back null and declares a healthy storage broken.
    const storage = fakeStorage()
    const justNow = Date.now().toString(36)
    storage.setItem(`passbook.storage-probe.${justNow}-9-inflight`, 'probe-live')

    expect(probeLocalStorage(storage).ok).toBe(true)
    expect(storage.getItem(`passbook.storage-probe.${justNow}-9-inflight`)).toBe('probe-live')
  })

  it('leaves a probe key whose age it cannot read — an unreadable date is not abandonment', () => {
    const storage = fakeStorage()
    storage.setItem('passbook.storage-probe.who-knows', 'probe-mystery')
    expect(probeLocalStorage(storage).ok).toBe(true)
    expect(storage.getItem('passbook.storage-probe.who-knows')).toBe('probe-mystery')
  })

  it('a storage that will not enumerate still passes, if it round-trips', () => {
    // The sweep is a courtesy. Failing a probe over it would refuse a storage that had just
    // demonstrated it works, which is the wrong answer to "does this storage work".
    const probe = probeLocalStorage(
      fakeStorage({
        key: () => {
          throw new Error('enumeration is not supported here')
        },
      }),
    )
    expect(probe.ok).toBe(true)
  })
})
