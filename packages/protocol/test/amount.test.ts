import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  AMOUNT_LINE_RATIO,
  AMOUNT_MAX_PX,
  AMOUNT_MIN_PX,
  DIGIT_ADVANCE_EM,
  MINUS,
  amountWidthEm,
  confidenceOf,
  dustVerdict,
  fitAmountFontPx,
  formatTokenAmount,
  insufficient,
  isUnchangedRefetch,
  parseAmountInput,
  toPlainText,
  valued,
} from '../src/amount.js'
import { DEFAULT_DISPLAY_DECIMALS, isDustAt } from '../src/token-scale.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

describe('fitting an amount into a fixed box (§7.1)', () => {
  it('a short amount sits at the ceiling', () => {
    // "12.5" is 4 glyphs → 2.4em → 36px needs 86.4px, and 240 is far more than that.
    expect(fitAmountFontPx('12.5', 240)).toBe(AMOUNT_MAX_PX)
  })

  it('an 18-decimal amount is clamped at the floor rather than overflowing', () => {
    const eighteen = '0.000000000000000001'
    expect(eighteen).toHaveLength(20)
    expect(fitAmountFontPx(eighteen, 240)).toBe(AMOUNT_MIN_PX)
  })

  it('shrinks continuously between the two, not in steps', () => {
    // 10 glyphs → 6em. 180px / 6 = 30px, which is neither endpoint.
    const size = fitAmountFontPx('1234567890', 180)
    expect(size).toBeGreaterThan(AMOUNT_MIN_PX)
    expect(size).toBeLessThan(AMOUNT_MAX_PX)
    expect(size).toBeCloseTo(30, 10)
  })

  it('the width bias never under-measures: the fitted text always fits', () => {
    const available = 200
    for (const text of ['1', '12.5', '0.0001', '123456789012345678', '−1.25']) {
      const size = fitAmountFontPx(text, available)
      // At the floor the text may legitimately be wider than the box — that is what a floor means.
      if (size > AMOUNT_MIN_PX) expect(amountWidthEm(text) * size).toBeLessThanOrEqual(available + 1e-9)
    }
  })

  it('an unmeasurable width returns the CEILING, so mounting does not flash the floor', () => {
    for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fitAmountFontPx('', width)).toBe(AMOUNT_MAX_PX)
    }
    expect(fitAmountFontPx('', 240)).toBe(AMOUNT_MAX_PX)
  })

  it('the tallest possible line still fits the reserved row', () => {
    // This is the arithmetic the reserved 60px row is sized against. If the ceiling or the ratio
    // ever moves, this fails here rather than as a shift nobody can reproduce.
    expect(AMOUNT_MAX_PX * AMOUNT_LINE_RATIO).toBeLessThan(60)
  })

  it("the glyph advance is the face's measured digit width", () => {
    expect(DIGIT_ADVANCE_EM).toBe(0.6)
  })
})

