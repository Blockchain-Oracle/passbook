import { describe, it, expect } from 'vitest'
import { webcrypto as crypto } from 'node:crypto'
import { ec } from 'starknet'
import {
  generateIdentity, createBackup, restoreBackup, deriveIdentityPublicKey,
  deriveViewingKey, canonicalizeViewingKey, assertViewingKey, MAX_VIEWING_KEY,
} from '../src/identity.js'

const ORDER = ec.starkCurve.CURVE.n
const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const SN_MAIN = '0x534e5f4d41494e'

// The D33/AD-4 boundary tests — none existed before; the fold's illegal-input handling is
// exactly the fund-loss class the deep-recon (V4) flagged, so it is tested directly.
describe('viewing-key canonicalization (AD-4)', () => {
  it('accepts a normal lower-half scalar unchanged', () => {
    expect(canonicalizeViewingKey(1n)).toBe(1n)
    expect(canonicalizeViewingKey(MAX_VIEWING_KEY - 1n)).toBe(MAX_VIEWING_KEY - 1n)
  })

  it('folds an upper-half scalar down to its lower-half twin', () => {
    expect(canonicalizeViewingKey(ORDER - 1n)).toBe(1n)
    expect(canonicalizeViewingKey(MAX_VIEWING_KEY + 2n)).toBe(MAX_VIEWING_KEY - 1n)
  })

  it('THROWS on the three residues with no legal representative, never silently remaps', () => {
    // The old `?: 1n` remap returned an out-of-range key on MAX and MAX+1 — the bug.
    expect(() => canonicalizeViewingKey(0n)).toThrow(/out of range/)
    expect(() => canonicalizeViewingKey(MAX_VIEWING_KEY)).toThrow(/out of range/)
    expect(() => canonicalizeViewingKey(MAX_VIEWING_KEY + 1n)).toThrow(/out of range/)
  })

  it('every value it returns passes the strict pool bound', () => {
    for (const r of [1n, 2n, MAX_VIEWING_KEY - 1n, MAX_VIEWING_KEY + 2n, ORDER - 1n]) {
      expect(() => assertViewingKey(canonicalizeViewingKey(r))).not.toThrow()
    }
  })

  it('assertViewingKey enforces [1, MAX) strictly — MAX itself is illegal (SDK admits it; we do not)', () => {
    expect(() => assertViewingKey(0n)).toThrow()
    expect(() => assertViewingKey(MAX_VIEWING_KEY)).toThrow()
    expect(() => assertViewingKey(1n)).not.toThrow()
    expect(() => assertViewingKey(MAX_VIEWING_KEY - 1n)).not.toThrow()
  })
})

describe('deriveViewingKey (AD-4 / D33)', () => {
  it('is deterministic for the same account key, chain, and pool', () => {
    const { privateKey } = generateIdentity()
    expect(deriveViewingKey(privateKey, SN_MAIN, POOL))
      .toBe(deriveViewingKey(privateKey, SN_MAIN, POOL))
  })

  it('is bound to the pool and the chain — a different pool or chain yields a different key', () => {
    const { privateKey } = generateIdentity()
    const base = deriveViewingKey(privateKey, SN_MAIN, POOL)
    expect(deriveViewingKey(privateKey, SN_MAIN, '0x01')).not.toBe(base)      // other pool
    expect(deriveViewingKey(privateKey, '0x534e5f5345504f4c4941', POOL)).not.toBe(base) // sepolia
  })

  it('a different account key yields a different viewing key', () => {
    expect(deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL))
      .not.toBe(deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL))
  })

  it('always returns a strictly legal key across many random account keys (never throws)', () => {
    for (let i = 0; i < 200; i++) {
      const k = deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL)
      expect(() => assertViewingKey(k)).not.toThrow()
    }
  })
})

describe('identity', () => {
  it('generates a distinct keypair each time', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).toBe(deriveIdentityPublicKey(a.privateKey))
  })

  it('round-trips a backup with its recovery code', async () => {
    const { privateKey } = generateIdentity()
    const { file, recoveryCode } = await createBackup(privateKey)
    expect(await restoreBackup(file, recoveryCode)).toBe(privateKey)
  })

  it('generates the recovery code itself — it is never user-chosen', async () => {
    const { recoveryCode } = await createBackup(generateIdentity().privateKey)
    expect(recoveryCode).toMatch(/^[0-9A-HJ-NP-Z]{4}(-[0-9A-HJ-NP-Z]{4}){3}$/)
  })

  it('rejects the wrong recovery code rather than returning garbage', async () => {
    const { file } = await createBackup(generateIdentity().privateKey)
    await expect(restoreBackup(file, 'AAAA-BBBB-CCCC-DDDD')).rejects.toThrow(/recovery code/i)
  })

  it('leaks no plaintext key material into the backup file', async () => {
    const { privateKey } = generateIdentity()
    const { file } = await createBackup(privateKey)
    expect(file).not.toContain(privateKey.replace(/^0x/, ''))
  })

  it('restores a backup written at a different iteration count than the current default', async () => {
    // Builds an envelope by hand at a deliberately non-default iteration count, to prove
    // restoreBackup honours env.iterations rather than closing over the module's current
    // KDF_ITERATIONS floor. If it ever regresses to the module constant, raising that
    // floor in the future would silently break every backup ever written — this must
    // never happen, so the test constructs a mismatch on purpose and expects success.
    const { privateKey } = generateIdentity()
    const recoveryCode = 'ABCD-EFGH-JKLM-NPQR'
    const iterations = 1_000
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(recoveryCode), 'PBKDF2', false, ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    )
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey),
      ),
    )
    const file = JSON.stringify({
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: Buffer.from(salt).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      ct: Buffer.from(ct).toString('base64'),
    })
    expect(await restoreBackup(file, recoveryCode)).toBe(privateKey)
  })

  it('reports a malformed backup file distinctly from a wrong recovery code', async () => {
    await expect(restoreBackup('not json at all', 'AAAA-BBBB-CCCC-DDDD'))
      .rejects.toThrow(/malformed|invalid/i)
  })
})
