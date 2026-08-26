import { describe, it, expect } from 'vitest'
import { byLiquidity, fetchTokenList, searchTokens, type TokenInfo } from '../src/token-list.js'

//
// Driven through both seams, so nothing here touches a network.
//
// The behaviour under test is mostly REFUSAL: this module's job is to be the one place a decimals
// value can enter the app, and every path where it cannot be confirmed has to end in the token
// being dropped rather than defaulted.
//

const listed = (over: Record<string, unknown> = {}) => ({
  address: '0x1',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoUri: 'https://example.test/usdc.png',
  lastDailyVolumeUsd: 4_000_000,
  ...over,
})

const run = (content: unknown[], readDecimals?: (a: string) => Promise<number | null>) =>
  fetchTokenList({
    fetchJson: async () => ({ content }),
    readDecimals: readDecimals ?? (async () => 6),
  })

describe('what it accepts', () => {
  it('keeps a token whose contract agrees with the list', async () => {
    const tokens = await run([listed()])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ symbol: 'USDC', decimals: 6, verified: true })
  })

  it('carries the logo through, and null when the list has none', async () => {
    expect((await run([listed()]))[0]!.logoUri).toBe('https://example.test/usdc.png')
    expect((await run([listed({ logoUri: undefined })]))[0]!.logoUri).toBeNull()
  })

  it('falls back to the symbol when the list omits a name', async () => {
    expect((await run([listed({ name: undefined })]))[0]!.name).toBe('USDC')
  })
})

describe('what it drops, which is the whole job', () => {
  it('drops a token whose contract DISAGREES with the list', async () => {
    // The list says 6 and the chain says 18. Correcting to either would be picking a winner
    // between two sources that are evidently describing different contracts.
    const tokens = await run([listed({ decimals: 6 })], async () => 18)
    expect(tokens).toEqual([])
  })

  it('drops a token whose decimals cannot be read at all', async () => {
    expect(await run([listed()], async () => null)).toEqual([])
  })

  it('drops a token whose read throws, without losing the others', async () => {
    const tokens = await run(
      [listed({ address: '0x1' }), listed({ address: '0x2', symbol: 'ETH', decimals: 18 })],
      async (address) => {
        if (address === '0x1') throw new Error('rpc exploded')
        return 18
      },
    )
    expect(tokens.map((t) => t.symbol)).toEqual(['ETH'])
  })

  it('drops malformed entries before they reach a decimals read', async () => {
    const tokens = await run([
      listed(),
      { symbol: 'NOADDR', decimals: 6 },
      listed({ address: '0x9', decimals: 'six' }),
      listed({ address: '0xa', symbol: '' }),
    ])
    expect(tokens.map((t) => t.address)).toEqual(['0x1'])
  })
})

describe('what it does when the world is broken', () => {
  it('returns an empty list rather than throwing when the fetch fails', async () => {
    // An asset selector with nothing in it is a surface that can say so. A throw takes the screen.
    const tokens = await fetchTokenList({
      fetchJson: async () => {
        throw new Error('offline')
      },
    })
    expect(tokens).toEqual([])
  })

  it('returns an empty list on a payload that is not the shape it expects', async () => {
    expect(await fetchTokenList({ fetchJson: async () => ({}) })).toEqual([])
    expect(await fetchTokenList({ fetchJson: async () => null })).toEqual([])
    expect(await fetchTokenList({ fetchJson: async () => ({ content: 'nope' }) })).toEqual([])
  })
})

describe('ordering and search', () => {
  const tokens = [
    { symbol: 'A', name: 'Alpha', address: '0xaaa', volumeUsd: 10, decimals: 18, logoUri: null, verified: true },
    { symbol: 'B', name: 'Beta', address: '0xbbb', volumeUsd: null, decimals: 18, logoUri: null, verified: true },
    { symbol: 'C', name: 'Gamma', address: '0xccc', volumeUsd: 500, decimals: 6, logoUri: null, verified: true },
  ] satisfies TokenInfo[]

  it('ranks by volume, with unknown volume last', async () => {
    expect(byLiquidity(tokens).map((t) => t.symbol)).toEqual(['C', 'A', 'B'])
  })

  it('does not mutate its input', () => {
    byLiquidity(tokens)
    expect(tokens.map((t) => t.symbol)).toEqual(['A', 'B', 'C'])
  })

  it('searches symbol, name and address, case-insensitively', () => {
    expect(searchTokens(tokens, 'bet').map((t) => t.symbol)).toEqual(['B'])
    expect(searchTokens(tokens, 'GAMMA').map((t) => t.symbol)).toEqual(['C'])
    expect(searchTokens(tokens, '0xCC').map((t) => t.symbol)).toEqual(['C'])
  })

  it('returns everything for an empty query', () => {
    expect(searchTokens(tokens, '   ')).toHaveLength(3)
  })
})
