//
// The oracle decode (Wave 3).
//
// Every other test on these surfaces injects past the read, so `medianFrom` is the one line that
// would otherwise never run — the same reasoning `channelCountFrom` records. And it is the line
// that turns four felts into the number a bet settles against, so the failures worth pinning are
// the ones that produce a WRONG price rather than no price.
//
import { describe, it, expect } from 'vitest'

import {
  PRAGMA_MAINNET,
  PRAGMA_PAIRS,
  PRAGMA_PAIR_LIST,
  SPOT_ENTRY,
  STALE_AFTER_SECONDS,
  ageSeconds,
  formatPrice,
  isStale,
  medianFrom,
} from '../src/pragma.js'

// The exact response the day-0 probe banked for BTC/USD: 80711.0481 at 8dp, 10 sources.
const BTC = ['0x7573355cc10', '0x8', '0x6a9075a4', '0xa']

describe('the median decode', () => {
  it('scales the price out of the decimals the oracle reported', () => {
    const price = medianFrom('BTC/USD', BTC)
    expect(price.decimals).toBe(8)
    expect(price.sources).toBe(10)
    expect(price.timestamp).toBe(1_787_852_196)
    // The banked value, decoded. The point is that the SCALE is read from the response rather
    // than assumed: a hardcoded 8 would be right today and wrong the day Pragma carries a pair
    // at 6, in the direction that looks like a crash.
    expect(price.price).toBeCloseTo(80_711.0481, 6)
  })

  it('reads the decimals rather than assuming them', () => {
    const six = medianFrom('STRK/USD', ['0x2710', '0x6', '0x1', '0x2'])
    expect(six.price).toBeCloseTo(0.01, 9)
    const eight = medianFrom('STRK/USD', ['0x2710', '0x8', '0x1', '0x2'])
    expect(eight.price).toBeCloseTo(0.0001, 9)
  })

  it('refuses a short answer instead of reading undefined as a price', () => {
    expect(() => medianFrom('BTC/USD', [])).toThrow(/median is four/)
    expect(() => medianFrom('BTC/USD', ['0x1', '0x8', '0x1'])).toThrow(/median is four/)
  })

  it('refuses a zero price, which is what a pair the oracle does not carry answers', () => {
    // The failure this prevents is "$0.00" rendered beside BTC as though it were a cheap asset.
    expect(() => medianFrom('BTC/USD', ['0x0', '0x8', '0x1', '0x2'])).toThrow(/no price/)
  })

  it('bounds the decimals before they become an exponent', () => {
    // `10 ** 1e9` is not a number, it is a hang. Bounded where it is read.
    expect(() => medianFrom('BTC/USD', ['0x1', '0x3e8', '0x1', '0x2'])).toThrow(/decimals/)
  })

  it('reports a garbled answer as a parse failure, not as a price', () => {
    expect(() => medianFrom('BTC/USD', ['nope', '0x8', '0x1', '0x2'])).toThrow(/did not parse/)
  })
})

describe('freshness is carried, because the feed genuinely stalls', () => {
  const price = medianFrom('BTC/USD', BTC)
  const at = (seconds: number) => (price.timestamp + seconds) * 1000

  it('ages in seconds against a clock the caller passes', () => {
    expect(ageSeconds(price, at(0))).toBe(0)
    expect(ageSeconds(price, at(90))).toBe(90)
    // A reading from the future is zero-age, not negative: clocks disagree and a negative age
    // would render as a price from the future.
    expect(ageSeconds(price, at(-30))).toBe(0)
  })

  it('goes stale past the display threshold', () => {
    // The day-0 measurement watched this feed sit ELEVEN MINUTES. A strip that only ever renders
    // a bright number would claim a live market during exactly the window that matters.
    expect(isStale(price, at(STALE_AFTER_SECONDS - 1))).toBe(false)
    expect(isStale(price, at(STALE_AFTER_SECONDS + 1))).toBe(true)
  })
})

describe('the call shape matches what the day-0 probe actually called', () => {
  it('pins the oracle, the selector and the spot discriminant', () => {
    expect(PRAGMA_MAINNET).toBe(
      '0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b',
    )
    // The selector is NOT pinned here: `readMedian` passes the entrypoint by NAME and lets the
    // provider hash it, so a pinned constant would have been a value nothing read — asserting it
    // equals itself. The name is the contract.
    // `DataType::SpotEntry` is the first variant, so the calldata leads with its index.
    expect(SPOT_ENTRY).toBe('0x0')
  })

  it('the pair ids are the short strings Pragma keys on', () => {
    // Decoded back to ASCII: a wrong pair id reads as "the oracle has no price" rather than as a
    // typo, so it is worth checking the bytes mean what the key says.
    const ascii = (felt: string) =>
      (felt.slice(2).match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join('')
    expect(ascii(PRAGMA_PAIRS['BTC/USD'])).toBe('BTC/USD')
    expect(ascii(PRAGMA_PAIRS['ETH/USD'])).toBe('ETH/USD')
    expect(ascii(PRAGMA_PAIRS['STRK/USD'])).toBe('STRK/USD')
    expect([...PRAGMA_PAIR_LIST]).toEqual(['BTC/USD', 'ETH/USD', 'STRK/USD'])
  })
})

describe('formatting follows the magnitude', () => {
  it('never rounds a sub-dollar asset into a lie', () => {
    // Two decimals renders STRK at 0.0271 as "0.03" — a 10% error presented as a price.
    expect(formatPrice(0.0271)).toBe('0.02710')
    expect(formatPrice(2.5)).toBe('2.500')
    expect(formatPrice(80711.0481)).toBe('80,711.05')
  })
})
