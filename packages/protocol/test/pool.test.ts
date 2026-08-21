import { describe, it, expect } from 'vitest'
import { readPoolConstants, getPublicKey } from '../src/pool.js'

describe('pool live reads', { timeout: 30_000 }, () => {
  it('reads a non-zero fee and a sane proof window', async () => {
    const c = await readPoolConstants()
    expect(c.feeWei).toBeGreaterThan(0n)
    expect(c.proofValidityBlocks).toBeGreaterThan(0)
    expect(c.blockNumber).toBeGreaterThan(13_000_000)
  })

  it('reports the pause state as a boolean', async () => {
    const c = await readPoolConstants()
    expect(typeof c.paused).toBe('boolean')
  })

  it('returns 0n for an address that has never registered', async () => {
    expect(await getPublicKey('0x1234')).toBe(0n)
  })
})
