import { describe, it, expect } from 'vitest'

import {
  MIN_PASSWORD_LENGTH,
  VAULT_ERROR_TEXT,
  VAULT_VERSION,
  clearPlaintextKeys,
  openVault,
  parseVault,
  passwordStrength,
  sealVault,
  sealWithKey,
  serializeVault,
  sessionVaultStore,
  type SealedVault,
  type VaultHeader,
} from '../src/session-vault.js'
import { SESSION_KEYS, inMemorySessionStore } from '../src/session-store.js'

/**
 * WebCrypto is required, not mocked.
 *
 * A fake `subtle` would let every test below pass against an implementation that never encrypts
 * anything — which is the one outcome this file exists to rule out. Node ≥ 20 exposes the real
 * `globalThis.crypto.subtle`, so these are genuine round trips at genuine cost. That cost is why
 * `KDF_ITERATIONS` is only paid a handful of times here rather than in a loop.
 */
const PASSWORD = 'correct horse battery'
const OTHER_PASSWORD = 'incorrect horse battery'

const HEADER: VaultHeader = {
  active: '0xabc',
  accounts: [{ address: '0xabc', label: 'Main', addedAt: 1 }],
}

/** A record shaped like the thing the shell actually seals: JSON with a key inside it. */
const RECORD = JSON.stringify({ v: 1, active: '0xabc', locked: false, accounts: [{ k: '0x1' }] })

async function seal(password = PASSWORD): Promise<SealedVault> {
  const result = await sealVault(RECORD, HEADER, password)
  if (!result.ok) throw new Error(`seal failed: ${result.error}`)
  return result.value
}

describe('the vault round trip', () => {
  it('opens with the password it was sealed under, and returns the exact plaintext', async () => {
    const opened = await openVault(await seal(), PASSWORD)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.value.plaintext).toBe(RECORD)
  })

  it('hands back a derived key that re-seals without paying the KDF again', async () => {
    // This is the load-bearing half of the design: every write re-seals, and re-deriving 600,000
    // rounds to rename an account would make the app feel broken.
    const opened = await openVault(await seal(), PASSWORD)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const next = JSON.stringify({ v: 1, active: '0xabc', locked: false, accounts: [{ k: '0x2' }] })
    const resealed = await sealWithKey(next, HEADER, opened.value.vaultKey)
    expect(resealed.ok).toBe(true)
    if (!resealed.ok) return

    // The ORIGINAL password still opens it, which is the whole contract: carrying the salt forward
    // is what keeps the re-sealed vault openable by the thing the user actually knows.
    const reopened = await openVault(resealed.value, PASSWORD)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.value.plaintext).toBe(next)
  })

  it('re-sealing under a held key draws a fresh IV every time', async () => {
    // The key does NOT change between writes, which is exactly the setting where a cached IV would
    // look like a harmless optimisation and would be the catastrophic misuse of AES-GCM.
    const opened = await openVault(await seal(), PASSWORD)
    if (!opened.ok) throw new Error('open failed')

    const a = await sealWithKey(RECORD, HEADER, opened.value.vaultKey)
    const b = await sealWithKey(RECORD, HEADER, opened.value.vaultKey)
    if (!a.ok || !b.ok) throw new Error('reseal failed')

    expect(a.value.cipher.iv).not.toBe(b.value.cipher.iv)
    expect(a.value.body).not.toBe(b.value.body)
    // Same salt, though — that is what makes the held key still valid.
    expect(a.value.kdf.salt).toBe(b.value.kdf.salt)
  })

  it('refuses the wrong password, and says so as `wrong-password` rather than `damaged`', async () => {
    // The distinction is the point: `damaged` sends a user to their Recovery File, which is a
    // frightening and unnecessary trip when all they did was mistype.
    const opened = await openVault(await seal(), OTHER_PASSWORD)
    expect(opened).toEqual({ ok: false, error: 'wrong-password' })
  })

  it('never puts the plaintext in the sealed body', async () => {
    const vault = await seal()
    expect(vault.body).not.toContain('0x1')
    expect(serializeVault(vault)).not.toContain('0x1')
  })

  it('draws a fresh salt and IV on every seal, so two seals of one record differ', async () => {
    // IV reuse under one AES-GCM key is the catastrophic misuse of the mode. Re-sealing after
    // adding an account happens with an unchanged password, which is exactly when a caching
    // "optimisation" would introduce it.
    const [a, b] = [await seal(), await seal()]
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.body).not.toBe(b.body)
  })

  it('opens at the iteration count in the record, not at this build’s constant', async () => {
    // Raising KDF_ITERATIONS must not lock existing users out. Sealing at the shipped count and
    // then opening proves the read path uses `vault.kdf.iterations`; a hardcoded constant on the
    // open side would still pass here, so the assertion is on the stored value being honoured.
    const vault = await seal()
    const lowered: SealedVault = { ...vault, kdf: { ...vault.kdf, iterations: vault.kdf.iterations + 1 } }
    // A different count derives a different key, so this must fail rather than silently succeed —
    // which it can only do if the count is actually being read.
    expect(await openVault(lowered, PASSWORD)).toEqual({ ok: false, error: 'wrong-password' })
  })

  it('refuses to seal a password under the minimum', async () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(await sealVault(RECORD, HEADER, short)).toEqual({ ok: false, error: 'password-too-short' })
  })
})

