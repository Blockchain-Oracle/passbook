//
// What the meter READ, and the boundary derived from it (story 6.7b, FR-052, EPICS:709).
//
// ── A LEAF THAT IMPORTS NOTHING ───────────────────────────────────────────────────────────
//
// Same discipline as `privacy.ts` and `degraded.ts`. A component asking "how big is the crowd I am
// hiding in?" must not pull a chain client into the browser to find out, and `pool-events.ts` —
// the thing that will eventually produce these numbers — imports `starknet` at its first line.
// So a reading ARRIVES here as data and this module never reaches for a reader.
//
// ── WHY THE BOUNDARY IS A FUNCTION AND NOT A NUMBER ───────────────────────────────────────
//
// The planning documents specify tier thresholds only as a prohibition: "derived from the live
// distribution at build time, never authored as constants". Those two halves contradict each
// other. Anything derived at build time IS a constant by the time it ships, FR-052 bans hardcoded
// counts, and EPICS:709 specifies a test that "asserts no hardcoded tier constant" — which a
// build-time-baked number is exactly what would fail.
//
// The reconciliation is to make the boundary a FUNCTION of a sample rather than a value someone
// wrote down. `distribution` travels inside the reading, so a tier can never be computed against a
// number that did not arrive with the count it is judging. There is nothing to hardcode and nothing
// to go stale, and the day AD-14's cached stats endpoint lands the meter becomes live with no code
// change here — only a real `distribution` where a fixture used to be.
//
// ── THE ONLY NUMBERS IN THIS FILE ARE THE DEFINITION OF A QUARTILE ────────────────────────
//
// `QUARTILE` and `MIN_QUARTILE_SAMPLE` are arithmetic, not policy. Neither says anything about how
// much anonymity is enough — they say what a first quartile IS and when one can be computed. The
// guard in `no-tier-constant.test.ts` proves the distinction the way that matters: it feeds two
// different distributions and requires two different boundaries, which no constant can satisfy.
//

/**
 * A crowd reading, as a closed union with no third state.
 *
 * WHY `unmeasurable` CARRIES NO COUNT. It would be trivial to model a failed read as
 * `candidates: 0` and let the tier logic warn loudly about it. That is precisely the invented
 * privacy claim FR-051 bans: zero candidates means "you are alone", which is a measurement, and a
 * failed read has not measured anything. The union makes the wrong thing unspellable — there is no
 * `candidates` field to reach for on this arm.
 *
 * WHY `distribution` LIVES ON THE READING and not beside it. It is the sample the boundary comes
 * from. Passing it separately would allow a caller to judge today's count against last week's
 * sample, which is the stale-claim failure wearing a different face.
 */
export type CrowdReading =
  | {
      readonly state: 'measured'
      /** Exact, never rounded. `26 addresses`, never `~25` — the meter's whole grammar. */
      readonly candidates: number
      /** The denominator's window, as words: `the last 24 hours`. */
      readonly window: string
      /** AD-14: every live read is block-stamped, and the stamp is rendered, not just recorded. */
      readonly blockNumber: number
      /** `null` when the largest-ever aggregate was not part of this read — not zero. */
      readonly largestEverWei: bigint | null
      /** The sample the boundary is derived FROM. Travels with the count it judges. */
      readonly distribution: readonly number[]
    }
  | {
      readonly state: 'unmeasurable'
      /** A sourced sentence. The meter renders this instead of a count, never alongside one. */
      readonly because: string
    }

/**
 * The first quartile, as a proportion. This is the DEFINITION of "first quarter", not a threshold.
 */
export const QUARTILE = 0.25

/**
 * The smallest sample a first quartile can honestly be taken from.
 *
 * A quartile divides a sample into four parts. With fewer than four observations there is no first
 * quarter to speak of — the returned value would be an interpolation between the two smallest
 * points wearing the name of a distribution statistic. Refusing is the honest answer, and it is why
 * `boundaryFor` returns `null` rather than falling back to the minimum.
 */
export const MIN_QUARTILE_SAMPLE = 4

/**
 * The value at proportion `p` through a sample, interpolating between neighbouring ranks.
 *
 * `null` for an empty sample — there is no value in nothing. THROWS on a `p` outside `[0, 1]` or on
 * a sample carrying something that is not a finite number, because both are bugs in the caller
 * rather than facts about the crowd, and a percentile that silently absorbed a `NaN` would return a
 * number the meter would then present as a measurement.
 */
export function percentileOf(sample: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`percentile must be a proportion in [0, 1], received ${String(p)}`)
  }
  if (sample.length === 0) return null

  const sorted = [...sample].sort((a, b) => a - b)
  for (const value of sorted) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `a crowd distribution may only contain finite numbers, received ${String(value)}. ` +
          'A percentile taken over a non-number returns a value the meter would render as a measurement.',
      )
    }
  }

  const rank = p * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]!
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low)
}

/**
 * The boundary below which a crowd counts as small — the first quartile of the sample that arrived
 * with the reading.
 *
 * `null` when the sample cannot support a quartile. **`null` is not zero**, and callers must not
 * treat it as one: a boundary of zero would place every possible count above it and quietly report
 * every crowd as healthy, which is the stale-claim failure inverted. The tier logic reads `null` as
 * "no boundary, therefore no tier", which is the same answer it gives an unmeasurable read.
 */
export function boundaryFor(distribution: readonly number[]): number | null {
  if (distribution.length < MIN_QUARTILE_SAMPLE) return null
  return percentileOf(distribution, QUARTILE)
}
