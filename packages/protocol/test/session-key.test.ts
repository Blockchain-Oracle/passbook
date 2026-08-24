import { describe, it, expect } from 'vitest'
import {
  forgetAccountKey,
  loadCeremony,
  loadOrCreateAccountKey,
  MAX_STORED_FILENAME_LENGTH,
  saveCeremony,
} from '../src/session-key.js'
import { inMemorySessionStore, SESSION_KEYS, type SessionStore } from '../src/session-store.js'
import { generateIdentity, isStarkPrivateKey, type BackupHeader } from '../src/identity.js'
import type { BackupCeremonyState } from '../src/backup-gate.js'

/** A store that records every call in order — how the persist-before-return claim is checked. */
function recordingStore(seed: Record<string, string> = {}) {
  const inner = inMemorySessionStore(seed)
  const calls: string[] = []
  const store: SessionStore = {
    read: (k) => {
      calls.push(`read:${k}`)
      return inner.read(k)
    },
    write: (k, v) => {
      calls.push(`write:${k}`)
      inner.write(k, v)
    },
    remove: (k) => {
      calls.push(`remove:${k}`)
      inner.remove(k)
    },
  }
  return { store, calls, inner }
}

const HEADER: BackupHeader = {
  backupBlock: 13_763_801,
  auditorKeyAtBackupBlock: '0x4a1b2c3d',
  registrationBlock: null,
}

const READY: BackupCeremonyState = {
  step: 'ready',
  filename: 'passbook-recovery-block-13763801.json',
  header: HEADER,
}