describe('rendering an exact amount (§7.1, never a false zero)', () => {
  const wholeOf = (wei: bigint, decimals: number | null, dp?: number) => formatTokenAmount(wei, decimals, dp)

  it('renders a plain amount', () => {
    expect(wholeOf(1_500_000_000_000_000_000n, 18)).toEqual({
      kind: 'scaled',
      sign: '',
      whole: '1',
      hiddenZeros: 0,
      fraction: '5',
      truncated: false,
    })
  })

  it('renders dust as a subscript, never as zero', () => {
    // 400 wei at 18 decimals = 0.0000000000000004 — fifteen zeros, then a 4.
    const r = wholeOf(400n, 18)
    expect(r).toEqual({
      kind: 'scaled',
      sign: '',
      whole: '0',
      hiddenZeros: 14,
      fraction: '4',
      truncated: false,
    })
    // The convention: "0." + one literal zero + hiddenZeros more + fraction = 16 places.
    expect(r.kind === 'scaled' && 1 + r.hiddenZeros + r.fraction.length).toBe(16)
  })

  it("matches the design authority's own example", () => {
    // 0.0₅1024 is 0.0000001024 — at 18 decimals that is 102_400_000_000n wei.
    expect(wholeOf(102_400_000_000n, 18)).toMatchObject({ whole: '0', hiddenZeros: 5, fraction: '1024' })
  })

  it("the dust branch is chosen by the balance model's own predicate, not a second threshold", () => {
    for (const wei of [1n, 99n, 400n, 10n ** 13n, 10n ** 14n, 10n ** 15n, 10n ** 17n, 10n ** 18n]) {
      const r = formatTokenAmount(wei, 18, DEFAULT_DISPLAY_DECIMALS)
      const subscripted = r.kind === 'scaled' && r.hiddenZeros > 0
      expect(subscripted, `${wei} wei`).toBe(isDustAt(wei, 18, DEFAULT_DISPLAY_DECIMALS))
    }
  })

  it('an unverified token is never scaled', () => {
    expect(wholeOf(123_456_789n, null)).toEqual({ kind: 'raw-units', sign: '', units: '123,456,789' })
  })

  it('a negative amount uses U+2212, never an ASCII hyphen', () => {
    const r = wholeOf(-1_500_000_000_000_000_000n, 18)
    expect(r.sign).toBe(MINUS)
    expect(r.sign).not.toBe('-')
    expect(r.sign.charCodeAt(0)).toBe(0x2212)
  })

  it('zero is zero — it is not dust and gets no subscript', () => {
    expect(wholeOf(0n, 18)).toEqual({
      kind: 'scaled',
      sign: '',
      whole: '0',
      hiddenZeros: 0,
      fraction: '',
      truncated: false,
    })
  })

  it('says when the displayed value is short of the truth', () => {
    // 1.234567 at four places shows 1.2345 and admits the rest was cut.
    expect(wholeOf(1_234_567_000_000_000_000n, 18, 4)).toMatchObject({ fraction: '2345', truncated: true })
    expect(wholeOf(1_200_000_000_000_000_000n, 18, 4)).toMatchObject({ fraction: '2', truncated: false })
  })

  it('groups the whole part deterministically, without consulting the machine locale', () => {
    expect(wholeOf(1_234_567n * 10n ** 18n, 18)).toMatchObject({ whole: '1,234,567' })
  })

  it('refuses a fractional scale rather than rounding one', () => {
    expect(() => formatTokenAmount(1n, 1.5)).toThrow(/whole number/)
  })

  it('round-trips back into the field without grouping', () => {
    // What an additive chip writes back. Grouped output would have to be stripped again before the
    // next keystroke parsed it, and that round trip is where a value quietly loses a digit.
    expect(toPlainText(1_500_000_000_000_000_000n, 18)).toBe('1.5')
    expect(toPlainText(21n * 10n ** 18n, 18)).toBe('21')
    expect(toPlainText(1_234_567n * 10n ** 18n, 18)).toBe('1234567')
    expect(parseAmountInput(toPlainText(400n, 18), 18).wei).toBe(400n)
  })

  it('never emits a negative hiddenZeros, however few places the caller shows', () => {
    // At `displayDecimals: 0` every sub-unit amount is dust by `isDustAt`'s own rule, and 0.5 has
    // NO leading zero — so the naive `firstSignificant - 1` is -1. A renderer doing
    // `'0'.repeat(hiddenZeros)` throws; one doing `'0.0' + …` prints 0.05 for 0.5.
    for (const [wei, decimals] of [
      [5n, 1],
      [5n * 10n ** 17n, 18],
      [1n, 18],
    ] as const) {
      const r = formatTokenAmount(wei, decimals, 0)
      expect(r.kind === 'scaled' && r.hiddenZeros, `${wei} wei at ${decimals}dp`).toBeGreaterThanOrEqual(0)
    }
  })

  it('carries a negative back into the field instead of silently dropping it', () => {
    // The earlier version took the absolute value and never put the sign back, so `-1.5` came out
    // as `1.5` and re-parsed as a positive amount. In a module whose stated rule is that a
    // negative must be spelled correctly, deleting it is worse than the hyphen it bans.
    expect(toPlainText(-1_500_000_000_000_000_000n, 18)).toBe('-1.5')
    expect(toPlainText(-21n * 10n ** 18n, 18)).toBe('-21')
  })

  it('never flattens the dust tri-state into a confident answer', () => {
    expect(dustVerdict(true)).toBe('dust')
    expect(dustVerdict(false)).toBe('not-dust')
    // The whole point: `null` is NOT the false branch. An unverified token's dust status is
    // unknown, and "not-dust" would be a claim nobody is in a position to make.
    expect(dustVerdict(null)).toBe('not-known')
    expect(dustVerdict(null)).not.toBe('not-dust')
  })
})

