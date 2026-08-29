//
// Rendering an exact amount (story 6.4, DESIGN §7.1). The three rules:
//
// 1. NEVER A FALSE "0". The dust decision is delegated to `isDustAt` so the predicate the balance
//    model tests and the branch this file takes cannot drift apart.
// 2. NEVER SCALE AN UNVERIFIED TOKEN. `decimals: null` renders the exact integer and its unit.
// 3. NEVER AN ASCII HYPHEN ON A NEGATIVE. U+2212 sits on the tabular digit grid; "-" does not.
//
// `token-scale.js`, NOT `balances.js`: `balances.ts` reaches the privacy SDK, and importing the
// dust predicate from there ships the whole chain-walking graph to a browser that wanted one integer.
//
import { DEFAULT_DISPLAY_DECIMALS, isDustAt } from './token-scale.js'

/** How many significant digits a dust amount shows after its hidden zeros (`0.0₅1024`). */
export const DUST_SIGNIFICANT_DIGITS = 4

/** U+2212. Never `-`. */
export const MINUS = '−'

/**
 * A scaled amount, in the parts a renderer needs — never a pre-baked string. The subscript cannot
 * survive being flattened into text, and the insufficient-balance rule colours the number
 * separately from its symbol.
 */
export interface ScaledAmount {
  kind: 'scaled'
  sign: '' | typeof MINUS
  /** The whole part, grouped. `"0"` when there is none. */
  whole: string
  /**
   * The count of zeros HIDDEN behind the subscript, or 0 when the fraction renders plainly.
   * `0.0₅1024` = 0.0000001024: one literal zero after the point, then this many more, then
   * `fraction`. A renderer without a subscript writes out `hiddenZeros + 1` zeros.
   */
  hiddenZeros: number
  /** The digits after the point (after any hidden zeros), trailing zeros trimmed. */
  fraction: string
  /** True when digits were dropped past the requested precision — the value shown is not exact. */
  truncated: boolean
}

/** An amount whose token scale is unverified. It is shown as-is, in its smallest unit. */
export interface RawUnitAmount {
  kind: 'raw-units'
  sign: '' | typeof MINUS
  /** The exact integer, grouped. */
  units: string
}

export type RenderedAmount = ScaledAmount | RawUnitAmount

/**
 * Groups an integer's digits in threes. By hand rather than `Intl.NumberFormat` so the output does
 * not depend on the machine's locale.
 */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Puts an exact amount on screen without lying about it.
 *
 * @param wei              the exact amount in the token's smallest unit
 * @param decimals         the token's scale, or `null` when unverified
 * @param displayDecimals  how many places the caller intends to show
 */
export function formatTokenAmount(
  wei: bigint,
  decimals: number | null,
  displayDecimals: number = DEFAULT_DISPLAY_DECIMALS,
): RenderedAmount {
  const negative = wei < 0n
  const abs = negative ? -wei : wei
  const sign = negative ? MINUS : ''

  // RULE 2. No scale, no scaling.
  if (decimals === null) return { kind: 'raw-units', sign, units: groupDigits(abs.toString()) }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }

  const base = 10n ** BigInt(decimals)
  const whole = groupDigits((abs / base).toString())
  const remainder = abs % base

  if (remainder === 0n) return { kind: 'scaled', sign, whole, hiddenZeros: 0, fraction: '', truncated: false }

  // Zero-padded to the token's full scale, so position N in this string always means 10^-(N+1).
  const full = remainder.toString().padStart(decimals, '0')

  // RULE 1. The dust branch is chosen by the balance model's own predicate, never a second threshold.
  if (isDustAt(abs, decimals, displayDecimals)) {
    const firstSignificant = full.search(/[1-9]/)
    const digits = full.slice(firstSignificant).replace(/0+$/, '')
    const shown = digits.slice(0, DUST_SIGNIFICANT_DIGITS)
    return {
      kind: 'scaled',
      sign,
      whole: '0',
      // CLAMPED AT ZERO: at `displayDecimals: 0`, 0.5 has NO leading zero and the subtraction
      // yields -1, which a renderer doing `'0'.repeat(hiddenZeros)` throws on.
      hiddenZeros: Math.max(0, firstSignificant - 1),
      fraction: shown,
      truncated: shown.length < digits.length,
    }
  }

  const shown = full.slice(0, displayDecimals)
  return {
    kind: 'scaled',
    sign,
    whole,
    hiddenZeros: 0,
    fraction: shown.replace(/0+$/, ''),
    // The value shown is short of the truth whenever anything non-zero was cut off.
    truncated: /[1-9]/.test(full.slice(displayDecimals)),
  }
}

/**
 * An exact amount as a bare decimal string — no grouping, no sign glyph, nothing to re-parse
 * around. This is what goes back INTO the field after an additive chip, so it is deliberately not
 * `formatTokenAmount`. The sign is carried as an ASCII `-` because `parseAmountInput` reads it.
 */
export function toPlainText(wei: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }
  const negative = wei < 0n
  const abs = negative ? -wei : wei
  const base = 10n ** BigInt(decimals)
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  const magnitude = fraction === '' ? (abs / base).toString() : `${abs / base}.${fraction}`
  return negative ? `-${magnitude}` : magnitude
}
