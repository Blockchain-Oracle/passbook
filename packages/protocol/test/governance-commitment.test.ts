//
// PROBE-2's TS half: H is derived rather than picked, the accumulator equation accepts exactly
// the sums the ballots committed, and the pinned cross-test vectors that hold this module and
// `contracts/src/governance.cairo` to the same curve points.
//
import { describe, expect, it } from 'vitest'

import {
  GOV_H,
  accAdd,
  accSub,
  commit,
  deriveH,
  mintBallotVector,
  verifyTally,
} from '../src/governance-commitment.js'

describe('H — the second generator', () => {
  it('is exactly what the tag derives — nothing up any sleeve', async () => {
    const derived = await deriveH()
    expect(derived.x).toBe(GOV_H.x)
    expect(derived.y).toBe(GOV_H.y)
  })
})

//
// THE CROSS-TEST VECTORS. The same weights, choices and blinds are constants in
// `contracts/tests/test_governance.cairo`, and both sides must land on these exact points — a
// drift in either curve implementation breaks one pin before it breaks a mainnet vote.
//
// Ballot A: weight 5, choice 1 of 2, blinds [7, 11]. Ballot B: weight 3, choice 0, blinds [13, 17].
//
const ACC0 = {
  x: 0x5d41c283b96aa148ccc67a7749150e7029e5a6981bc7a91970dc22363b74df2n,
  y: 0x74c51477e015d450e0f5cbacc9957d1bede532af27393f90f326c8ad59d3bf7n,
}
const ACC1 = {
  x: 0x42c9e42fd612e9f4d097180579578a82cdce9927b88ca88804de00db9c98052n,
  y: 0x510b72fc4bdc6efefb949c397b18199eebbb82f1f4b0dda344104248fbcf4e1n,
}

describe('the accumulator equation (§6.3)', () => {
  it('reproduces the pinned cross-test accumulators from the pinned ballots', () => {
    const a = [commit(0n, 7n), commit(5n, 11n)]
    const b = [commit(3n, 13n), commit(0n, 17n)]
    const acc0 = accAdd(a[0]!, b[0]!)
    const acc1 = accAdd(a[1]!, b[1]!)
    expect(acc0).toEqual(ACC0)
    expect(acc1).toEqual(ACC1)
  })

  it('accepts exactly the committed sums, and nothing shifted, invented or dropped', () => {
    const acc = [ACC0, ACC1]
    // S = [3, 5], R = [7+13, 11+17] = [20, 28], total weight 8.
    expect(verifyTally([3n, 5n], [20n, 28n], acc, 8n)).toBe(true)
    // A Teller moving one unit of weight between options has nothing it can publish…
    expect(verifyTally([4n, 4n], [20n, 28n], acc, 8n)).toBe(false)
    // …nor one inventing weight…
    expect(verifyTally([3n, 6n], [20n, 28n], acc, 9n)).toBe(false)
    // …nor one whose sums are right but whose conservation line is not.
    expect(verifyTally([3n, 5n], [20n, 28n], acc, 7n)).toBe(false)
  })

  it('replacement is subtraction: a re-vote leaves the accumulator as if the old ballot never was', () => {
    const first = commit(5n, 11n)
    const replacement = commit(5n, 23n)
    let acc = accAdd(null, first)
    acc = accSub(acc, first)
    expect(acc).toBeNull()
    acc = accAdd(acc, replacement)
    expect(verifyTally([5n], [23n], [acc], 5n)).toBe(true)
  })

  it('mints fresh vectors whose own tally verifies — the whole loop, random blinds', () => {
    const ballotA = mintBallotVector(5_000_000_000_000_000_000n, 1, 3)
    const ballotB = mintBallotVector(3_000_000_000_000_000_000n, 0, 3)
    const acc = ballotA.vector.map((point, i) => accAdd(point, ballotB.vector[i]!))
    const sums = [3_000_000_000_000_000_000n, 5_000_000_000_000_000_000n, 0n]
    const blindSums = ballotA.blinds.map((blind, i) => blind + ballotB.blinds[i]!)
    expect(verifyTally(sums, blindSums, acc, 8_000_000_000_000_000_000n)).toBe(true)
  })

  it('refuses the shapes a hostile client would mint', () => {
    expect(() => mintBallotVector(1n, 3, 3)).toThrow(/not one of/)
    expect(() => mintBallotVector(1n, 0, 1)).toThrow(/2–8 options/)
    expect(() => mintBallotVector(-1n, 0, 2)).toThrow(/negative/)
  })
})
