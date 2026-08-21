import { describe, it, expect } from 'vitest'
import { hash } from 'starknet'
import {
  NETWORKS,
  NET,
  ACTIVE_NETWORK,
  SELECTOR_PRIVACY_INVOKE,
  SELECTOR_PRIVACY_INVOKE_WITH_COMPUTATION,
} from '../src/constants.js'

describe('network config', () => {
  it('defaults to mainnet — production must never ship pointing elsewhere', () => {
    expect(ACTIVE_NETWORK).toBe('mainnet')
    expect(NET.pool).toBe('0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a')
  })

  it('never lists the dead BlastAPI host on any network', () => {
    for (const n of Object.values(NETWORKS)) {
      expect(n.rpc.some((u) => u.includes('blastapi'))).toBe(false)
    }
    expect(NETWORKS.mainnet.rpc[0]).toBe('https://rpc.starknet.lava.build')
  })

  it('leaves the sepolia pool empty — no shared pool is published', () => {
    expect(NETWORKS.sepolia.pool).toBe('')
  })

  it('pins the privacy_invoke selector', () => {
    expect(SELECTOR_PRIVACY_INVOKE)
      .toBe('0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043')
  })

  // Locks the DERIVATION, not a copied literal: a mis-transcribed hex digit fails here.
  // Compared as bigints because Starknet felts have no canonical zero-padding — the
  // constant is stored `0x00d7dc…` while the selector derives as `0xd7dc…`. Identical
  // numbers, different strings, so a string comparison would reject a correct value.
  it('derives both privacy selectors from their entrypoint names', () => {
    expect(BigInt(SELECTOR_PRIVACY_INVOKE)).toBe(
      BigInt(hash.getSelectorFromName('privacy_invoke')),
    )
    expect(BigInt(SELECTOR_PRIVACY_INVOKE_WITH_COMPUTATION)).toBe(
      BigInt(hash.getSelectorFromName('privacy_invoke_with_computation')),
    )
  })

  it('exports no fee constant — fees are mutable and read live', async () => {
    const mod = await import('../src/constants.js')
    expect(Object.keys(mod).some((k) => /FEE|AMOUNT/i.test(k))).toBe(false)
  })
})
