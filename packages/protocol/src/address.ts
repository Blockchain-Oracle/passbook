//
// Felt address parsing and equality, once, in a leaf that imports nothing so a browser can ask "is
// this my own address?" without a chain client.
//
// The comparison is `BigInt`, not string equality: a felt has no canonical spelling, and `0xa11ce`
// and `0x00000a11ce` are the same address. Two parsers on purpose: `activity.ts` refuses a
// malformed address it was HANDED (a caller bug worth surfacing) and skips a malformed counterparty
// it READ (one bad row must not take the whole feed down).
//

/**
 * Parse an address, REFUSING anything that is not one — for values the caller handed us.
 *
 * `BigInt('')` is `0n`, not an error, so a blank string parses here; `sameAddress` is where the
 * blank case is dangerous, and it is refused there instead.
 */
export function asAddress(value: string): bigint {
  try {
    return BigInt(value)
  } catch {
    throw new Error(`not an address: ${JSON.stringify(String(value).slice(0, 64))}`)
  }
}

/**
 * A felt in its canonical spelling: `0x`-prefixed lowercase hex, no padding.
 *
 * `discovery.ts` exports a function of the same name, and this is deliberately a second one rather
 * than a re-export: that module reaches the privacy SDK, so importing it to normalise a hex string
 * would drag the whole crypto graph into any browser chunk that wanted one. Held to the original by
 * test, the same way `crowd-rpc.ts`'s event selector is.
 */
export function toFeltHex(value: bigint | string | number): string {
  const parsed = typeof value === 'bigint' ? value : BigInt(value)
  if (parsed < 0n) throw new Error(`a felt cannot be negative: ${String(value)}`)
  return `0x${parsed.toString(16)}`
}

/**
 * Parse an address, or `null` when it is not one.
 *
 * For values we READ out of somewhere — an event field, a pasted box — where one unparseable value
 * is a fact about that value and not a reason to fail everything around it.
 */
export function maybeAddress(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

/**
 * Do two spellings name the same address?
 *
 * Never throws: both sides are things we read, and a comparison is not the place to fail.
 *
 * BLANK IS NEVER EQUAL TO ANYTHING, which is the one place this deliberately departs from
 * `asAddress`. `BigInt('')` is `0n`, so without this guard an empty destination box would compare
 * equal to the zero address and a self-link detector would announce a match against nothing. An
 * empty string is an absent answer, not an address that happens to be zero.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a === 'string' && a.trim() === '') return false
  if (typeof b === 'string' && b.trim() === '') return false
  const left = maybeAddress(a)
  if (left === null) return false
  const right = maybeAddress(b)
  if (right === null) return false
  return left === right
}
