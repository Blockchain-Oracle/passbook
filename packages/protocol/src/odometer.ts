//
// The anonymity-set caret, as data. A leaf that imports nothing.
//

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a whole count of zero or more, received ${String(value)}. ` +
        'The odometer renders anonymity-set size, which cannot be fractional or negative.',
    )
  }
}

/**
 * The caret delta, or `null` when there is nothing to show.
 *
 * `null` on a first paint and on any non-increase: only the rising form is authored, and a
 * shrinking anonymity set needs a sentence someone decided on, not a mirrored glyph.
 */
export function caretDeltaOf(from: number | null, to: number): number | null {
  if (from === null) return null
  assertCount(from, 'the previous value')
  assertCount(to, 'the new value')
  return to > from ? to - from : null
}
