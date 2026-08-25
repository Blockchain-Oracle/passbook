import { describe, it, expect } from 'vitest'
import {
  balancesFrom,
  hasDust,
  isDustAt,
  lookupDecimals,
  DEFAULT_DISPLAY_DECIMALS,
  KNOWN_TOKEN_DECIMALS,
} from '../src/balances.js'
import { STRK_TOKEN } from '../src/constants.js'
import { presenceOf } from '../src/discovery.js'
import type { DiscoveredNote, DiscoveryResult } from '../src/discovery.js'
import { advanceOnVerified, BACKUP_CADENCE_DAYS } from '../src/backup-cadence.js'

const USDC_ISH = '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'

function note(over: Partial<DiscoveredNote> = {}): DiscoveredNote {
  return {
    id: 1n,
    token: STRK_TOKEN,
    amount: 1n,
    witness: { channelKey: 1n, nonce: 0, r: 1n },
    sender: '0xabc',
    open: false,
    ...over,
  }
}

function walked(notes: DiscoveredNote[], over: Partial<Extract<DiscoveryResult, { state: 'walked' }>> = {}): DiscoveryResult {
  return {
    state: 'walked',
    wallet: { channels: [], notes: [] },
    notes,
    registry: { incoming: [], outgoing: [], outgoingTotal: 0 },
    blockNumber: 13_800_000,
    presence: notes.length > 0 ? 'present' : 'absent',
    registered: true,
    ...over,
  }
}

const unreachable: DiscoveryResult = {
  state: 'unreachable',
  presence: 'unknown',
  reason: 'all RPC hosts failed',
}

describe('the I/O matrix, row by row', () => {
  it('present: a completed walk with notes sums per token and stamps the block', () => {
    const balance = balancesFrom(
      walked([
        note({ id: 1n, amount: 3n }),
        note({ id: 2n, amount: 4n }),
        note({ id: 3n, amount: 100n, token: USDC_ISH }),
      ]),
    )
    expect(balance.presence).toBe('present')
    expect(balance.book).toBe('holdings')
    expect(balance.blockNumber).toBe(13_800_000)
    expect(balance.tokens).toHaveLength(2)
    const strk = balance.tokens.find((t) => BigInt(t.token) === BigInt(STRK_TOKEN))!
    expect(strk.wei).toBe(7n)
    expect(strk.noteCount).toBe(2)
  })

  it('empty book: a COMPLETED walk finding nothing is absent, and only that may say absent', () => {
    const balance = balancesFrom(walked([]))
    expect(balance.presence).toBe('absent')
    expect(balance.book).toBe('no-activity')
    expect(balance.tokens).toEqual([])
    expect(balance.blockNumber).toBe(13_800_000)
  })

  it('unregistered: a different book state from an empty one, and a different sentence', () => {
    const balance = balancesFrom(walked([], { registered: false, presence: 'absent' }))
    expect(balance.book).toBe('not-registered')
    // Presence is still `absent` — the account genuinely holds nothing — but the REASON
    // differs, and the copy turns on `book`, not on presence.
    expect(balance.presence).toBe('absent')
  })

  it('a walk that did not complete produces NO token rows — never a confident zero', () => {
    const balance = balancesFrom(unreachable)
    expect(balance.presence).toBe('unknown')
    expect(balance.book).toBe('unknown')
    expect(balance.blockNumber).toBeNull()
    // The trap this avoids: a list of zero-valued rows reads exactly like an empty account.
    expect(balance.tokens).toEqual([])
  })

  it('an unregistered address holding a note is still holding it', () => {
    // Ordering inside `balancesFrom`: holdings must not be explained away by a registration
    // flag. The pool keys channel storage by address and does not consult the public-key slot.
    const balance = balancesFrom(walked([note({ amount: 5n })], { registered: false }))
    expect(balance.book).toBe('not-registered')
    expect(balance.tokens[0]!.wei).toBe(5n)
  })

  it('counts open notes separately — their amounts were public in pool storage', () => {
    const balance = balancesFrom(
      walked([note({ id: 1n, amount: 2n, open: true }), note({ id: 2n, amount: 3n, open: false })]),
    )
    expect(balance.tokens[0]!.noteCount).toBe(2)
    expect(balance.tokens[0]!.openNoteCount).toBe(1)
    expect(balance.tokens[0]!.wei).toBe(5n)
  })

  it('rows are ordered largest-first and stable across two identical walks', () => {
    const notes = [
      note({ id: 1n, amount: 1n, token: USDC_ISH }),
      note({ id: 2n, amount: 900n }),
      note({ id: 3n, amount: 50n, token: '0xdead' }),
    ]
    const first = balancesFrom(walked(notes)).tokens.map((t) => t.wei)
    const second = balancesFrom(walked([...notes].reverse())).tokens.map((t) => t.wei)
    expect(first).toEqual([900n, 50n, 1n])
    expect(second).toEqual(first)
  })
})