describe('the account key, first load and every load after (AC1)', () => {
  it('generates, writes, and only THEN returns — the order is the contract', () => {
    const { store, calls, inner } = recordingStore()
    const handedOut: string[] = []

    const result = loadOrCreateAccountKey(store, {
      generate: () => {
        const key = generateIdentity().privateKey
        // Captured at the moment of generation, so the assertion below is about ordering and
        // not about what happened to end up in the store afterwards.
        handedOut.push(key)
        return { privateKey: key }
      },
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.created).toBe(true)
    // Read, LOOK AGAIN, write, then read once more. Neither extra read is ceremony: the one
    // before the write is what stops this tab clobbering a key another tab finished writing
    // while this one was generating, and the one after is what makes two racing tabs return
    // the same key instead of each keeping its own. See the module header.
    expect(calls).toEqual([
      `read:${SESSION_KEYS.accountKey}`,
      `read:${SESSION_KEYS.accountKey}`,
      `write:${SESSION_KEYS.accountKey}`,
      `read:${SESSION_KEYS.accountKey}`,
    ])
    // The returned key is the STORED key, and the write is already done by the time a caller
    // can see it. Handing it out first and writing later produces an identity a registration
    // can burn a viewing key on and a reload then forgets.
    expect(inner.read(SESSION_KEYS.accountKey)).toBe(result.ok && result.accountKey)
    expect(handedOut[0]).toBe(result.ok && result.accountKey)
  })

  it('returns what the store READ BACK, not what the generator produced', async () => {
    // The losing half of a race, in isolation: another tab's write lands between our write and
    // our read. We must walk away with THEIR key, because that is the one the next reload finds
    // — returning ours would let this tab back up and register a key the store does not have.
    const inner = inMemorySessionStore()
    const theirs = generateIdentity().privateKey
    let ours = ''

    const store: SessionStore = {
      read: (k) => inner.read(k),
      write: (k, v) => {
        inner.write(k, v)
        // The other tab wrote last.
        inner.write(k, theirs)
      },
      remove: (k) => inner.remove(k),
    }

    const result = loadOrCreateAccountKey(store, {
      generate: () => {
        ours = generateIdentity().privateKey
        return { privateKey: ours }
      },
    })

    expect(result.ok && result.accountKey).toBe(theirs)
    expect(result.ok && result.accountKey).not.toBe(ours)
    // Still `created: true` — this call did generate, even though it lost.
    expect(result.ok && result.created).toBe(true)
  })

  it('ADOPTS a key another tab wrote while this one was still generating', async () => {
    // Generating is not instant — a CSPRNG draw plus a public-key derivation — and another tab
    // can finish inside that window. Clobbering it means the tab that already handed its key to
    // a backup ceremony watches it get overwritten.
    const inner = inMemorySessionStore()
    const theirs = generateIdentity().privateKey
    let wrote = 0

    const store: SessionStore = {
      read: (k) => inner.read(k),
      write: (k, v) => {
        wrote += 1
        inner.write(k, v)
      },
      remove: (k) => inner.remove(k),
    }

    const result = loadOrCreateAccountKey(store, {
      generate: () => {
        // The other tab lands while we are busy generating.
        inner.write(SESSION_KEYS.accountKey, theirs)
        return { privateKey: generateIdentity().privateKey }
      },
    })

    expect(result.ok && result.accountKey).toBe(theirs)
    // Adopted, not created — and nothing was written over the top of it.
    expect(result.ok && result.created).toBe(false)
    expect(wrote).toBe(0)
    expect(inner.read(SESSION_KEYS.accountKey)).toBe(theirs)
  })

  it('refuses when the store accepts a write and reads back something unusable', async () => {
    const store: SessionStore = {
      read: () => 'not-a-key',
      write: () => {},
      remove: () => {},
    }
    // First read says absent (not a key), the write "succeeds", the re-read still is not a key.
    const result = loadOrCreateAccountKey(store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/did not survive being written/)
  })

  it('a second tab reading the same store gets the same key, created: false', () => {
    const store = inMemorySessionStore()
    const first = loadOrCreateAccountKey(store)
    const second = loadOrCreateAccountKey(store)
    expect(first.ok && second.ok && second.accountKey).toBe(first.ok && first.accountKey)
    expect(second.ok && second.created).toBe(false)
  })

  it('the generated key is a real Stark private key', () => {
    const result = loadOrCreateAccountKey(inMemorySessionStore())
    expect(result.ok && isStarkPrivateKey(result.accountKey)).toBe(true)
  })

  it('a tab race costs one wasted generation and both tabs leave holding the SAME key', () => {
    // The race, played out properly: two callers both find an empty store, both generate, both
    // write, one lands last. What each one RETURNS is the whole question — a tab walking away
    // with the key it generated rather than the key that is stored would back up and register
    // an identity the next reload does not have.
    const inner = inMemorySessionStore()
    const generated: string[] = []
    let bHasRun = false

    // Tab B runs inside tab A's write, which is as close as a synchronous store gets to "both
    // read the empty slot before either wrote".
    const store: SessionStore = {
      read: (k) => inner.read(k),
      write: (k, v) => {
        inner.write(k, v)
        if (!bHasRun) {
          bHasRun = true
          inner.remove(k) // B saw the empty slot too
          const b = loadOrCreateAccountKey(store, { generate: track })
          expect(b.ok).toBe(true)
          bFinal = b.ok ? b.accountKey : ''
        }
      },
      remove: (k) => inner.remove(k),
    }
    const track = () => {
      const key = generateIdentity().privateKey
      generated.push(key)
      return { privateKey: key }
    }
    let bFinal = ''

    const a = loadOrCreateAccountKey(store, { generate: track })

    // Two keys were generated — one of them is waste, and waste is the acceptable cost here.
    expect(generated).toHaveLength(2)
    expect(new Set(generated).size).toBe(2)

    // Both tabs return the same key, and it is the one in the store. This is the assertion the
    // whole re-read exists for: they converge AT GENERATION TIME, before either can act on it.
    expect(a.ok && a.accountKey).toBe(bFinal)
    expect(inner.read(SESSION_KEYS.accountKey)).toBe(bFinal)

    // And every later load agrees with both of them.
    expect(loadOrCreateAccountKey(inner)).toMatchObject({ ok: true, accountKey: bFinal, created: false })
  })
})

describe('a stored value that is not a key (AC1)', () => {
  for (const [name, corrupt] of [
    ['plain garbage', 'hello'],
    ['empty', ''],
    ['zero', '0x0'],
    ['not hex', '0xzzzz'],
    ['a JSON object somebody stored here', '{"privateKey":"0x1"}'],
    ['above the curve order', `0x${(2n ** 252n).toString(16)}`],
  ] as const) {
    it(`treats ${name} as absent: regenerates and persists`, () => {
      const store = inMemorySessionStore({ [SESSION_KEYS.accountKey]: corrupt })
      const result = loadOrCreateAccountKey(store)

      expect(result.ok).toBe(true)
      expect(result.ok && result.created).toBe(true)
      expect(result.ok && isStarkPrivateKey(result.accountKey)).toBe(true)
      // Replaced in the store too, so the next load is a clean `created: false`.
      expect(store.read(SESSION_KEYS.accountKey)).toBe(result.ok && result.accountKey)
      expect(loadOrCreateAccountKey(store)).toMatchObject({ ok: true, created: false })
    })
  }

  it('a corrupt value is never passed onward to derivation', () => {
    // The failure this prevents: `deriveViewingKey` throws on a malformed key, from inside a
    // registration, where the honest outcome is a first-run regeneration instead.
    const store = inMemorySessionStore({ [SESSION_KEYS.accountKey]: 'not-a-key' })
    const result = loadOrCreateAccountKey(store)
    expect(result.ok && result.accountKey).not.toBe('not-a-key')
  })
})

describe('a store that cannot answer produces a typed failure, never a key (AC1)', () => {
  it('a write that fails hands out nothing at all', () => {
    const store: SessionStore = {
      read: () => null,
      write: () => {
        throw new Error('QuotaExceededError')
      },
      remove: () => {},
    }
    const result = loadOrCreateAccountKey(store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/could not save the generated account key/)
    expect(!result.ok && result.reason).toMatch(/QuotaExceededError/)
    expect('accountKey' in result).toBe(false)
  })

  it('a read that throws does NOT generate over what might be there', () => {
    // "I could not look" is not "there is nothing here". A read that threw may be sitting on
    // top of the key this account is already registered with.
    let wrote = false
    const store: SessionStore = {
      read: () => {
        throw new Error('storage is blocked for this origin')
      },
      write: () => {
        wrote = true
      },
      remove: () => {},
    }
    const result = loadOrCreateAccountKey(store)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/could not read the stored account key/)
    expect(wrote).toBe(false)
  })

  it('a generator that returns something unusable is refused, not written', () => {
    const store = inMemorySessionStore()
    const result = loadOrCreateAccountKey(store, { generate: () => ({ privateKey: '0x0' }) })
    expect(result.ok).toBe(false)
    expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
  })

  it('a generator that THROWS is a typed failure, not a rejected call', () => {
    // The generator is an injection point, so it can throw as well as return rubbish. The
    // caller handles one error channel — the typed result — the way every seam in `register.ts`
    // behaves.
    const store = inMemorySessionStore()
    const result = loadOrCreateAccountKey(store, {
      generate: () => {
        throw new Error('no entropy source')
      },
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/the key generator threw/)
    expect(!result.ok && result.reason).toMatch(/no entropy source/)
    expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
  })

  for (const [name, generate] of [
    ['null', () => null],
    ['undefined', () => undefined],
    ['an object with no key', () => ({})],
    ['a non-string key', () => ({ privateKey: 12345 })],
  ] as const) {
    it(`a generator returning ${name} is a typed failure, not an escape`, () => {
      const store = inMemorySessionStore()
      const result = loadOrCreateAccountKey(store, { generate: generate as never })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.reason).toMatch(/not a Stark private key/)
      expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
    })
  }

  it('forgetting reports a store that refuses instead of throwing', () => {
    const store: SessionStore = {
      read: () => null,
      write: () => {},
      remove: () => {
        throw new Error('nope')
      },
    }
    expect(forgetAccountKey(store)).toEqual({ ok: false, reason: 'Error: nope' })
  })
})

