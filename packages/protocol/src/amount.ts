//
// The numeric spine every value surface stands on (story 6.4, DESIGN §7.1).
//
// `balances.ts` ends its header with "Epic 6 owns the subscript rendering; this owns the truth it
// renders." This is that file. Nothing here reaches a chain, re-derives a balance, or decides
// whether a number is trustworthy — it takes the exact model that walk produced and works out how
// to put it on a screen without lying about it.
//
// ── THE THREE RULES, AND WHY EACH ONE IS A RULE ───────────────────────────────────────────
//
// 1. NEVER A FALSE "0". A privacy pool that renders 400 wei as "0" has told a user their money is
//    gone. The dust decision is delegated to `isDustAt` rather than re-derived here, so the
//    predicate the balance model tests and the branch this file takes cannot drift apart.
//
// 2. NEVER SCALE AN UNVERIFIED TOKEN. `decimals: null` means this repository has not verified that
//    token's scale, and guessing 18 on a 6-decimal token misplaces the amount by a factor of a
//    trillion — in the direction that looks like dust. An unknown scale renders the exact integer
//    and its unit, and says so.
//
// 3. NEVER AN ASCII HYPHEN ON A NEGATIVE. Under tabular figures U+2212 sits on the digit grid and
//    "-" does not, so a column of amounts with one negative in it steps sideways by the difference.
//    In the fallback face the hyphen widens to a full digit column and the step gets worse.
//
// `token-scale.js`, NOT `balances.js`, and the distinction is load-bearing rather than tidy:
// `balances.ts` reaches `discovery.ts` reaches the privacy SDK reaches Node's `async_hooks`, so
// importing the dust predicate from there ships the whole chain-walking graph to a browser that
// wanted one integer. The `ShieldedBalance` import below is `import type` for the same reason —
// erased at compile time, so it carries no runtime edge at all.
import { DEFAULT_DISPLAY_DECIMALS, isDustAt } from './token-scale.js'
import type { ShieldedBalance } from './balances.js'

// ── Fitting a number into a fixed box ─────────────────────────────────────────────────────

/**
 * The advance of one digit, in em. THE WHOLE PER-GLYPH WIDTH TABLE IS THIS NUMBER.
 *
 * That is a finding rather than a shortcut. The design authority records it as measured on the
 * shipped face (`design/tokens.yaml`, typography): IBM Plex Sans's digits are 600/1000 em at EVERY
 * position on the weight axis, unconditionally — which is also why the app's `tabular-nums` is a
 * measured 0.000px no-op on Plex and stays on only as insurance for the fallback face.
 *
 * The other characters an amount can contain — `.`, `,` and U+2212 — are all NARROWER than a digit
 * in this face, and under tabular figures the minus is by definition ON the digit grid. So billing
 * every character one full digit column is an upper bound BY CONSTRUCTION, not by estimate, which
 * is exactly the "biased slightly wide so 18-decimal amounts never overflow" the design asks for.
 *
 * The bias is the point. Under-measuring by a hair overflows the container and there is no second
 * chance to notice; over-measuring costs at most a font size that is a little smaller than it had
 * to be, which nobody can see.
 */
export const DIGIT_ADVANCE_EM = 0.6

/** The ceiling. Matches the `heading2` step (36/40), which is where an untyped field sits. */
export const AMOUNT_MAX_PX = 36

/** The floor. Matches the `heading3` step (24/28). Below this an amount stops being the headline. */
export const AMOUNT_MIN_PX = 24

/** `lineHeight = size × 1.2`, per §7.1. At the ceiling that is 43.2px — inside the reserved row. */
export const AMOUNT_LINE_RATIO = 1.2

/** How many significant digits a dust amount shows after its hidden zeros (`0.0₅1024`). */
export const DUST_SIGNIFICANT_DIGITS = 4

/** Width of `text` at 1em, biased wide. See `DIGIT_ADVANCE_EM`. */
export function amountWidthEm(text: string): number {
  return text.length * DIGIT_ADVANCE_EM
}

/**
 * The largest font size in [24, 36] at which `text` still fits `availablePx`, continuous.
 *
 * WHY AN UNMEASURABLE WIDTH RETURNS THE CEILING AND NOT THE FLOOR. Before the `ResizeObserver`
 * first fires, the container's width is 0 — and 0 is also what a display:none ancestor reports. The
 * floor would be the "safe" answer and it is the wrong one: the field is never pre-filled, so at
 * mount the text is empty and the ceiling is genuinely correct. Returning the floor there would
 * paint 24px for one frame and then jump to 36px, which is a layout shift invented by the guard
 * meant to prevent one.
 */
export function fitAmountFontPx(text: string, availablePx: number): number {
  if (!Number.isFinite(availablePx) || availablePx <= 0) return AMOUNT_MAX_PX
  const em = amountWidthEm(text)
  if (em <= 0) return AMOUNT_MAX_PX
  return Math.min(AMOUNT_MAX_PX, Math.max(AMOUNT_MIN_PX, availablePx / em))
}

// ── Rendering an exact amount ─────────────────────────────────────────────────────────────

