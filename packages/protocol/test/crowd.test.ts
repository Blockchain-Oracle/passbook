import { describe, it, expect } from 'vitest'
import { boundaryFor, percentileOf, MIN_QUARTILE_SAMPLE, QUARTILE } from '../src/crowd.js'

describe('percentileOf', () => {
  it('interpolates between neighbouring ranks', () => {
    expect(percentileOf([1, 2, 3, 4], 0)).toBe(1)
    expect(percentileOf([1, 2, 3, 4], 1)).toBe(4)
    expect(percentileOf([1, 2, 3, 4], 0.5)).toBe(2.5)
  })

  it('does not care what order the sample arrived in', () => {
    expect(percentileOf([4, 1, 3, 2], QUARTILE)).toBe(percentileOf([1, 2, 3, 4], QUARTILE))
  })

  it('has no value for an empty sample, and says so with null', () => {
    expect(percentileOf([], 0.5)).toBeNull()
  })

  it('refuses a proportion outside [0, 1]', () => {
    expect(() => percentileOf([1, 2], 1.5)).toThrow(/proportion/)
    expect(() => percentileOf([1, 2], -0.1)).toThrow(/proportion/)
    expect(() => percentileOf([1, 2], Number.NaN)).toThrow(/proportion/)
  })

  it('refuses a sample carrying something that is not a finite number', () => {
    // A percentile that absorbed a NaN returns a number, and the meter would render that number as
    // a measurement. Failing here is the only place it is still visible as a bug.
    expect(() => percentileOf([1, Number.NaN, 3], 0.5)).toThrow(/finite/)
    expect(() => percentileOf([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(/finite/)
  })
})

describe('boundaryFor', () => {
  it('is the first quartile of the sample it was given', () => {
    expect(boundaryFor([10, 20, 30, 40])).toBe(percentileOf([10, 20, 30, 40], QUARTILE))
  })

  it('MOVES when the distribution moves — the property no constant can have', () => {
    // This is the behavioural half of the FR-052 guard. `no-tier-constant.test.ts` owns the source
    // half; between them, a hardcoded threshold has nowhere to hide.
    const low = boundaryFor([1, 2, 3, 4])
    const high = boundaryFor([100, 200, 300, 400])
    expect(low).not.toBe(high)
    expect(high! > low!).toBe(true)
  })

  it('refuses a sample too small to have a first quarter, and null is not zero', () => {
    // A boundary of zero would put EVERY count above it and report every crowd healthy — the
    // stale-claim failure inverted, and silent. So the refusal has to be distinguishable.
    for (let size = 0; size < MIN_QUARTILE_SAMPLE; size += 1) {
      expect(boundaryFor(Array.from({ length: size }, (_, i) => i + 1))).toBeNull()
    }
    expect(boundaryFor([1, 2, 3, 4])).not.toBeNull()
  })
})
