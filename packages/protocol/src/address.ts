//
// Felt address parsing and equality, once (story 6.7b).
//
// ── WHY THIS IS ITS OWN FILE AND NOT A FUNCTION IN `activity.ts` ──────────────────────────
//
// `markOwnAddress` in `activity.ts` owned the only address comparison in the package, inline inside
// a `map` callback. The self-link detector needs exactly that comparison, and it runs in a browser.
//
// `activity.ts` imports `./discovery.js`, and `discovery.ts` imports both `starknet` and the
// privacy SDK — so importing `activity.ts` to reuse eight characters of `===` would pull a chain
// client and a spawned-devnet test barrel into any bundle that wanted to ask "is this my own
// address?". `token-scale.ts` and `balances.ts` already exist as workarounds for that exact pull.
// The fix is the direction, not the duplication: the comparison moves DOWN into a leaf that imports
// nothing, and `activity.ts` consumes it from there.
//
// ── WHY THE COMPARISON IS `BigInt` AND NOT STRING EQUALITY ────────────────────────────────
//
// A felt has no canonical spelling. `0xa11ce` and `0x00000a11ce` are the same address, and they are
// different strings. `activity.test.ts:316` pins that case deliberately. Any refactor that
// "cleans this up" into a normalised string compare breaks it, so the numeric compare is the
// contract and not an implementation detail.
//
// ── THE ASYMMETRY IS DELIBERATE, AND IT IS THE REASON THERE ARE TWO PARSERS ───────────────
//
// `activity.ts` refuses a malformed address it was HANDED (every row would be mismarked — a bug in
// the caller worth surfacing) and silently skips a malformed counterparty it READ (one bad row
// inside a page of real history — taking the whole feed down is the wrong trade). Both halves are
// pinned by tests. Collapsing them into one parser loses one behaviour or the other, so the throwing
// parser and the null-returning one are both exported and each names which side it is for.
//

/**
 * Parse an address, REFUSING anything that is not one.
 *
 * For values the caller handed us and is responsible for. The message is byte-identical to the one
 * `markOwnAddress` threw before this module existed, because `activity.test.ts` matches on it.
 *
 * NOTE ON WHAT THIS DOES **NOT** REJECT: `BigInt('')` is `0n`, not an error, so a blank string
 * parses. That is pre-existing behaviour and is preserved here rather than tightened, because
 * `markOwnAddress` has shipped with it and no test pins the alternative. `sameAddress` is where the
 * blank case is actually dangerous, and it is refused there instead — see its own note.
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