describe('the ceremony projection is the only thing written (AC1)', () => {
  it('persists a ready ceremony and reads it back equal', () => {
    const store = inMemorySessionStore()
    expect(saveCeremony(store, READY)).toEqual({ ok: true })
    expect(loadCeremony(store)).toEqual(READY)
  })

  it('writes nothing but the projection — a mid-ceremony state clears the slot', () => {
    // `code-issued` and `code-confirmed` hold BOTH halves of the two-secret split. The
    // projection is applied here rather than by the caller, so there is no version of this
    // function that can be handed one and write it.
    const store = inMemorySessionStore()
    saveCeremony(store, READY)
    expect(store.read(SESSION_KEYS.ceremony)).not.toBeNull()

    const midCeremony = {
      step: 'code-issued',
      backup: {
        file: '{"v":2,"ct":"c2VjcmV0"}',
        filename: 'passbook-recovery-block-1.json',
        recoveryCode: 'ABCDEF-GHJKLM-NPQRST-UVWXYZ',
      },
      header: HEADER,
    } as unknown as BackupCeremonyState

    expect(saveCeremony(store, midCeremony)).toEqual({ ok: true })
    const written = store.read(SESSION_KEYS.ceremony)
    expect(written).toBeNull()
    expect(loadCeremony(store)).toBeNull()
  })

  it('no secret from a mid-ceremony state ever reaches the store', () => {
    const store = inMemorySessionStore()
    const code = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'
    const file = '{"v":2,"ct":"dGhlLXdyYXBwZWQta2V5"}'
    for (const step of ['not-started', 'code-issued', 'code-confirmed'] as const) {
      saveCeremony(store, {
        step,
        backup: { file, filename: 'f.json', recoveryCode: code },
        header: HEADER,
      } as unknown as BackupCeremonyState)
      const everything = JSON.stringify([...Object.values(SESSION_KEYS)].map((k) => store.read(k)))
      expect(everything, step).not.toContain(code)
      expect(everything, step).not.toContain('dGhlLXdyYXBwZWQta2V5')
    }
  })

  it('clearing a stale ready is the fail-closed direction, and it is what happens', () => {
    // Keeping it would mean a reload could find a completed-backup record for a ceremony the
    // app is no longer in — which is what tells a surface the user saved their key, and
    // believing a stale one opens the registration gate for someone who has not.
    const store = inMemorySessionStore()
    saveCeremony(store, READY)
    saveCeremony(store, { step: 'not-started' })
    expect(loadCeremony(store)).toBeNull()
  })

  it('reports a store that refuses the write', () => {
    const store: SessionStore = {
      read: () => null,
      write: () => {
        throw new Error('disk is full')
      },
      remove: () => {},
    }
    const result = saveCeremony(store, READY)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/disk is full/)
  })

  it('REFUSES a filename that would not read back, instead of writing a ceremony that vanishes', () => {
    // Write/read symmetry. Without it a bad name writes happily, reports success, and reads
    // back as `null` on the next load — the ceremony is silently gone and the gate is shut
    // again, with nothing having reported a problem at the moment it could still be acted on.
    const store = inMemorySessionStore()
    const result = saveCeremony(store, {
      step: 'ready',
      filename: 'recovery.json\nSaved successfully',
      header: HEADER,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/would not read back/)
    expect(store.read(SESSION_KEYS.ceremony)).toBeNull()
  })

  it('every name it agrees to write, it can read back — the symmetry, as a property', () => {
    const store = inMemorySessionStore()
    for (const filename of [
      'passbook-recovery-block-1.json',
      'passbook-recovery-block-13763801-reissued.json',
      'a'.repeat(MAX_STORED_FILENAME_LENGTH),
    ]) {
      const state = { step: 'ready', filename, header: HEADER } as const
      expect(saveCeremony(store, state), filename).toEqual({ ok: true })
      expect(loadCeremony(store), filename).toEqual(state)
    }
  })

  it('a projection that throws is a typed failure, not an escape', () => {
    // `persistableCeremonyState` belongs to `backup-gate.ts`, so it is a seam this module does
    // not own, and a caller can hand it a shape it did not expect.
    const store = inMemorySessionStore()
    const hostile = {
      get step() {
        throw new Error('exploding getter')
      },
    } as unknown as BackupCeremonyState
    const result = saveCeremony(store, hostile)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/could not project/)
  })
})

