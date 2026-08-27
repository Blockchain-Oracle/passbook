import { describe, it, expect } from 'vitest'

import { MAX_RESOURCE_BOUNDS_WEI, assertResourceBounds } from '../src/allowlist.js'

//
// Resource bounds are CEILINGS the relayer's wallet agrees to pay up to, which makes them spending
// authority in exactly the sense the allowlist is — a caller free to name an unbounded one could
// drain this key through gas without ever touching a call the allowlist inspects.
//
// They exist at all because `Account.execute` forwards the proof only to the broadcast, never to
// the fee estimate: without bounds, the estimate simulates the transaction unproven, `apply_actions`
// reverts, and nothing is ever signed. That is why the relayer could not submit a single
// value-moving pool transaction before this field.
//

const lane = (amount: bigint, price: bigint) => ({ max_amount: amount, max_price_per_unit: price })

/** The bounds that actually landed transactions on mainnet. Worst case ≈ 9.4 STRK. */
const REAL = {
  l2_gas: lane(150_000_000n, 50_000_000_000n),
  l1_gas: lane(10_000n, 200_000_000_000_000n),
  l1_data_gas: lane(50_000n, 300_000_000_000n),
}

describe('the bounds that worked on mainnet', () => {
  it('are accepted, and come back as bigints', () => {
    const out = assertResourceBounds(REAL)
    // BIGINTS, not hex — starknet.js's ResourceBoundsBN is what `execute` consumes, and a hex
    // string throws inside transaction-hash construction before signing.
    expect(typeof out.l2_gas.max_amount).toBe('bigint')
    expect(out.l2_gas.max_amount).toBe(150_000_000n)
    expect(out.l1_data_gas.max_price_per_unit).toBe(300_000_000_000n)
  })

  it('accepts felt strings too, because that is what crosses a JSON wire', () => {
    const out = assertResourceBounds({
      l2_gas: { max_amount: '0x8f0d180', max_price_per_unit: '50000000000' },
      l1_gas: { max_amount: '0x2710', max_price_per_unit: '200000000000000' },
      l1_data_gas: { max_amount: '0xc350', max_price_per_unit: '300000000000' },
    })
    expect(out.l2_gas.max_amount).toBe(0x8f0d180n)
    expect(out.l2_gas.max_price_per_unit).toBe(50_000_000_000n)
  })
})

describe('the worst-case cap', () => {
  // The whole point of the field being validated rather than passed through.
  it('refuses bounds whose product exceeds the ceiling', () => {
    expect(() =>
      assertResourceBounds({
        l2_gas: lane(1_000_000_000n, 1_000_000_000_000n), // 1e21 wei on its own
        l1_gas: lane(0n, 0n),
        l1_data_gas: lane(0n, 0n),
      }),
    ).toThrow(/worst case/)
  })

  it('sums ACROSS lanes rather than checking each alone', () => {
    // Each lane is comfortably under the cap; together they are over it. Checking lanes
    // individually would wave this through.
    const third = MAX_RESOURCE_BOUNDS_WEI / 3n
    expect(() =>
      assertResourceBounds({
        l2_gas: lane(third, 1n),
        l1_gas: lane(third, 1n),
        l1_data_gas: lane(third, 1n),
      }),
    ).not.toThrow()
    expect(() =>
      assertResourceBounds({
        l2_gas: lane(MAX_RESOURCE_BOUNDS_WEI, 1n),
        l1_gas: lane(1n, 1n),
        l1_data_gas: lane(1n, 1n),
      }),
    ).toThrow(/worst case/)
  })

  // Raising the number to clear the error removes the only thing bounding it — the same sentence
  // the approve ceiling carries, for the same reason.
  it('says so in the refusal', () => {
    expect(() =>
      assertResourceBounds({
        l2_gas: lane(1_000_000_000_000n, 1_000_000_000_000n),
        l1_gas: lane(0n, 0n),
        l1_data_gas: lane(0n, 0n),
      }),
    ).toThrow(/removes the only thing bounding it/)
  })
})

describe('shape before value, like every other check here', () => {
  it('refuses a missing lane rather than defaulting it to zero', () => {
    expect(() => assertResourceBounds({ l2_gas: lane(1n, 1n), l1_gas: lane(1n, 1n) })).toThrow(
      /l1_data_gas is missing/,
    )
  })

  it('refuses anything that is not an object', () => {
    for (const junk of [null, undefined, 'bounds', 42, []]) {
      expect(() => assertResourceBounds(junk)).toThrow()
    }
  })

  it('refuses a value that is not a number', () => {
    expect(() =>
      assertResourceBounds({
        l2_gas: { max_amount: 'lots', max_price_per_unit: 1n },
        l1_gas: lane(1n, 1n),
        l1_data_gas: lane(1n, 1n),
      }),
    ).toThrow(/not a number/)
  })

  // `BigInt(['0x1'])` is 1n — an array that stringifies to a number would otherwise be signed as
  // one, which is the same coercion trap `assertProofFacts` guards against.
  it('refuses an array that would coerce to a number', () => {
    expect(() =>
      assertResourceBounds({
        l2_gas: { max_amount: ['0x1'], max_price_per_unit: 1n },
        l1_gas: lane(1n, 1n),
        l1_data_gas: lane(1n, 1n),
      }),
    ).toThrow(/not a number/)
  })
})
