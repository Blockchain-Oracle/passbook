import { describe, it, expect } from 'vitest'

import {
  LAUNCH_OP,
  buyPayload,
  expectedOpenNotes,
  redeemPayload,
  refundPayload,
} from '../src/launch-calldata.js'

//
// The client half of `contracts/tests/test_launch.cairo`. Same job as `market-calldata.test.ts`:
// pin the payload shape from the TypeScript end so the two implementations cannot drift apart
// anywhere except in a place that fails in Node.
//

const felts = (r: ReturnType<typeof buyPayload>): readonly string[] => {
  if (r.state !== 'ready') throw new Error(`expected ready, got refused: ${r.because}`)
  return r.calldata
}

const because = (r: { state: string; because?: string }): string => {
  if (r.state !== 'refused') throw new Error('expected a refusal')
  return r.because!
}

describe('the op codes are the contract’s', () => {
  it('matches launch.cairo', () => {
    expect(LAUNCH_OP).toEqual({ buy: 1, redeem: 2, refund: 3 })
  })
})

describe('buying units', () => {
  it('serialises one purchase as [1, launch, units, commitment]', () => {
    const out = felts(buyPayload([{ launchId: 0, units: 4, commitment: '0xabc' }]))
    expect(out).toEqual(['0x1', '0x4', '0x1', '0x0', '0x4', '0xabc'])
  })

  it('serialises a batch of two', () => {
    const out = felts(
      buyPayload([
        { launchId: 0, units: 2, commitment: '0xa1' },
        { launchId: 0, units: 4, commitment: '0xa2' },
      ]),
    )
    expect(out).toEqual(['0x1', '0x7', '0x2', '0x0', '0x2', '0xa1', '0x0', '0x4', '0xa2'])
  })

  // An epoch holds exactly sixteen units and the contract has no notion of a fractional one. A
  // surface can round before anyone pays to learn that.
  it('refuses a fractional unit count', () => {
    expect(because(buyPayload([{ launchId: 0, units: 2.5, commitment: '0x1' }]))).toMatch(
      /do not divide/i,
    )
  })

  it('refuses a purchase of nothing', () => {
    expect(because(buyPayload([{ launchId: 0, units: 0, commitment: '0x1' }]))).toMatch(/buys nothing/i)
  })

  it('refuses two purchases sharing a commitment', () => {
    const r = buyPayload([
      { launchId: 0, units: 1, commitment: '0xd0d0' },
      { launchId: 0, units: 1, commitment: '0xd0d0' },
    ])
    expect(because(r)).toMatch(/share a commitment/i)
  })
})

describe('redeeming and refunding share the claim layout', () => {
  it('serialises a redemption batch', () => {
    const out = felts(
      redeemPayload([
        '0x51',
        '0x52',
      ]),
    )
    expect(out).toEqual(['0x2', '0x5', '0x2', '0x51', '0x0', '0x52', '0x0'])
  })

  it('serialises a refund batch under its own op', () => {
    const out = felts(refundPayload(['0x51']))
    expect(out).toEqual(['0x3', '0x3', '0x1', '0x51', '0x0'])
  })

  // Inherited from the shared serialiser, and asserted here too rather than assumed: a repeated
  // secret meets a position the contract already closed inside its own loop, which reverts the
  // whole batch — every other settlement in it included.
  it('refuses a repeated secret on both ops', () => {
    expect(because(redeemPayload(['0x5', '0x5']))).toMatch(/already being settled/i)
    expect(because(refundPayload(['0x7', '0x7']))).toMatch(/already being settled/i)
  })

  it('reserves one note slot per entry on both ops', () => {
    for (const build of [redeemPayload, refundPayload]) {
      const r = build(['0x51', '0x52'])
      if (r.state !== 'ready') throw new Error('expected ready')
      expect(r.noteIdSlots).toEqual([4, 6])
    }
  })
})

describe('the open-note count the pool cannot check', () => {
  it('is zero for a buy, which only sends money in', () => {
    expect(expectedOpenNotes(LAUNCH_OP.buy, 3)).toBe(0)
  })

  it('is one per entry for redemptions and refunds', () => {
    expect(expectedOpenNotes(LAUNCH_OP.redeem, 4)).toBe(4)
    expect(expectedOpenNotes(LAUNCH_OP.refund, 2)).toBe(2)
  })
})