describe('loading a ceremony validates everything and never throws (AC1)', () => {
  const load = (stored: string | null) =>
    loadCeremony(
      inMemorySessionStore(stored === null ? {} : { [SESSION_KEYS.ceremony]: stored }),
    )

  it('answers null for a slot that was never written', () => {
    expect(load(null)).toBeNull()
  })

  for (const [name, stored] of [
    ['text that is not JSON', 'not json at all'],
    ['the four bytes null', 'null'],
    ['an array', '[]'],
    ['a bare number', '42'],
    ['a state that is not ready', '{"step":"code-issued","filename":"f.json"}'],
    ['a missing filename', '{"step":"ready","header":{"backupBlock":1,"auditorKeyAtBackupBlock":"0x1","registrationBlock":null}}'],
    ['an empty filename', '{"step":"ready","filename":"","header":{"backupBlock":1,"auditorKeyAtBackupBlock":"0x1","registrationBlock":null}}'],
    ['no header', '{"step":"ready","filename":"f.json"}'],
    ['a header whose block is a word', '{"step":"ready","filename":"f.json","header":{"backupBlock":"soon","auditorKeyAtBackupBlock":"0x1","registrationBlock":null}}'],
    ['a header whose auditor key is not a felt', '{"step":"ready","filename":"f.json","header":{"backupBlock":1,"auditorKeyAtBackupBlock":"nope","registrationBlock":null}}'],
  ] as const) {
    it(`answers null for ${name}`, () => {
      expect(load(stored)).toBeNull()
    })
  }

  describe('the filename is validated too — it is the one field a surface renders', () => {
    // Every other field is re-checked because localStorage is writable by any script on this
    // origin and by the user. Leaving the RENDERED one unchecked is backwards.
    const withFilename = (filename: unknown) =>
      load(JSON.stringify({ step: 'ready', filename, header: HEADER }))

    it('accepts the name this application actually writes', () => {
      expect(withFilename('passbook-recovery-block-13763801.json')).not.toBeNull()
      expect(withFilename('passbook-recovery-block-99-reissued.json')).not.toBeNull()
    })

    for (const [name, filename] of [
      ['an empty string', ''],
      ['a number', 12345],
      ['null', null],
      ['an embedded newline', 'recovery.json\nSaved successfully'],
      ['a null byte', 'recovery\u0000.json'],
      ['an escape character', 'recovery\u001b[31m.json'],
      ['a path', '../../etc/passwd'],
      ['a Windows path', 'C:\\Users\\me\\recovery.json'],
      ['a megabyte of text', `${'a'.repeat(300)}.json`],
      // The spoofing classes a C0-only check waves straight through. Each of these renders as
      // something other than what is stored, which is the whole attack.
      ['a C1 control', 'recovery\u0085.json'],
      ['a zero-width space', 'recovery\u200b.json'],
      ['a zero-width non-joiner', 'recovery\u200c.json'],
      ['a left-to-right mark', 'recovery\u200e.json'],
      ['a line separator', 'recovery\u2028.json'],
      ['a paragraph separator', 'recovery\u2029.json'],
      // The worst of the set: reorders what follows, so this renders as `invoice.jpg`.
      ['a right-to-left override', 'recovery\u202egpj.eciovni'],
      ['a bidi isolate', 'recovery\u2066spoofed\u2069.json'],
      ['a word joiner', 'recovery\u2060.json'],
      ['a byte-order mark', 'recovery\ufeff.json'],
    ] as const) {
      it(`rejects ${name}`, () => {
        expect(withFilename(filename)).toBeNull()
      })
    }

    it('the invisible ones really are invisible — that is why the check exists', () => {
      // Guards the test data itself. If one of these ever stopped being zero-width the case
      // above would still pass while testing nothing interesting.
      for (const invisible of ['\u200b', '\u200c', '\u2060', '\ufeff']) {
        expect(`a${invisible}b`).not.toBe('ab')
        expect(`a${invisible}b`).toHaveLength(3)
      }
    })

    it('accepts a name right at the length cap and rejects one past it', () => {
      expect(withFilename('a'.repeat(MAX_STORED_FILENAME_LENGTH))).not.toBeNull()
      expect(withFilename('a'.repeat(MAX_STORED_FILENAME_LENGTH + 1))).toBeNull()
    })
  })

  it('answers null when the store itself refuses, rather than throwing out of a load', () => {
    const store: SessionStore = {
      read: () => {
        throw new Error('blocked')
      },
      write: () => {},
      remove: () => {},
    }
    expect(loadCeremony(store)).toBeNull()
  })

  it('REBUILDS from validated fields, so a smuggled secret does not survive a load', () => {
    // The scrub `markFileSaved` performs at construction is enforced again here, on a value
    // that arrived from outside the program — localStorage is writable by any script on the
    // page, and by the user.
    const store = inMemorySessionStore({
      [SESSION_KEYS.ceremony]: JSON.stringify({
        ...READY,
        backup: { recoveryCode: 'ABCDEF-GHJKLM-NPQRST-UVWXYZ', file: '{"ct":"c21", "v":2}' },
        extra: 'whatever',
      }),
    })
    const loaded = loadCeremony(store)
    expect(loaded).toEqual(READY)
    expect(JSON.stringify(loaded)).not.toContain('ABCDEF')
    expect(Object.keys(loaded!).sort()).toEqual(['filename', 'header', 'step'])
  })

  it('rebuilds the HEADER from named fields too, so nothing rides in through the parser', () => {
    // `readBackupHeader` validates the fields it knows about; what it does with the rest is its
    // own business and not a promise it made to this module. Naming the four fields here means
    // an extra property cannot reach a value handed back as a scrubbed projection, whatever the
    // header parser decides to tolerate later.
    const store = inMemorySessionStore({
      [SESSION_KEYS.ceremony]: JSON.stringify({
        step: 'ready',
        filename: 'passbook-recovery-block-5.json',
        header: { ...HEADER, smuggled: 'ABCDEF-GHJKLM-NPQRST-UVWXYZ', ct: 'c2VjcmV0' },
      }),
    })
    const loaded = loadCeremony(store)
    expect(loaded).not.toBeNull()
    expect(Object.keys(loaded!.header).sort()).toEqual([
      'auditorKeyAtBackupBlock',
      'backupBlock',
      'registrationBlock',
    ])
    expect(JSON.stringify(loaded)).not.toContain('smuggled')
    expect(JSON.stringify(loaded)).not.toContain('c2VjcmV0')
  })

  it('round-trips a header carrying a receive address and a registration block', () => {
    const store = inMemorySessionStore()
    const reissued: BackupCeremonyState = {
      step: 'ready',
      filename: 'passbook-recovery-block-99-reissued.json',
      header: {
        receiveAddress: '0x0123456789abcdef',
        backupBlock: 99,
        auditorKeyAtBackupBlock: '0xdeadbeef',
        registrationBlock: 100,
      },
    }
    saveCeremony(store, reissued)
    expect(loadCeremony(store)).toEqual(reissued)
  })
})
