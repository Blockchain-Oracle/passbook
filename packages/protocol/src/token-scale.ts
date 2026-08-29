//
// What a token's scale is, and when an amount is too small to show. A LEAF MODULE: the things a
// UI needs to render a number must not import the things that read a chain (`balances.ts` reaches
// the privacy SDK three hops away, and once shipped 266 kB to a browser that wanted one integer).
// `balances.ts` re-exports all three of these.
//
import { STRK_TOKEN } from './constants.js'

/**
 * How many decimal places a balance tile shows before a value is "too small to see".
 *
 * Four is the tile's precision, not a protocol fact — which is why it is a default a caller
 * may override rather than a constant baked into the predicate.
 */
export const DEFAULT_DISPLAY_DECIMALS = 4

/**
 * Decimals we have actually verified, and nothing else.
 *
 * STRK is here because `constants.ts` records it as read live on SN_MAIN rather than copied
 * from a list. NO OTHER TOKEN IS HERE, and the empty space is the point: the pool carries
 * whatever ERC-20s its users deposit, this repository has verified the decimals of exactly
 * one of them, and a guessed 18 on a 6-decimal token would misplace a balance by a factor of
 * a trillion in the direction that looks like dust. A token that is not in this map gets a
 * `null` verdict — see `TokenBalance.isDust` — never a confident one.
 */
export const KNOWN_TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  [STRK_TOKEN]: 18,
}

/**
 * Whether `wei` would render as a zero at `displayDecimals` places.
 *
 * Zero is NOT dust: a zero balance renders as "0" correctly and needs no special treatment.
 * Dust is specifically the non-zero amount that a naive renderer turns into a false zero.
 *
 * Guards `displayDecimals > decimals`, which would otherwise raise 10 to a negative power and
 * make every non-zero amount dust — showing more places than a token has cannot hide anything.
 */
export function isDustAt(wei: bigint, decimals: number, displayDecimals = DEFAULT_DISPLAY_DECIMALS): boolean {
  // GUARDED BEFORE `BigInt`, which throws a bare `RangeError` on a fraction — from inside what
  // a caller experiences as reading a balance. A non-integer decimals is not a near-miss to be
  // rounded either: it means a token's scale came from somewhere that does not know it, and
  // guessing which way to round would misplace the dust threshold by a factor of ten.
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0) {
    throw new Error(`display precision must be a whole number, not ${String(displayDecimals)}`)
  }
  if (wei <= 0n) return false
  if (displayDecimals >= decimals) return false
  return wei < 10n ** BigInt(decimals - displayDecimals)
}

/**
 * Looks a token's decimals up by FELT VALUE, never by string equality.
 *
 * The same address has many spellings. `constants.ts` writes `STRK_TOKEN` padded to 64 hex
 * digits, the discovery walk emits the unpadded form its `AddressMap` keys normalize to, and a
 * caller supplying their own map will use whichever they had. String-keyed lookup silently
 * misses across any two of those — and a miss here is not a crash, it is a `null` verdict that
 * reads as "we cannot say whether this is dust" for a token whose decimals we know perfectly
 * well. Comparing `BigInt(a) === BigInt(b)` is the `send.ts` `same()` precedent, and it makes
 * every spelling of an address the same address.
 *
 * A malformed key in a caller-supplied map is skipped rather than thrown on: the map is
 * decoration for a balance, and one bad entry must not take the balance down with it.
 *
 * Lives here, chain-free, so the felt-aware lookup is reachable from a browser: indexing
 * `KNOWN_TOKEN_DECIMALS` directly gets `undefined` for every address spelled differently from the
 * constant, and that failure silently renders a real balance in raw units.
 */
export function lookupDecimals(
  table: Readonly<Record<string, number>>,
  token: string,
): number | null {
  let wanted: bigint
  try {
    wanted = BigInt(token)
  } catch {
    return null
  }
  for (const [key, decimals] of Object.entries(table)) {
    try {
      if (BigInt(key) === wanted) return decimals
    } catch {
      continue
    }
  }
  return null
}
