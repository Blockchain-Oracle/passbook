import { describe, it, expect } from 'vitest'

import { MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS, parseSlippage } from '../src/quote.js'

//
// The typed slippage field decides what tolerance reaches a real swap, so every branch here is a
// number somebody's money executes against. The governing rule is that it REFUSES rather than
// clamps: a silently clamped value means the screen and the transaction disagree.
//

const bps = (input: string) => {
  const r = parseSlippage(input)
  if ('problem' in r) throw new Error(`expected a value, got: ${r.problem}`)
  return r.bps
}

const problem = (input: string) => {
  const r = parseSlippage(input)
  if (!('problem' in r)) throw new Error(`expected a refusal, got ${r.bps}`)
  return r.problem
}

describe('parsing a typed percentage', () => {
  it('reads the presets back as themselves', () => {
    expect(bps('0.1')).toBe(10)
    expect(bps('0.5')).toBe(50)
    expect(bps('1')).toBe(100)
  })

  it('accepts a trailing percent sign, because people type one', () => {
    expect(bps('0.5%')).toBe(50)
    expect(bps(' 0.5 % ')).toBe(50)
  })

  it('accepts the bounds exactly', () => {
    expect(bps('0.01')).toBe(MIN_SLIPPAGE_BPS)
    expect(bps('50')).toBe(MAX_SLIPPAGE_BPS)
  })
})

describe('refusing rather than clamping', () => {
  // The whole point. A clamped 80% would execute at 50% while the field said 80.
  it('refuses above the ceiling instead of quietly lowering it', () => {
    expect(problem('80')).toMatch(/typo/)
    expect(problem('100')).toMatch(/typo/)
  })

  // "0.001%" is half a basis point. Rounding it to zero would mean "no slippage at all" — a swap
  // that can only ever revert — which is not what anyone typing a small number intends.
  it('refuses a value that would round away to nothing', () => {
    expect(problem('0.001')).toMatch(/smallest step/)
    expect(problem('0')).toMatch(/smallest step/)
  })

  it('refuses text, signs and anything that is not a number', () => {
    expect(problem('abc')).toMatch(/not a percentage/)
    expect(problem('-1')).toMatch(/not a percentage/)
    expect(problem('1e3')).toMatch(/not a percentage/)
    expect(problem('')).toMatch(/Enter a percentage/)
  })
})

describe('rounding', () => {
  // Rounds to NEAREST, never up: rounding up hands back a looser tolerance than the one typed.
  it('rounds to the nearest basis point', () => {
    expect(bps('0.114')).toBe(11)
    expect(bps('0.116')).toBe(12)
  })
})