describe('dust is exact, flagged, and never rounded away', () => {
  it('a non-zero amount below display precision is dust', () => {
    expect(isDustAt(400n, 18, 4)).toBe(true)
    expect(isDustAt(10n ** 14n - 1n, 18, 4)).toBe(true)
  })

  it('the boundary is exact', () => {
    // At 18 decimals shown to 4 places, the smallest visible unit is 1e14.
    expect(isDustAt(10n ** 14n, 18, 4)).toBe(false)
    expect(isDustAt(10n ** 14n - 1n, 18, 4)).toBe(true)
  })

  it('zero is NOT dust — it renders as 0 correctly and needs no special case', () => {
    expect(isDustAt(0n, 18, 4)).toBe(false)
    expect(isDustAt(-1n, 18, 4)).toBe(false)
  })

  it('showing more places than a token has cannot hide anything', () => {
    // Guards the negative exponent that would otherwise make every amount dust.
    expect(isDustAt(1n, 6, 6)).toBe(false)
    expect(isDustAt(1n, 6, 18)).toBe(false)
  })

  it('the default display precision is used when none is given', () => {
    expect(isDustAt(10n ** BigInt(18 - DEFAULT_DISPLAY_DECIMALS) - 1n, 18)).toBe(true)
    expect(isDustAt(10n ** BigInt(18 - DEFAULT_DISPLAY_DECIMALS), 18)).toBe(false)
  })

  it('a token whose decimals we have not verified gets null, never a confident false', () => {
    const balance = balancesFrom(walked([note({ amount: 1n, token: '0xdeadbeef' })]))
    expect(balance.tokens[0]!.decimals).toBeNull()
    // `false` would be the claim "this renders fine", about a token whose scale is unknown.
    expect(balance.tokens[0]!.isDust).toBeNull()
    expect(hasDust(balance)).toBe(false)
  })

  it('a caller-supplied decimals map fills the gap', () => {
    const balance = balancesFrom(walked([note({ amount: 1n, token: USDC_ISH })]), {
      decimals: { [USDC_ISH]: 6 },
    })
    expect(balance.tokens[0]!.decimals).toBe(6)
    expect(balance.tokens[0]!.isDust).toBe(true)
    expect(hasDust(balance)).toBe(true)
  })
})

describe('decimals are looked up by felt value, not by string', () => {
  it('the padded and unpadded spellings of STRK are the same token', () => {
    // The bug this exists to prevent: `constants.ts` pads to 64 hex digits, the discovery walk
    // emits the unpadded form, and a string-keyed lookup silently misses — producing a `null`
    // dust verdict for the one token whose decimals we have actually verified.
    const padded = STRK_TOKEN
    const unpadded = `0x${BigInt(STRK_TOKEN).toString(16)}`
    expect(padded).not.toBe(unpadded)
    expect(lookupDecimals(KNOWN_TOKEN_DECIMALS, padded)).toBe(18)
    expect(lookupDecimals(KNOWN_TOKEN_DECIMALS, unpadded)).toBe(18)
  })

  it('an uppercase spelling is the same token too', () => {
    expect(lookupDecimals(KNOWN_TOKEN_DECIMALS, STRK_TOKEN.toUpperCase().replace('0X', '0x'))).toBe(18)
  })

  it('an unknown token is null', () => {
    expect(lookupDecimals(KNOWN_TOKEN_DECIMALS, '0xdead')).toBeNull()
  })

  it('malformed keys and lookups are skipped, never thrown on', () => {
    expect(lookupDecimals({ 'not a felt': 6, [STRK_TOKEN]: 18 }, STRK_TOKEN)).toBe(18)
    expect(lookupDecimals(KNOWN_TOKEN_DECIMALS, 'not a felt')).toBeNull()
  })

  it('only STRK is claimed as verified', () => {
    // The empty space in the map is deliberate: a guessed 18 on a 6-decimal token misplaces a
    // balance by a factor of a trillion, in the direction that looks like dust.
    expect(Object.keys(KNOWN_TOKEN_DECIMALS)).toEqual([STRK_TOKEN])
  })
})

