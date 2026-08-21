import { describe, it, expect } from 'vitest'
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
})
