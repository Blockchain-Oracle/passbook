import { describe, it, expect } from 'vitest'
import { rollPlan, caretDeltaOf } from '../src/odometer.js'

//
// The digit machine. These tests exist because the canon contradicts itself about which digits
// move (DESIGN:242 vs EXPERIENCE:138) and one reading is vacuous — see the module header. The
// resolution is pinned here so a future edit toward the other reading fails loudly.
//

const chars = (plan: ReturnType<typeof rollPlan>) => plan.digits.map((d) => d.char).join('')
const moving = (plan: ReturnType<typeof rollPlan>) => plan.rolls.map((r) => r.index)

describe('the figure always renders in full', () => {
  it('paints every digit on a first paint, and moves none of them', () => {
    const plan = rollPlan(null, 26)
    expect(chars(plan)).toBe('26')
    expect(plan.rolls).toEqual([])
    expect(plan.direction).toBe('none')
    expect(plan.digits.every((d) => !d.rolling)).toBe(true)
  })

  it('paints every digit on an equal update, and moves none of them', () => {
    // This figure is POLLED, so most updates carry the same number. An odometer that twitched on
    // every poll is the "animates on a poll" behaviour §7.5 rules out for the panel beside it.
    const plan = rollPlan(26, 26)
    expect(chars(plan)).toBe('26')
    expect(plan.rolls).toEqual([])
    expect(plan.direction).toBe('none')
  })
})

describe('only the changed suffix moves', () => {
  it('23 to 26 rolls the six and holds the two', () => {
    // The matrix row, and the case DESIGN:242 read literally would animate NOTHING at all.
    const plan = rollPlan(23, 26)
    expect(chars(plan)).toBe('26')
    expect(moving(plan)).toEqual([1])
    expect(plan.digits[0]!.rolling).toBe(false)
    expect(plan.digits[1]!.rolling).toBe(true)
    expect(plan.rolls[0]).toEqual({ index: 1, from: '3', to: '6', step: 0 })
    expect(plan.direction).toBe('up')
  })

  it('holds a digit that is inside the changed region but lands on itself', () => {
    // 123 -> 173: the trailing 3 is after the common prefix, and spinning it from three to three
    // would be motion standing for a change that did not happen.
    const plan = rollPlan(123, 173)
    expect(moving(plan)).toEqual([1])
    expect(plan.rolls[0]!.from).toBe('2')
    expect(plan.rolls[0]!.to).toBe('7')
  })

  it('does not drag the leading digits along', () => {
    const plan = rollPlan(1023, 1073)
    expect(moving(plan)).toEqual([2])
    expect(plan.digits.slice(0, 2).every((d) => !d.rolling)).toBe(true)
  })

  it('staggers by ordinal, starting at zero for the leftmost mover', () => {
    // `step` is an ORDINAL, not a delay. The milliseconds live in tokens.yaml and the stylesheet,
    // where the sixth build verdict can resolve one against the other.
    const plan = rollPlan(1111, 2222)
    expect(plan.rolls.map((r) => r.step)).toEqual([0, 1, 2, 3])
  })
})

describe('place value survives a change of width', () => {
  it('99 to 100 lines the old nines up under the new zeros, not under the leading one', () => {
    // A naive left-to-right compare reports the wrong ORIGIN for every glyph here: it would say
    // the leading `1` came from a `9`. The comparison is right-aligned for that reason.
    const plan = rollPlan(99, 100)
    expect(chars(plan)).toBe('100')
    expect(moving(plan)).toEqual([0, 1, 2])
    expect(plan.rolls[0]).toEqual({ index: 0, from: null, to: '1', step: 0 })
    expect(plan.rolls[1]!.from).toBe('9')
    expect(plan.rolls[2]!.from).toBe('9')
    expect(plan.direction).toBe('up')
  })

  it('100 to 99 loses a column and rolls down', () => {
    const plan = rollPlan(100, 99)
    expect(chars(plan)).toBe('99')
    expect(plan.direction).toBe('down')
    expect(moving(plan)).toEqual([0, 1])
  })
})

describe('the caret states only what DESIGN:421 authored', () => {
  it('reports the rise', () => {
    expect(caretDeltaOf(23, 26)).toBe(3)
  })

  it('says nothing on a first paint', () => {
    expect(caretDeltaOf(null, 26)).toBeNull()
  })

  it('says nothing when the crowd holds or shrinks', () => {
    // A FALLING crowd has no authored sentence. Mirroring the glyph into `▼ -3` would be authoring
    // a privacy claim — a shrinking anonymity set needs a sentence someone decided on.
    expect(caretDeltaOf(26, 26)).toBeNull()
    expect(caretDeltaOf(26, 23)).toBeNull()
  })
})

describe('a count that cannot be a count is refused', () => {
  it('rejects fractions and negatives on either side', () => {
    expect(() => rollPlan(null, -1)).toThrow(/whole count/)
    expect(() => rollPlan(null, 2.5)).toThrow(/whole count/)
    expect(() => rollPlan(-1, 5)).toThrow(/whole count/)
    expect(() => caretDeltaOf(2.5, 5)).toThrow(/whole count/)
  })
})
