import { describe, it, expect } from 'vitest'
import type { Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import { assertSubmittable, MAX_CALLS_PER_SUBMISSION } from '../src/allowlist.js'

const MESSAGE_BOOK = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const ATTACKER = '0x0dead0000000000000000000000000000000000000000000000000000000beef'

const applyActions: Call = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const approvePool: Call = {
  contractAddress: STRK_TOKEN,
  entrypoint: 'approve',
  calldata: [NET.pool, '0x53444835ec580000', '0x0'],
}

describe('submission allowlist', () => {
  it('permits the real submission shape: approve the pool, then apply_actions', () => {
    expect(() => assertSubmittable([approvePool, applyActions])).not.toThrow()
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
    expect(() => assertSubmittable([sneaky])).toThrow(/only permitted spender/)
  })

  it('refuses an approve whose calldata cannot be inspected positionally', () => {
    const opaque = {
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: { spender: ATTACKER, amount: 1 },
    } as unknown as Call
    expect(() => assertSubmittable([opaque])).toThrow(/not an array this server can inspect/)
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
    expect(() => assertSubmittable([approvePool, drain, applyActions])).toThrow(/not an allowlisted/)
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
