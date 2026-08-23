import { describe, it, expect } from 'vitest'
import {
  verifyClaimedKey, mapRegistrationError, buildRegistrationActions, isRegisterableKey,
  REGISTRATION_VARIANT,
} from '../src/registration.js'
import { generateIdentity, deriveIdentityPublicKey } from '../src/identity.js'

describe('ForeignKey recovery — verifyClaimedKey (1.7)', () => {
  it('accepts the paste that derives the registered public key', () => {
    const { privateKey, publicKey } = generateIdentity()
    expect(verifyClaimedKey(privateKey, BigInt(publicKey))).toBe(true)
  })

  it('rejects a different key', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(verifyClaimedKey(a.privateKey, BigInt(b.publicKey))).toBe(false)
  })

  it('returns false (never throws) on a malformed paste', () => {
    expect(verifyClaimedKey('not-a-key', 123n)).toBe(false)
    expect(verifyClaimedKey('', 0n)).toBe(false)
  })
})

describe('honest error mapping — mapRegistrationError (1.7 / FR-018)', () => {
  it('turns the raw NON_ZERO_VALUE into "already registered"', () => {
    expect(mapRegistrationError('Error: NON_ZERO_VALUE')).toMatch(/already has a registered key/i)
  })

  it('maps other known pool reverts', () => {
    expect(mapRegistrationError('PRIVATE_KEY_NOT_CANONICAL')).toMatch(/valid range/i)
    expect(mapRegistrationError('RECIPIENT_NOT_REGISTERED')).toMatch(/invite/i)
  })

  it('passes an unknown code through unchanged rather than mistranslating', () => {
    expect(mapRegistrationError('SOME_NEW_ERROR')).toBe('SOME_NEW_ERROR')
  })
})

describe('sponsored registration action list — buildRegistrationActions (1.12)', () => {
  it('builds a single zero-deposit SetViewingKey (Account phase, index 0)', () => {
    const actions = buildRegistrationActions(42n)
    expect(actions).toEqual([{ type: 'SetViewingKey', random: 42n }])
    expect(REGISTRATION_VARIANT).toBe(0)
  })

  it('generates a non-zero random when none is supplied', () => {
    const a = buildRegistrationActions()
    expect(a[0]!.random).toBeGreaterThan(0n)
    // two builds differ (random)
    expect(buildRegistrationActions()[0]!.random).not.toBe(a[0]!.random)
  })

  it('rejects a zero random (ZERO_RANDOM)', () => {
    expect(() => buildRegistrationActions(0n)).toThrow(/ZERO_RANDOM/)
  })

  it('the list is never batched with a deposit and needs no maturity — it validates as a lone companion', () => {
    // buildRegistrationActions internally asserts protocol validity; a lone SetViewingKey is
    // its own WriteOnce companion with no invoke, so it passes.
    expect(() => buildRegistrationActions(7n)).not.toThrow()
  })
})

describe('isRegisterableKey (1.7/1.12)', () => {
  it('accepts a freshly generated account key', () => {
    expect(isRegisterableKey(generateIdentity().privateKey)).toBe(true)
  })
  it('rejects zero and garbage', () => {
    expect(isRegisterableKey('0x0')).toBe(false)
    expect(isRegisterableKey('nope')).toBe(false)
  })
})
