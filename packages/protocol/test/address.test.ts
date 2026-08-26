import { describe, it, expect } from 'vitest'
import { asAddress, maybeAddress, sameAddress } from '../src/address.js'

//
// Extracted out of `activity.ts:markOwnAddress` so a browser-facing self-link check can share the
// comparison without importing a module that reaches `starknet`. These tests pin the behaviours
// `activity.test.ts` already relied on, at the level they now live.
//

describe('asAddress refuses what it was handed', () => {
  it('parses the spellings a felt actually takes', () => {
    expect(asAddress('0xa11ce')).toBe(0xa11cen)
    expect(asAddress('42')).toBe(42n)
  })

  it('throws the message activity.test.ts matches on', () => {
    expect(() => asAddress('not an address')).toThrow(/not an address/)
  })

  it('quotes and truncates the offending value rather than echoing it whole', () => {
    expect(() => asAddress('z'.repeat(200))).toThrow(/"z{64}"/)
  })
})

describe('maybeAddress reports rather than throws', () => {
  it('returns null for the unparseable, and for absence', () => {
    expect(maybeAddress('not an address')).toBeNull()
    expect(maybeAddress(null)).toBeNull()
    expect(maybeAddress(undefined)).toBeNull()
  })
})

describe('sameAddress', () => {
  it('sees through zero padding — the reason this is BigInt and not string equality', () => {
    // activity.test.ts:316 pins this case. A normalised-string refactor breaks it silently.
    expect(sameAddress('0x00000a11ce', '0xa11ce')).toBe(true)
  })

  it('is false for a different address', () => {
    expect(sameAddress('0xa11ce', '0xb0b')).toBe(false)
  })

  it('is false rather than throwing when either side is not an address', () => {
    expect(sameAddress('not an address', '0xa11ce')).toBe(false)
    expect(sameAddress('0xa11ce', 'not an address')).toBe(false)
  })

  it('never treats blank as the zero address', () => {
    // `BigInt('')` is 0n. Without the guard an empty destination box compares equal to the zero
    // address, and a self-link detector announces a match against nothing.
    expect(sameAddress('', '0x0')).toBe(false)
    expect(sameAddress('   ', '0x0')).toBe(false)
    expect(sameAddress('0x0', '')).toBe(false)
  })
})