/** U+2212. Never `-`. */
export const MINUS = '−'

/**
 * A scaled amount, in the parts a renderer needs — never a pre-baked string.
 *
 * The subscript cannot survive being flattened into text (`0.0₅1024` as a string has already
 * decided the reader has that glyph), and the insufficient-balance rule needs to colour the number
 * separately from its symbol. Handing back parts lets the component do both without re-parsing.
 */
export interface ScaledAmount {
  kind: 'scaled'
  sign: '' | typeof MINUS
  /** The whole part, grouped. `"0"` when there is none. */
  whole: string
  /**
   * The count of zeros HIDDEN behind the subscript, or 0 when the fraction renders plainly.
   *
   * The convention is `0.0₅1024` = 0.0000001024: one literal zero after the point, then this many
   * more, then `fraction`. So a renderer with a subscript writes `0.0` + `hiddenZeros` + `fraction`,
   * and one without can still write out `hiddenZeros + 1` zeros and be correct.
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
 * Groups an integer's digits in threes.
 *
 * A CALL MADE IN THE ABSENCE OF AUTHORITY, said out loud rather than buried: neither the design
 * document nor the PRD specifies digit grouping, and NOT grouping is just as much a choice as
 * grouping. English-locale money groups in threes with a comma, the app's language is pinned to
 * English, and a nine-figure wei count with no grouping is unreadable. Done by hand rather than
 * through `Intl.NumberFormat` so the output does not depend on the machine's locale — a test that
 * passes here and fails on a French CI runner is worse than either choice.
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

  // RULE 2. No scale, no scaling. The unit is the caller's to name; this only refuses to invent
  // a decimal point that would move the value by orders of magnitude.
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

  // RULE 1. The dust branch is chosen by the balance model's own predicate, never by a second
  // threshold computed here. `isDustAt` already guards `displayDecimals >= decimals` and rejects
  // fractional input, and it is what `TokenBalance.isDust` is computed with — so the badge that
  // says "this is dust" and the renderer that draws it as a subscript can never disagree.
  if (isDustAt(abs, decimals, displayDecimals)) {
    const firstSignificant = full.search(/[1-9]/)
    const digits = full.slice(firstSignificant).replace(/0+$/, '')
    const shown = digits.slice(0, DUST_SIGNIFICANT_DIGITS)
    return {
      kind: 'scaled',
      sign,
      whole: '0',
      // CLAMPED AT ZERO, and it is not belt-and-braces. At `displayDecimals: 0` every sub-unit
      // amount is dust by `isDustAt`'s own rule, and 0.5 has NO leading zero — `firstSignificant`
      // is 0 and the subtraction yields -1. A renderer doing `'0'.repeat(hiddenZeros)` throws a
      // bare RangeError; one doing `'0.0' + …` silently prints 0.05 for 0.5, understating the
      // amount tenfold. Zero means "no hidden zeros", which is exactly right for that case.
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
 * `TokenBalance.isDust` as a word, WITHOUT flattening its third state.
 *
 * The defect this exists to prevent is a one-character one: `isDust ? … : …` turns `null` into the
 * `false` branch, and `false` is the confident claim "this renders fine at full precision" about a
 * token whose scale this repository has never verified. The tri-state is deliberate on the model
 * (see `KNOWN_TOKEN_DECIMALS`), and a ternary is exactly how it gets thrown away.
 */
export type DustVerdict = 'dust' | 'not-dust' | 'not-known'

export function dustVerdict(isDust: boolean | null): DustVerdict {
  if (isDust === null) return 'not-known'
  return isDust ? 'dust' : 'not-dust'
}

/**
 * An exact amount as a bare decimal string — no grouping, no sign, nothing to re-parse around.
 *
 * This is what goes back INTO the field after an additive chip, so it is deliberately not
 * `formatTokenAmount`: grouped output would have to be stripped again before the next keystroke
 * parsed, and the round trip through a separator is where a value quietly loses a digit.
 */
export function toPlainText(wei: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }
  // THE SIGN IS CARRIED, not dropped. An earlier version took the absolute value and never put it
  // back, so `-1.5` came out as `1.5` and re-parsed as a positive amount — in a module whose stated
  // rule is that a negative must be spelled correctly, silently deleting the negative is worse than
  // the ASCII hyphen it bans. U+2212 is NOT used here: this string goes back into an input that
  // `parseAmountInput` reads, and that parser strips everything but digits and a point.
  const negative = wei < 0n
  const abs = negative ? -wei : wei
  const base = 10n ** BigInt(decimals)
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  const magnitude = fraction === '' ? (abs / base).toString() : `${abs / base}.${fraction}`
  return negative ? `-${magnitude}` : magnitude
}

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
 * NOTHING IS REFORMATTED WHILE TYPING. Grouping a number under the caret moves the caret, and the
 * user is then editing a different digit than the one they were looking at. The field shows what
 * was typed, minus characters that cannot be part of a number; the balance line beside it is where
 * formatted output lives.
 */