describe('the envelope is checked before the password is tried', () => {
  it('reports a damaged body as `damaged`, not as a wrong password', async () => {
    const vault = await seal()
    expect(await openVault({ ...vault, body: 'not base64!!' }, PASSWORD)).toEqual({
      ok: false,
      error: 'damaged',
    })
  })

  it('reports a wrong-length salt or IV as `damaged`', async () => {
    const vault = await seal()
    expect(await openVault({ ...vault, kdf: { ...vault.kdf, salt: 'AAAA' } }, PASSWORD)).toEqual({
      ok: false,
      error: 'damaged',
    })
    expect(await openVault({ ...vault, cipher: { ...vault.cipher, iv: 'AAAA' } }, PASSWORD)).toEqual({
      ok: false,
      error: 'damaged',
    })
  })

  it('reports a future version as `unsupported-version`', async () => {
    const vault = await seal()
    const future = { ...vault, v: (VAULT_VERSION + 1) as typeof VAULT_VERSION }
    expect(await openVault(future, PASSWORD)).toEqual({ ok: false, error: 'unsupported-version' })
  })

  it('every error has a sentence, so nothing can reach the UI unspoken', async () => {
    for (const text of Object.values(VAULT_ERROR_TEXT)) {
      expect(text.length).toBeGreaterThan(0)
    }
  })
})

describe('parsing what is in storage', () => {
  it('null is absent, and everything malformed is damaged rather than absent', () => {
    // The distinction decides whether the boot path mints a new identity. `absent` on a damaged
    // vault would create a second account on top of the ciphertext sitting right beside it.
    expect(parseVault(null)).toEqual({ kind: 'absent' })
    expect(parseVault('{').kind).toBe('damaged')
    expect(parseVault('[]').kind).toBe('damaged')
    expect(parseVault('"a string"').kind).toBe('damaged')
  })

  it('round-trips a real vault', async () => {
    const vault = await seal()
    const read = parseVault(serializeVault(vault))
    expect(read.kind).toBe('present')
    if (read.kind === 'present') expect(read.vault.header).toEqual(HEADER)
  })

  it('rejects a header whose active address names no account it holds', async () => {
    // The header is OUTSIDE the sealed body, so it is the half an attacker can edit without
    // breaking the GCM tag. It cannot hand over a key, but it can put a wrong address on the lock
    // screen, so it is validated as strictly as the record is.
    const vault = await seal()
    const tampered = { ...vault, header: { ...HEADER, active: '0xsomebody-else' } }
    expect(parseVault(JSON.stringify(tampered)).kind).toBe('damaged')
  })

  it('rejects a header with a malformed account entry', async () => {
    const vault = await seal()
    const tampered = {
      ...vault,
      header: { active: '0xabc', accounts: [{ address: '0xabc', label: 'Main' }] },
    }
    expect(parseVault(JSON.stringify(tampered)).kind).toBe('damaged')
  })
})

describe('the vault store', () => {
  it('saves, loads and clears through a session store', async () => {
    const store = inMemorySessionStore()
    const vaults = sessionVaultStore(store)

    expect(vaults.load()).toEqual({ kind: 'absent' })

    const vault = await seal()
    vaults.save(vault)
    const read = vaults.load()
    expect(read.kind).toBe('present')

    vaults.clear()
    expect(vaults.load()).toEqual({ kind: 'absent' })
  })

  it('reports a store that throws as damaged, never as absent', () => {
    const throwing = {
      read: () => {
        throw new Error('storage is gone')
      },
      write: () => {},
      remove: () => {},
    }
    const read = sessionVaultStore(throwing).load()
    expect(read.kind).toBe('damaged')
  })

  it('clearing the plaintext keys removes the mirror as well as the record', async () => {
    const store = inMemorySessionStore()
    store.write(SESSION_KEYS.accountKey, '0x1')
    store.write(SESSION_KEYS.accounts, '{}')

    clearPlaintextKeys(store)

    // Both, and the mirror especially: a browser left holding a bare `accountKey` is exactly the
    // shape `session-key.ts` boots from, so it would open with no password at all.
    expect(store.read(SESSION_KEYS.accountKey)).toBeNull()
    expect(store.read(SESSION_KEYS.accounts)).toBeNull()
  })
})

describe('the strength meter advises and never blocks', () => {
  it('grades length above variety', () => {
    expect(passwordStrength('short')).toBe('too-short')
    expect(passwordStrength('abcdefgh')).toBe('weak')
    expect(passwordStrength('Abcdefg1!')).toBe('fair')
    expect(passwordStrength('abcdefghijkl')).toBe('fair')
    // A long lowercase passphrase beats a short one with a digit stapled on — the direction the
    // research points, and the opposite of what most meters reward.
    expect(passwordStrength('correcthorsebatterystaple')).toBe('strong')
    expect(passwordStrength('Abcdefghijk1')).toBe('strong')
  })

  it('only `too-short` corresponds to something the seal actually refuses', async () => {
    // The meter is advice. `weak` must still seal, or the meter has quietly become a rule.
    const weak = 'abcdefgh'
    expect(passwordStrength(weak)).toBe('weak')
    expect((await sealVault(RECORD, HEADER, weak)).ok).toBe(true)
  })
})
