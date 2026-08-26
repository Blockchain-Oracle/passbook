//
// The digit machine, as data (story 6.7b, DESIGN:242, EXPERIENCE:138).
//
// ── A LEAF THAT IMPORTS NOTHING ───────────────────────────────────────────────────────────
//
// The point of modelling an animation as data is that its correctness becomes testable without a
// DOM. `vitest.config.ts` collects `packages/*/test/**` only, so a roll rule written inside a
// `.tsx` is a rule no runner ever executes. Everything decidable about the roll is decided here.
//
// ── WHICH DIGITS MOVE: THE CANON CONTRADICTS ITSELF AND ONE READING IS VACUOUS ────────────
//
// DESIGN:242 — "only digits after the first changed one animate."
// EXPERIENCE:138 — "only digits after the common prefix animate."
//
// These sound identical and are not. For 23 → 26 the common prefix is `2`, so EXPERIENCE rolls the
// `6`. DESIGN says digits after the FIRST CHANGED one — and the `6` IS the first changed digit, so
// DESIGN literally specifies that nothing moves. Under that reading a single-digit change never
// animates at all, which would make the odometer dead on the most common update it will ever see.
//
// EXPERIENCE:138 is the only reading under which the behaviour exists, so THE COMMON PREFIX IS THE
// RULE. DESIGN:242 is read as loose phrasing for the same intent. Recorded here rather than in a
// commit message because the next person to compare the two documents will otherwise "fix" it back.
//
// The prefix defines a REGION, and within that region a glyph moves only if it differs from what
// was there before. Both halves are load-bearing and neither alone is right: without the region,
// 1023 → 1073 would drag the leading `10` along; without the difference test, 123 → 173 would spin
// the trailing `3` from three to three, which is motion standing for a change that did not happen.
//
// ── WHY THIS FILE CONTAINS NO MILLISECONDS ────────────────────────────────────────────────
//
// `180ms/digit` and `40ms stagger` (DESIGN:242) are design-authority numbers. They live in
// `tokens.yaml`, are written once into the stylesheet, and the sixth build verdict resolves the
// stylesheet against the yaml to prove they agree. Putting them here too would create a third copy
// that the gate cannot reach — and a number no gate can reach is a number that drifts.
//
// So a roll carries its ORDINAL (`step`), not its delay. The component hands the step to CSS and
// CSS multiplies: `animation-delay: calc(var(--odometer-stagger) * var(--roll-step))`. The
// stagger stays in exactly two places, and one of them checks the other.
//

/** One glyph's movement. `from` is `null` when the number grew and this column is new. */
export interface DigitRoll {
  /** Position in the rendered target string, left to right. */
  readonly index: number
  readonly from: string | null
  readonly to: string
  /** Ordinal in the stagger, starting at 0 for the leftmost rolling digit. */
  readonly step: number
}

/** A glyph in the rendered figure, and whether it is one of the ones that moves. */
export interface DigitCell {
  readonly char: string
  readonly rolling: boolean
}

export interface RollPlan {
  /** The target figure, per glyph. Always the full number — even when nothing rolls. */
  readonly digits: readonly DigitCell[]
  /** Only the glyphs that move, in stagger order. Empty on a first paint and on an equal update. */
  readonly rolls: readonly DigitRoll[]
  /** DESIGN:242, "roll direction encodes sign". `none` when there is nothing to encode. */
  readonly direction: 'up' | 'down' | 'none'
}

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a whole count of zero or more, received ${String(value)}. ` +
        'The odometer renders anonymity-set size, which cannot be fractional or negative.',
    )
  }
}

/**
 * What moves when the figure goes from `from` to `to`.
 *
 * FIRST PAINT IS `from === null`, and it produces no rolls at all. The I/O matrix requires the
 * figure to appear without animating on its first render — a number that rolls in from nothing on
 * mount reads as a value that just changed, which is a claim about history we do not have.
 *
 * AN EQUAL UPDATE ALSO PRODUCES NO ROLLS, which matters more than it looks: this figure is polled,
 * so most updates carry the same number, and an odometer that twitched on every poll would be
 * exactly the "animates on a poll" behaviour §7.5 rules out for the panel beside it.
 */
export function rollPlan(from: number | null, to: number): RollPlan {
  assertCount(to, 'the new value')
  if (from !== null) assertCount(from, 'the previous value')

  const target = String(to)
  const digits = target.split('')

  if (from === null || from === to) {
    return {
      digits: digits.map((char) => ({ char, rolling: false })),
      rolls: [],
      direction: 'none',
    }
  }

  // RIGHT-ALIGNED COMPARISON. 99 → 100 grows a column, and the old `9`s belong under the new `0`
  // and `0`, not under the leading `1`. Padding on the left keeps place value aligned; a naive
  // left-to-right compare would call every digit changed on any length change AND misreport which
  // old glyph each new one came from.
  const previous = String(from)
  const width = Math.max(previous.length, target.length)
  const paddedPrevious = previous.padStart(width, ' ')
  const paddedTarget = target.padStart(width, ' ')

  let commonPrefix = 0
  while (commonPrefix < width && paddedPrevious[commonPrefix] === paddedTarget[commonPrefix]) {
    commonPrefix += 1
  }

  // Back into the target's own indexing — the pad is a comparison device, not something rendered.
  const firstRollingIndex = Math.max(0, commonPrefix - (width - target.length))

  const rolls: DigitRoll[] = []
  for (let index = firstRollingIndex; index < digits.length; index += 1) {
    const previousIndex = index + (width - target.length) - (width - previous.length)
    const before =
      previousIndex >= 0 && previousIndex < previous.length ? previous[previousIndex]! : null
    // Inside the region, but landing on the same glyph it started from. Nothing to roll.
    if (before === digits[index]) continue
    rolls.push({ index, from: before, to: digits[index]!, step: rolls.length })
  }

  const moving = new Set(rolls.map((roll) => roll.index))
  return {
    digits: digits.map((char, index) => ({ char, rolling: moving.has(index) })),
    rolls,
    direction: to > from ? 'up' : 'down',
  }
}

/**
 * The caret delta, or `null` when there is nothing to show.
 *
 * `null` on a first paint and on any non-increase. DESIGN:421 authors only the rising form
 * (`▲ +3 since you opened this screen.`); a falling crowd has no authored sentence, and inventing
 * `▼ -3` would be authoring a privacy claim — a shrinking anonymity set is exactly the kind of
 * thing that needs a sentence someone decided on, not a mirrored glyph.
 */
export function caretDeltaOf(from: number | null, to: number): number | null {
  if (from === null) return null
  assertCount(from, 'the previous value')
  assertCount(to, 'the new value')
  return to > from ? to - from : null
}
