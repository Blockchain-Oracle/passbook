//
// The numeric spine every value surface stands on. Nothing here reaches a chain or re-derives a
// balance — it takes the exact model the walk produced and works out how to put it on a screen
// without lying about it. Rendering lives in `amount-format.ts` and is re-exported here.
//

export * from './amount-format.js'

// ── Reading what the user typed ───────────────────────────────────────────────────────────

export interface ParsedAmount {
  /** The exact value, or `null` when the field does not (yet) hold a number. */
  wei: bigint | null
  /** What the field should display. Sanitized, never re-formatted while the caret is in it. */
  text: string
  /** Why it is not a number — a whole sentence for the blocker chain. `null` when fine or empty. */
  problem: string | null
}

/**
 * Turns keystrokes into an exact amount.
 *
 * NOTHING IS REFORMATTED WHILE TYPING. Grouping a number under the caret moves the caret. The
 * field shows what was typed, minus characters that cannot be part of a number.
 */
export function parseAmountInput(raw: string, decimals: number | null): ParsedAmount {
  // Without this `padEnd(1.5)` coerces to 1 and "1.5" scales to 15n — a wrong answer, not an error.
  if (decimals !== null && (!Number.isInteger(decimals) || decimals < 0)) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }
  // A comma is what a lot of the world types for a decimal point, and a paste can carry grouping.
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  // Second and later points are dropped rather than rejected: refusing the whole value would also
  // throw away the digits before it.
  const text =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')

  // Two dropped characters that change the meaning, reported rather than swallowed: a pasted
  // `1e5` silently became `15` and `-1.5` became `1.5`.
  if (/^[\s]*[-−]/.test(raw)) {
    return { wei: null, text, problem: 'An amount cannot be negative.' }
  }
  if (/\d[eE]/.test(raw)) {
    return { wei: null, text, problem: 'Write the amount out in full — exponent notation is not read here.' }
  }

  if (text === '' || text === '.') return { wei: null, text, problem: null }

  if (decimals === null) {
    return {
      wei: null,
      text,
      problem: 'This token’s decimal places have not been verified here, so an amount cannot be read.',
    }
  }

  const [wholePart = '', fractionPart = ''] = text.split('.')
  if (fractionPart.length > decimals) {
    return {
      wei: null,
      text,
      problem: `This token holds ${decimals} decimal places, and that is ${fractionPart.length}.`,
    }
  }

  const scaled = `${wholePart || '0'}${fractionPart.padEnd(decimals, '0')}`
  return { wei: BigInt(scaled), text, problem: null }
}

/**
 * Whether `entered` is more than `available`.
 *
 * `null` available is NOT insufficient: an unread balance is a thing we do not know, and colouring
 * a number `irreversible` on a guess tells the user their money is short when it may not be.
 */
export function insufficient(entered: bigint | null, available: bigint | null): boolean {
  if (entered === null || available === null) return false
  return entered > available
}

// ── How sure we are of a number ───────────────────────────────────────────────────────────

/**
 * How much weight a displayed value can carry. There is no `'live'` member on purpose: every
 * balance comes from a walk that finished at some point in the past.
 */
export type Confidence = 'dated' | 'unknown'

/** A value and how sure we are of it, travelling as ONE object so the two cannot disagree. */
export interface Valued<T> {
  value: T
  confidence: Confidence
}
