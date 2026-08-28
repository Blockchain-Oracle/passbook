import { describe, expect, it, vi } from 'vitest'
import { readLaunchPosition, readMarketPosition } from '../src/position-reads.js'

describe('position reads', () => {
  it('decodes a market position and its cash-out quote without sending the secret', async () => {
    const transport = vi.fn(async (_method: string, params: unknown) => {
      const selector = (params as { request: { entry_point_selector: string } }).request.entry_point_selector
      if (selector.includes('152b')) return ['0x9']
      if (selector.includes('216f')) return ['0x7']
      return ['0x2', '0x1', '0x7', '0x5', '0x1']
    })
    await expect(readMarketPosition('0xabc', '0xcommit', transport)).resolves.toEqual({
      marketId: 2,
      side: 1,
      tickets: 7n,
      cashIn: 5n,
      state: 1,
      cashoutQuote: 9n,
      claimPreview: 7n,
    })
    expect(JSON.stringify(transport.mock.calls)).not.toContain('secret')
  })

  it('decodes a launch position', async () => {
    const transport = vi.fn(async (_method: string, params: unknown) => {
      const selector = (params as { request: { entry_point_selector: string } }).request.entry_point_selector
      if (selector.includes('82c6')) return ['0x40']
      if (selector.includes('4150')) return ['0x8']
      return ['0x3', '0x4', '0x8', '0x1']
    })
    await expect(readLaunchPosition('0xabc', '0xcommit', transport)).resolves.toEqual({
      launchId: 3,
      units: 4,
      cashIn: 8n,
      state: 1,
      redeemPreview: 64n,
      refundPreview: 8n,
    })
  })
})
