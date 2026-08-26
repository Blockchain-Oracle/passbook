//
// What a token's scale is, and when an amount is too small to show. A LEAF MODULE, on purpose.
//
// ── WHY THIS IS NOT IN `balances.ts`, WHERE IT STARTED ────────────────────────────────────
//
// It was, and importing it from the browser pulled the entire privacy SDK into the bundle. The
// edge is three hops and completely invisible from the call site: `balances.ts` needs `toFeltHex`
// from `discovery.ts`, `discovery.ts` imports the SDK's ABI, and the SDK's logger imports Node's
// `async_hooks`. A surface that wanted one integer — how many decimal places STRK has — shipped
// 266 kB of chain-walking code to a user's browser to get it.
//
// `scripts/build-web.mjs` caught it, which is worth recording: the symptom was ONE extra
// externalized-module warning, and the gate treats an unexpected warning as a build failure for
// exactly this reason. Nothing else would have noticed — the app worked, the types checked, and
// the bundle was simply a quarter of a megabyte heavier.
//
// So the rule this file exists to enforce: THE THINGS A UI NEEDS TO RENDER A NUMBER MUST NOT
// IMPORT THE THINGS THAT READ A CHAIN. `balances.ts` re-exports all three of these, so nothing
// downstream had to change and the balance model is still their one home conceptually.
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
