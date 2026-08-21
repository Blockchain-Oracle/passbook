import { describe, it, expect } from 'vitest'
import { webcrypto as crypto } from 'node:crypto'
import {
  generateIdentity, createBackup, restoreBackup, deriveIdentityPublicKey,
} from '../src/identity.js'

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