describe('reading what the user typed', () => {
  it('turns a decimal string into exact wei', () => {
    expect(parseAmountInput('1.5', 18)).toEqual({ wei: 1_500_000_000_000_000_000n, text: '1.5', problem: null })
  })

  it('an empty field is not an error', () => {
    expect(parseAmountInput('', 18)).toEqual({ wei: null, text: '', problem: null })
    expect(parseAmountInput('.', 18)).toMatchObject({ wei: null, problem: null })
  })

  it('drops characters that cannot be part of a number, keeping the digits', () => {
    expect(parseAmountInput('1a2', 18).text).toBe('12')
    expect(parseAmountInput('1.2.3', 18).text).toBe('1.23')
  })

  it('reads a comma as a decimal point', () => {
    expect(parseAmountInput('1,5', 18).wei).toBe(1_500_000_000_000_000_000n)
  })

  it('refuses more places than the token has, and says how many it has', () => {
    const r = parseAmountInput('1.0000000000000000001', 18)
    expect(r.wei).toBeNull()
    expect(r.problem).toBe('This token holds 18 decimal places, and that is 19.')
  })

  it('refuses to read an amount for a token whose scale is unverified', () => {
    const r = parseAmountInput('1.5', null)
    expect(r.wei).toBeNull()
    expect(r.problem).toContain('have not been verified')
  })

  it('reports a pasted negative instead of quietly making it positive', () => {
    // Stripping the sign is right for a keystroke and wrong for a paste: the value that lands is
    // not merely rescaled, it is the opposite of what was pasted, and nothing said so.
    for (const raw of ['-1.5', '−1.5', '  -1.5']) {
      const r = parseAmountInput(raw, 18)
      expect(r.wei, raw).toBeNull()
      expect(r.problem, raw).toBe('An amount cannot be negative.')
    }
  })

  it('reports exponent notation instead of reading it as digits', () => {
    // `1e5` silently became 15 — not 100,000 — because the `e` was stripped and the digits closed up.
    const r = parseAmountInput('1e5', 18)
    expect(r.wei).toBeNull()
    expect(r.problem).toContain('exponent notation')
  })

  it('refuses a fractional scale rather than reading at the wrong one', () => {
    // Without the guard, `padEnd(1.5)` coerces to 1 and "1.5" scales to 15n.
    expect(() => parseAmountInput('1.5', 1.5)).toThrow(/whole number/)
    expect(() => parseAmountInput('1.5', -1)).toThrow(/whole number/)
  })
})

describe('insufficient balance', () => {
  it('is true only when the entered amount exceeds a KNOWN balance', () => {
    expect(insufficient(5n, 2n)).toBe(true)
    expect(insufficient(2n, 2n)).toBe(false)
    expect(insufficient(1n, 2n)).toBe(false)
  })

  it('is false when the balance is unknown — an unread balance is not a shortfall', () => {
    expect(insufficient(5n, null)).toBe(false)
    expect(insufficient(null, 2n)).toBe(false)
  })
})

describe('confidence is derived from the balance model, never authored', () => {
  it('an incomplete walk is unknown', () => {
    expect(confidenceOf({ book: 'unknown', blockNumber: 900 })).toBe('unknown')
  })

  it('a completed walk with no height is unknown', () => {
    expect(confidenceOf({ book: 'holdings', blockNumber: null })).toBe('unknown')
  })

  it('a completed, datable walk is dated', () => {
    expect(confidenceOf({ book: 'holdings', blockNumber: 900 })).toBe('dated')
    expect(confidenceOf({ book: 'no-activity', blockNumber: 900 })).toBe('dated')
  })

  it('an unregistered address is a thing we know, not a thing we failed to read', () => {
    expect(confidenceOf({ book: 'not-registered', blockNumber: null })).toBe('dated')
  })

  it('refuses an unrecognised book state rather than guessing at it', () => {
    // The compiler already rejects a fifth `BookState` at every call site; this covers the runtime
    // half — a value arriving from storage or a wire that TypeScript never saw. The failure mode
    // it replaces is silent: a ternary with a default treats an unknown book as one that was read.
    expect(() => confidenceOf({ book: 'reorganised' as never, blockNumber: 900 })).toThrow(
      /unhandled book state/,
    )
  })

  it('the value and its confidence travel as one object', () => {
    expect(valued('0.5', { book: 'unknown', blockNumber: null })).toEqual({
      value: '0.5',
      confidence: 'unknown',
    })
  })
})

describe('a refetch that changed nothing still happened', () => {
  const read = (value: string) => ({ value, confidence: 'dated' as const })

  it('a new object with an equal value is a refetch', () => {
    expect(isUnchangedRefetch(read('12.5'), read('12.5'))).toBe(true)
  })

  it('the SAME object is a re-render, not a read', () => {
    // This is the one that matters. Treat identity as irrelevant and the pulse fires on every
    // keystroke, because a caller writing the object inline in JSX mints a new one each render.
    const once = read('12.5')
    expect(isUnchangedRefetch(once, once)).toBe(false)
  })

  it('a changed value is not a pulse — the change is its own signal', () => {
    expect(isUnchangedRefetch(read('12.5'), read('12.6'))).toBe(false)
  })

  it('first paint is not a refetch', () => {
    expect(isUnchangedRefetch(null, read('12.5'))).toBe(false)
    expect(isUnchangedRefetch(read('12.5'), null)).toBe(false)
  })
})

describe('the copy this module ships is clean', () => {
  it('names no refused claim, comments included', () => {
    const source = readFileSync(new URL('../src/amount.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})
