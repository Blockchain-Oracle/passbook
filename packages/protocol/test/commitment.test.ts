import { describe, it, expect } from 'vitest'

import { commitmentFor, mintPositionSecret, mintPositionSecrets } from '../src/commitment.js'

//
// THE VECTORS THAT SAY THE TWO IMPLEMENTATIONS AGREE.
//
// `markets.cairo` and `launch.cairo` key every position by `poseidon_hash_span(array![secret].span())`
// and find it again by re-hashing the secret a claim reveals. If this file's hash and that one ever
// disagree, every claim reverts `POSITION_NOT_OPEN` — the position becomes unspendable and the money
// is gone, with no error a user could act on and nothing to retry.
//
// So the two values below were computed by BOTH implementations and compared, rather than taken
// from one of them. The Cairo side was run under snforge as a throwaway test asserting these exact
// constants:
//
//     poseidon_hash_span(array![42].span())      == 0x689991b0…6bcf21f
//     poseidon_hash_span(array!['alice'].span()) == 0x3c59f105…4c265b9
//
// It passed, which is what licenses this file to pin them. Anyone changing the hash function on
// either side has to change these, and changing them is the moment to re-run that check.
//
const POSEIDON_OF_42 = '0x689991b0e36441c881b859cf67f4eba29d68fc172bb6be80ae1be6956bcf21f'
const POSEIDON_OF_ALICE = '0x3c59f105b752b7c08f5e220f7346db44bb77350acb6eae614a451d884c265b9'

describe('the commitment matches what the contracts compute', () => {
  it('hashes a small felt to the value Cairo produces', () => {
    expect(commitmentFor(42n)).toBe(POSEIDON_OF_42)
  })

  it('hashes a short string to the value Cairo produces', () => {
    // 'alice' as a Cairo short string — the same secret `test_markets.cairo` bets with.
    expect(commitmentFor(0x616c696365n)).toBe(POSEIDON_OF_ALICE)
  })

  it('reads decimal and hex spellings of one secret as one secret', () => {
    expect(commitmentFor('0x2a')).toBe(POSEIDON_OF_42)
    expect(commitmentFor('42')).toBe(POSEIDON_OF_42)
  })
})

describe('a secret that could not be committed to is refused', () => {
  it('refuses zero, which is almost always an uninitialised variable', () => {
    expect(() => commitmentFor(0n)).toThrow(/positive felt/)
  })

  // Above the field order the value is reduced modulo P on the way in, so the secret that gets
  // committed is not the secret that was stored — and the position would be unclaimable with the
  // secret the user actually holds.
  it('refuses a secret at or above the field prime rather than silently reducing it', () => {
    const prime = (1n << 251n) + 17n * (1n << 192n) + 1n
    expect(() => commitmentFor(prime)).toThrow(/field prime/)
  })

  it('refuses something that is not a felt at all', () => {
    expect(() => commitmentFor('not a number')).toThrow(/not a felt/)
  })
})

describe('minting', () => {
  it('produces a secret whose commitment is its own hash', () => {
    const { secret, commitment } = mintPositionSecret()
    expect(commitment).toBe(commitmentFor(secret))
  })

  it('stays below the field prime, so no minted secret is ever reduced', () => {
    const prime = (1n << 251n) + 17n * (1n << 192n) + 1n
    for (let i = 0; i < 64; i++) {
      const { secret } = mintPositionSecret()
      expect(BigInt(secret)).toBeGreaterThan(0n)
      expect(BigInt(secret)).toBeLessThan(prime)
    }
  })

  // Each rung of a ladder needs its own: the contracts refuse a reused commitment, and the reason
  // they do is that the second position sharing one could never be claimed.
  it('mints distinct secrets for a ladder', () => {
    const minted = mintPositionSecrets(3)
    expect(minted).toHaveLength(3)
    expect(new Set(minted.map((m) => m.secret)).size).toBe(3)
    expect(new Set(minted.map((m) => m.commitment)).size).toBe(3)
  })

  it('refuses a nonsense count rather than returning an empty ladder', () => {
    expect(() => mintPositionSecrets(0)).toThrow()
    expect(() => mintPositionSecrets(-1)).toThrow()
    expect(() => mintPositionSecrets(1.5)).toThrow()
  })
})
