import { describe, it, expect } from 'vitest'
import type { Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import {
  assertSubmittable,
  needsApproveCeiling,
  approveCeiling,
  MAX_CALLS_PER_SUBMISSION,
  APPROVE_FEE_MULTIPLE,
  ABSOLUTE_MAX_APPROVE_WEI,
} from '../src/allowlist.js'

const MESSAGE_BOOK = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const ATTACKER = '0x0dead0000000000000000000000000000000000000000000000000000000beef'

// A 6 STRK fee with the multiple applied, as the server derives it from the live read.
const FEE_WEI = 6_000_000_000_000_000_000n
const POLICY = { maxApproveWei: FEE_WEI * APPROVE_FEE_MULTIPLE }
const toHex = (n: bigint) => `0x${n.toString(16)}`

const applyActions: Call = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const approvePool: Call = {
  contractAddress: STRK_TOKEN,
  entrypoint: 'approve',
  calldata: [NET.pool, toHex(FEE_WEI), '0x0'],
}

describe('submission allowlist', () => {
  it('permits the real submission shape: approve the pool, then apply_actions', () => {
    expect(() => assertSubmittable([approvePool, applyActions], POLICY)).not.toThrow()
  })

  // The exploit this allowlist exists to stop: one call, whole balance gone.
  it('refuses STRK.transfer outright', () => {
    const drain: Call = {
      contractAddress: STRK_TOKEN,
      entrypoint: 'transfer',
      calldata: [ATTACKER, '0xffffffffffffffff', '0x0'],
    }
    expect(() => assertSubmittable([drain])).toThrow(/not an allowlisted call/)
  })

  // The same drain with one extra step.
  it('refuses an approve whose spender is not the pool', () => {
    const sneaky: Call = {
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: [ATTACKER, '0xffffffffffffffff', '0x0'],
    }
    expect(() => assertSubmittable([sneaky], POLICY)).toThrow(/only permitted spender/)
  })

  it('refuses an approve whose calldata cannot be inspected positionally', () => {
    const opaque = {
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: { spender: ATTACKER, amount: 1 },
    } as unknown as Call
    expect(() => assertSubmittable([opaque], POLICY)).toThrow(/not an array this server can inspect/)
  })

  it('refuses a non-submission entrypoint on the pool itself', () => {
    const wrong: Call = { contractAddress: NET.pool, entrypoint: 'upgrade', calldata: [] }
    expect(() => assertSubmittable([wrong])).toThrow(/not an allowlisted call/)
  })

  it('refuses a contract that is not on the list at all', () => {
    const stranger: Call = { contractAddress: ATTACKER, entrypoint: 'apply_actions', calldata: [] }
    expect(() => assertSubmittable([stranger])).toThrow(/not an allowlisted call/)
  })

  it('refuses an implausibly large batch', () => {
    const many = Array.from({ length: MAX_CALLS_PER_SUBMISSION + 1 }, () => applyActions)
    expect(() => assertSubmittable(many)).toThrow(/limit is/)
  })

  it('refuses one bad call hidden among good ones', () => {
    const drain: Call = {
      contractAddress: STRK_TOKEN,
      entrypoint: 'transfer',
      calldata: [ATTACKER, '0x1', '0x0'],
    }
    expect(() => assertSubmittable([approvePool, drain, applyActions], POLICY)).toThrow(/not an allowlisted/)
  })

  // Felts have no canonical padding, so an address check that compared strings would
  // reject this legitimate call — and would be the wrong kind of check besides.
  it('matches addresses numerically, not by string form', () => {
    const unpadded: Call = {
      contractAddress: NET.pool.replace(/^0x0+/, '0x'),
      entrypoint: 'apply_actions',
      calldata: [],
    }
    expect(unpadded.contractAddress).not.toBe(NET.pool) // genuinely a different string
    expect(() => assertSubmittable([unpadded])).not.toThrow()
  })

  // The security direction of the same property: an odd form of the STRK address must
  // still land on the transfer refusal rather than slipping past as "some other token".
  it('still refuses transfer when the STRK address is written unpadded', () => {
    const drain: Call = {
      contractAddress: STRK_TOKEN.replace(/^0x0+/, '0x'),
      entrypoint: 'transfer',
      calldata: [ATTACKER, '0x1', '0x0'],
    }
    expect(drain.contractAddress).not.toBe(STRK_TOKEN)
    expect(() => assertSubmittable([drain], POLICY)).toThrow(/not an allowlisted call/)
  })

  // BigInt() parses plenty of things that are not addresses. If the allowlist inspects
  // one shape and __execute__ compiles another, the gate is checking the wrong object —
  // today saved only by the payload being garbage, which is not a control.
  describe('validates address shape before value', () => {
    it.each([
      ['an array that stringifies to the pool', [NET.pool]],
      ['a whitespace-padded address', `  ${NET.pool}  `],
      ['a number', 1234],
      ['null', null],
      ['an object', { toString: () => NET.pool }],
    ])('refuses contractAddress given as %s', (_label, value) => {
      const call = { contractAddress: value, entrypoint: 'apply_actions', calldata: [] } as unknown as Call
      expect(() => assertSubmittable([call], POLICY)).toThrow(/not a felt address/)
    })

    it('refuses an approve spender that is not a felt address', () => {
      const call = {
        contractAddress: STRK_TOKEN,
        entrypoint: 'approve',
        calldata: [[NET.pool], '0x1', '0x0'],
      } as unknown as Call
      expect(() => assertSubmittable([call], POLICY)).toThrow(/not a felt address/)
    })

    // Not an attack shape — it is what starknet.js emits. CallData.compile returns
    // decimal felts, so a hex-only check would refuse every real compiled submission.
    it('accepts the decimal felts CallData.compile actually produces', () => {
      const decimalPool = BigInt(NET.pool).toString()
      expect(decimalPool).toMatch(/^[0-9]+$/)
      const call = {
        contractAddress: decimalPool,
        entrypoint: 'apply_actions',
        calldata: [],
      } as Call
      expect(() => assertSubmittable([call], POLICY)).not.toThrow()
    })

    it('accepts an approve whose spender and amount are decimal felts', () => {
      const call = {
        contractAddress: BigInt(STRK_TOKEN).toString(),
        entrypoint: 'approve',
        calldata: [BigInt(NET.pool).toString(), FEE_WEI.toString(), '0'],
      } as Call
      expect(() => assertSubmittable([call], POLICY)).not.toThrow()
    })

    // The formatter must not become the failure it is reporting on.
    it('describes a bigint in a refusal rather than throwing on it', () => {
      const call = {
        contractAddress: NET.pool,
        entrypoint: 'apply_actions',
        calldata: [],
      } as Call
      const withBigint = { ...call, contractAddress: 6_000_000_000_000_000_000n } as unknown as Call
      // JSON.stringify raises TypeError on a bigint; this must still be a clean refusal.
      expect(() => assertSubmittable([withBigint], POLICY)).toThrow(/not a felt address/)
      expect(() => assertSubmittable([withBigint], POLICY)).not.toThrow(TypeError)
    })

    it('refuses a non-string entrypoint', () => {
      const call = { contractAddress: NET.pool, entrypoint: 42, calldata: [] } as unknown as Call
      expect(() => assertSubmittable([call], POLICY)).toThrow(/entrypoint is not a string/)
    })
  })

  // The finding that changes the blast radius: approve(pool, MAX_U256) is two entirely
  // allowlisted calls, and turns "one submission" into "the balance".
  // Which batches need a live fee read. Fails closed both ways: a malformed address is
  // false here and refused on shape, and reaching the approve check without a ceiling
  // is refused for having no bound.
  describe('needsApproveCeiling', () => {
    it('is false for a batch with no approve in it', () => {
      expect(needsApproveCeiling([applyActions])).toBe(false)
    })

    it('is true when the batch contains a STRK approve', () => {
      expect(needsApproveCeiling([approvePool, applyActions])).toBe(true)
    })

    it('is true regardless of how the STRK address is padded', () => {
      const unpadded = { ...approvePool, contractAddress: STRK_TOKEN.replace(/^0x0+/, '0x') }
      expect(needsApproveCeiling([unpadded])).toBe(true)
    })

    it('is false for STRK.transfer, which is refused without needing a ceiling', () => {
      const drain: Call = {
        contractAddress: STRK_TOKEN,
        entrypoint: 'transfer',
        calldata: [ATTACKER, '0x1', '0x0'],
      }
      expect(needsApproveCeiling([drain])).toBe(false)
    })

    it('does not throw on malformed input — shape validation is assertSubmittable\'s job', () => {
      const junk = [{ contractAddress: null, entrypoint: 'approve' }] as unknown as Call[]
      expect(() => needsApproveCeiling(junk)).not.toThrow()
      expect(needsApproveCeiling(junk)).toBe(false)
    })
  })

  // The most expensive bug found in review: the ceiling was per-call, and a batch holds
  // eight. Because approve SETS the allowance, re-arming it between pulls multiplies the
  // fee inside one signed transaction while every individual call stays under the limit.
  describe('refuses batch amplification', () => {
    it('refuses the 4x amplification batch, every call of which is individually legal', () => {
      const batch: Call[] = [
        approvePool,
        applyActions,
        approvePool,
        applyActions,
        approvePool,
        applyActions,
        approvePool,
        applyActions,
      ]
      expect(batch).toHaveLength(MAX_CALLS_PER_SUBMISSION) // within the batch cap
      // Each approve on its own is under the ceiling — that is exactly why this worked.
      expect(() => assertSubmittable([approvePool, applyActions], POLICY)).not.toThrow()
      expect(() => assertSubmittable(batch, POLICY)).toThrow(/batch with 4 approves/)
    })

    it('refuses even two approves', () => {
      expect(() => assertSubmittable([approvePool, approvePool], POLICY)).toThrow(
        /batch with 2 approves/,
      )
    })

    it('still permits the one legitimate shape', () => {
      expect(() => assertSubmittable([approvePool, applyActions], POLICY)).not.toThrow()
    })

    it('counts approves regardless of how the STRK address is written', () => {
      const unpadded = { ...approvePool, contractAddress: STRK_TOKEN.replace(/^0x0+/, '0x') }
      const decimal = { ...approvePool, contractAddress: BigInt(STRK_TOKEN).toString() }
      expect(() => assertSubmittable([approvePool, unpadded], POLICY)).toThrow(/2 approves/)
      expect(() => assertSubmittable([unpadded, decimal], POLICY)).toThrow(/2 approves/)
    })
  })

  // The multiple bounds us to twice the live fee, but that fee is set by a pool admin
  // outside this repo at zero delay — so without a second bound the ceiling is "twice
  // whatever a third party says", which is not a bound.
  describe('caps the ceiling independently of the live fee', () => {
    it('uses the fee-derived bound while it is the smaller one', () => {
      expect(approveCeiling(FEE_WEI)).toBe(FEE_WEI * APPROVE_FEE_MULTIPLE)
    })

    it('stops following the fee once the absolute cap binds', () => {
      // A pool admin raising the fee 1000x must not raise our exposure with it.
      expect(approveCeiling(FEE_WEI * 1000n)).toBe(ABSOLUTE_MAX_APPROVE_WEI)
    })

    it('is pinned at 60 STRK — ten times the measured fee', () => {
      expect(ABSOLUTE_MAX_APPROVE_WEI).toBe(60_000_000_000_000_000_000n)
    })

    it('crosses over exactly where the two bounds meet', () => {
      const crossover = ABSOLUTE_MAX_APPROVE_WEI / APPROVE_FEE_MULTIPLE
      expect(approveCeiling(crossover)).toBe(ABSOLUTE_MAX_APPROVE_WEI)
      expect(approveCeiling(crossover - 1n)).toBe((crossover - 1n) * APPROVE_FEE_MULTIPLE)
    })
  })

  describe('bounds the approve amount', () => {
    // The other ceiling tests derive from this constant, so they cannot catch it being
    // wrong. This one pins the value, because the multiple IS the blast radius: 1x is
    // what collect_fee actually pulls, and the headroom exists only for the pool's
    // zero-delay fee mutability, sized against the largest observed change (4 -> 6 STRK,
    // 1.5x). Widening this grants standing spend authority against a funded wallet.
    it('is pinned at 2x the live fee', () => {
      expect(APPROVE_FEE_MULTIPLE).toBe(2n)
    })

    const approveOf = (low: string, high = '0x0'): Call => ({
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: [NET.pool, low, high],
    })

    it('refuses an unbounded approve to the pool', () => {
      const maxU128 = toHex((1n << 128n) - 1n)
      expect(() => assertSubmittable([approveOf(maxU128, maxU128)], POLICY)).toThrow(
        /above the .* ceiling/,
      )
    })

    it('refuses an approve just over the ceiling', () => {
      expect(() => assertSubmittable([approveOf(toHex(FEE_WEI * APPROVE_FEE_MULTIPLE + 1n))], POLICY)).toThrow(
        /above the .* ceiling/,
      )
    })

    it('permits an approve exactly at the ceiling', () => {
      expect(() => assertSubmittable([approveOf(toHex(FEE_WEI * APPROVE_FEE_MULTIPLE))], POLICY)).not.toThrow()
    })

    it('counts the high limb, so a u256 cannot smuggle the amount past the check', () => {
      expect(() => assertSubmittable([approveOf('0x0', '0x1')], POLICY)).toThrow(
        /above the .* ceiling/,
      )
    })

    // Fail closed: no fee read means no ceiling, and an unbounded approve is the wallet.
    it('refuses any approve when the ceiling is unknown', () => {
      expect(() => assertSubmittable([approvePool], {})).toThrow(/no bound to check it against/)
    })

    it.each([
      ['too few felts', [NET.pool, '0x1']],
      ['too many felts', [NET.pool, '0x1', '0x0', '0x9']],
    ])('refuses an approve with %s', (_label, calldata) => {
      const call = { contractAddress: STRK_TOKEN, entrypoint: 'approve', calldata } as Call
      expect(() => assertSubmittable([call], POLICY)).toThrow(/expected 3 calldata felts/)
    })

    it('refuses a limb that is not a well-formed u128', () => {
      const tooBig = toHex(1n << 128n)
      expect(() => assertSubmittable([approveOf(tooBig)], POLICY)).toThrow(/well-formed u256/)
    })
  })

  describe('the deployed MessageBook', () => {
    const invoke: Call = {
      contractAddress: MESSAGE_BOOK,
      entrypoint: 'privacy_invoke',
      calldata: ['0x1', '0x7', '0x0'],
    }

    it('is refused while no deployment is known', () => {
      expect(() => assertSubmittable([invoke])).toThrow(/not an allowlisted call/)
    })

    it('is permitted once the policy carries its address', () => {
      expect(() => assertSubmittable([invoke], { messageBook: MESSAGE_BOOK })).not.toThrow()
    })

    it('is still limited to its one external entrypoint', () => {
      const wrong: Call = { ...invoke, entrypoint: 'seal_root' }
      expect(() => assertSubmittable([wrong], { messageBook: MESSAGE_BOOK })).toThrow(
        /not an allowlisted call/,
      )
    })
  })
})