describe('the 1.8 seam: presence threads into the cadence and cannot advance it wrongly', () => {
  // The story's own acceptance criterion, as an executable assertion rather than a promise:
  // "Given the discovery walk in ANY non-completed state, when presence is read, then it is
  // `unknown` — and threading it into backup-cadence never advances the ladder."
  const rung = (intervalIndex: number) => ({ intervalIndex, lastVerifiedAt: null })

  it('a failed walk reads as unknown and leaves the ladder exactly where it was', () => {
    expect(presenceOf(unreachable)).toBe('unknown')
    for (let index = 0; index < BACKUP_CADENCE_DAYS.length; index++) {
      const after = advanceOnVerified(rung(index), 1_000, presenceOf(unreachable))
      expect(after.intervalIndex, `rung ${index}`).toBe(index)
    }
  })

  it('a completed-but-empty walk does not advance it either — the ladder is for value at risk', () => {
    expect(presenceOf(walked([]))).toBe('absent')
    expect(advanceOnVerified(rung(0), 1_000, presenceOf(walked([]))).intervalIndex).toBe(0)
  })

  it('only a completed walk holding notes advances it', () => {
    const held = walked([note({ amount: 1n })])
    expect(presenceOf(held)).toBe('present')
    expect(advanceOnVerified(rung(0), 1_000, presenceOf(held)).intervalIndex).toBe(1)
  })

  it('the ladder still stops at its top rung on a present balance', () => {
    const top = BACKUP_CADENCE_DAYS.length - 1
    const held = walked([note({ amount: 1n })])
    expect(advanceOnVerified(rung(top), 1_000, presenceOf(held)).intervalIndex).toBe(top)
  })
})

describe('one token is one row, whatever spelling its notes arrived in', () => {
  const padded = STRK_TOKEN
  const unpadded = `0x${BigInt(STRK_TOKEN).toString(16)}`

  it('two spellings of one token sum into a single row', () => {
    // The failure this closes: the balance HALVES on screen while every note is still there,
    // which is the worst possible way for a padding difference to surface.
    const balance = balancesFrom(
      walked([
        note({ id: 1n, amount: 3n, token: padded }),
        note({ id: 2n, amount: 4n, token: unpadded }),
      ]),
    )
    expect(balance.tokens).toHaveLength(1)
    expect(balance.tokens[0]!.wei).toBe(7n)
    expect(balance.tokens[0]!.noteCount).toBe(2)
  })

  it('the row carries the canonical spelling, not whichever arrived first', () => {
    const balance = balancesFrom(walked([note({ amount: 1n, token: padded })]))
    expect(balance.tokens[0]!.token).toBe(unpadded)
  })

  it('a token that is not a felt at all still gets its own row rather than crashing', () => {
    const balance = balancesFrom(walked([note({ amount: 1n, token: 'not a felt' })]))
    expect(balance.tokens).toHaveLength(1)
    expect(balance.tokens[0]!.decimals).toBeNull()
  })
})

describe('a caller-supplied decimals override wins over the built-in map', () => {
  it('an override spelled differently from the built-in entry still wins', () => {
    // A spread merge compares keys as strings, so a padded override over an unpadded built-in
    // leaves BOTH and the lookup returns whichever it meets first — silently the built-in.
    const unpadded = `0x${BigInt(STRK_TOKEN).toString(16)}`
    const balance = balancesFrom(walked([note({ amount: 1n, token: STRK_TOKEN })]), {
      decimals: { [unpadded]: 6 },
    })
    expect(balance.tokens[0]!.decimals).toBe(6)
  })

  it('an override in the same spelling wins too', () => {
    const balance = balancesFrom(walked([note({ amount: 1n, token: STRK_TOKEN })]), {
      decimals: { [STRK_TOKEN]: 9 },
    })
    expect(balance.tokens[0]!.decimals).toBe(9)
  })
})

describe('non-integer precision is refused, not rounded', () => {
  it('a fractional decimals or display precision throws a classified error', () => {
    // `BigInt` throws a bare RangeError on a fraction, from inside what a caller experiences
    // as reading a balance. And a fractional scale means it came from somewhere that does not
    // know it — rounding either way misplaces the dust threshold by a factor of ten.
    expect(() => isDustAt(1n, 18.5)).toThrow(/decimals must be a whole number/)
    expect(() => isDustAt(1n, -1)).toThrow(/decimals must be a whole number/)
    expect(() => isDustAt(1n, Number.NaN)).toThrow(/decimals must be a whole number/)
    expect(() => isDustAt(1n, 18, 2.5)).toThrow(/display precision must be a whole number/)
    expect(() => isDustAt(1n, 18, -1)).toThrow(/display precision must be a whole number/)
  })

  it('a fractional override surfaces through balancesFrom rather than being swallowed', () => {
    expect(() =>
      balancesFrom(walked([note({ amount: 1n })]), { displayDecimals: 1.5 }),
    ).toThrow(/display precision must be a whole number/)
  })
})