export function parseAmountInput(raw: string, decimals: number | null): ParsedAmount {
  // Guarded like every sibling in this file. Without it `padEnd(1.5)` coerces to 1 and "1.5"
  // scales to 15n — a wrong answer rather than an error, from a token whose scale came from
  // somewhere that does not know it.
  if (decimals !== null && (!Number.isInteger(decimals) || decimals < 0)) {
    throw new Error(`a token's decimals must be a whole number, not ${String(decimals)}`)
  }
  // A comma is what a lot of the world types for a decimal point, and a paste can carry grouping
  // separators. Both become the one separator this parser understands rather than an error.
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  // Second and later points are dropped rather than rejected: the keystroke that produced one was
  // a mistake, and refusing the whole value would also throw away the digits before it.
  const text =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')

  //
  // TWO DROPPED CHARACTERS THAT CHANGE THE MEANING, reported rather than swallowed.
  //
  // Stripping letters and punctuation is right for a keystroke — there is no way to type `e` into
  // an amount and mean something. It is wrong for a PASTE: `1e5` silently became `15` (not
  // 100,000) and `-1.5` silently became `1.5`, so the field showed a number the user never wrote
  // and never told them. A minus is the worse of the two, because the value is not just rescaled,
  // it is the opposite of what was pasted.
  //
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
 * `null` available is NOT insufficient, and that is the honest direction. An unread balance is a
 * thing we do not know, and colouring a number `irreversible` on a guess tells the user their
 * money is short when it may not be. The unknown case is its own link in the blocker chain, where
 * it can say what is actually true.
 */
export function insufficient(entered: bigint | null, available: bigint | null): boolean {
  if (entered === null || available === null) return false
  return entered > available
}

// ── How sure we are of a number ───────────────────────────────────────────────────────────

/**
 * How much weight a displayed value can carry.
 *
 * THERE IS NO `'live'` MEMBER, AND ITS ABSENCE IS THE POINT. Every balance in this app comes from
 * a walk that finished at some point in the past, and `ShieldedBalance.blockNumber` is explicitly
 * the height read BESIDE the walk rather than one the walk was pinned to. Nothing here can
 * truthfully say "this is the number right now", so there is no way to spell it. Add the member
 * when something can actually produce it — not before.
 */
export type Confidence = 'dated' | 'unknown'

/**
 * A value and how sure we are of it, travelling as ONE object (§7.1).
 *
 * Two parameters that must agree, passed separately, will eventually disagree — a surface refetches
 * the number and forgets the colour, and a stale value renders as though it were fresh.
 */
export interface Valued<T> {
  value: T
  confidence: Confidence
}

/**
 * Derives confidence from the balance model. NEVER authored at a call site.
 *
 * A surface deciding that a number looks trustworthy is the failure this closes: the facts that
 * settle it — whether the walk completed, and whether it can be dated — already live on the model,
 * so reading them is both shorter and impossible to get wrong locally.
 */
export function confidenceOf(balance: Pick<ShieldedBalance, 'book' | 'blockNumber'>): Confidence {
  // EXHAUSTIVE BY CONSTRUCTION. A ternary with a default would send a future `BookState` member
  // down whichever branch happened to be last — silently treating an unrecognised book as though
  // it had been read. The `never` assignment makes a fifth member a compile error here, which is
  // the behaviour the story asked for and a fallthrough cannot give.
  switch (balance.book) {
    case 'unknown':
      // The walk did not complete. This is not an empty book; it is an unread one.
      return 'unknown'
    case 'not-registered':
      // A thing we KNOW: the pool holds no viewing key, so nothing could have been sent here.
      // There is no height to date it against and none is needed.
      return 'dated'
    case 'no-activity':
    case 'holdings':
      // Both came from a completed walk, so the only remaining question is whether it can be dated.
      return balance.blockNumber === null ? 'unknown' : 'dated'
    default: {
      const unhandled: never = balance.book
      throw new Error(`unhandled book state: ${String(unhandled)}`)
    }
  }
}

/** Wraps a value in the confidence its balance model earns. */
export function valued<T>(value: T, balance: Pick<ShieldedBalance, 'book' | 'blockNumber'>): Valued<T> {
  return { value, confidence: confidenceOf(balance) }
}

/**
 * Whether two successive `Valued`s are a REFETCH THAT CHANGED NOTHING.
 *
 * This is the pulse's trigger (§7.1), and it is subtler than it looks — which is why it is a named
 * predicate here rather than a condition buried in an effect.
 *
 * A refetch that came back the same still happened, and the user is entitled to see that it did; a
 * skeleton would claim the number went away and returned, which is a picture of something that did
 * not occur. What identifies one is a NEW OBJECT carrying an EQUAL value:
 *
 *   - same object          → a re-render, not a read. Pulsing here fires on every keystroke.
 *   - different value      → the number changed, and the change is its own signal.
 *   - no previous          → first paint. Nothing was re-read.
 *
 * The object-identity half is precisely why `Valued` travels as one object: with the value and its
 * confidence passed as two separate props there is no single identity to compare.
 */
export function isUnchangedRefetch<T>(previous: Valued<T> | null, next: Valued<T> | null): boolean {
  if (!previous || !next) return false
  if (previous === next) return false
  return previous.value === next.value
}
