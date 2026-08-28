import { describe, expect, it } from 'vitest'

import { MARKET_STATE, type OnChainMarket } from '../../protocol/src/app-reads.js'
import { Groundskeeper, nextStandingPair } from '../src/groundskeeper.js'

const NOW = 1_700_000_000

function market(over: Partial<OnChainMarket> = {}): OnChainMarket {
  return {
    id: 0,
    pair: 'BTC/USD',
    strike: 110_000_00000000n,
    deadline: NOW + 3600,
    token: '0x1',
    up: 0n,
    down: 0n,
    seed: 2n,
    collateral: 2n,
    state: MARKET_STATE.active,
    winner: 0,
    experimental: false,
    ...over,
  }
}

describe('nextStandingPair — the one decision, pure', () => {
  it('names the first pair with no open market', () => {
    expect(nextStandingPair([], ['BTC/USD', 'ETH/USD'], NOW)).toBe('BTC/USD')
    expect(nextStandingPair([market()], ['BTC/USD', 'ETH/USD'], NOW)).toBe('ETH/USD')
  })

  it('answers null when every pair is covered — the job fills gaps, it does not compete', () => {
    const board = [market(), market({ id: 1, pair: 'ETH/USD' }), market({ id: 2, pair: 'STRK/USD' })]
    expect(nextStandingPair(board, ['BTC/USD', 'ETH/USD', 'STRK/USD'], NOW)).toBeNull()
  })

  it('a nearly-closed market no longer covers its pair', () => {
    // 10 minutes left with a 15-minute floor: the next window gets planted before this one ends.
    const closing = market({ deadline: NOW + 600 })
    expect(nextStandingPair([closing], ['BTC/USD'], NOW, 900)).toBe('BTC/USD')
    expect(nextStandingPair([closing], ['BTC/USD'], NOW, 300)).toBeNull()
  })

  it('a settled or voided market covers nothing, whatever its clock says', () => {
    const settled = market({ state: MARKET_STATE.resolved, deadline: NOW + 9999 })
    expect(nextStandingPair([settled], ['BTC/USD'], NOW)).toBe('BTC/USD')
  })

  it("users' markets cover their pair — whoever seeded it, an open market is cover", () => {
    const theirs = market({ experimental: true })
    expect(nextStandingPair([theirs], ['BTC/USD'], NOW)).toBeNull()
  })
})

describe('the sweep', () => {
  it('persists the seeder secret BEFORE the submission is signed', async () => {
    const order: string[] = []
    const keeper = new Groundskeeper({
      pairs: ['BTC/USD'],
      seedWei: 5n,
      now: () => NOW * 1000,
      readMarkets: async () => [],
      readStrike: async () => 110_000_00000000n,
      ensureReady: async () => null,
      createMarket: async ({ persist }) => {
        // The real implementation calls persist() before proving; the contract here asserts the
        // ordering is observable from outside — a crash after `sign` never loses a secret.
        persist({ secret: '0x5ec7e7', commitment: '0xc0117' })
        order.push('sign')
        return { txHash: '0xdead' }
      },
      recordSeed: (seed) => {
        order.push(`persist:${seed.commitment}`)
        expect(seed.pair).toBe('BTC/USD')
        expect(seed.seedWei).toBe('5')
      },
      updateSeedTx: () => {},
    })
    await keeper.sweep()
    expect(order).toEqual(['persist:0xc0117', 'sign'])
    expect(keeper.problem).toBeNull()
    expect(keeper.last).toContain('0xdead')
  })

  it('a zero oracle median opens nothing', async () => {
    let created = 0
    const keeper = new Groundskeeper({
      pairs: ['BTC/USD'],
      seedWei: 5n,
      readMarkets: async () => [],
      readStrike: async () => 0n,
      ensureReady: async () => null,
      createMarket: async () => {
        created += 1
        return { txHash: '0x0' }
      },
      recordSeed: () => {},
      updateSeedTx: () => {},
    })
    await keeper.sweep()
    expect(created).toBe(0)
    expect(keeper.problem).toContain('zero median')
  })

  it('never throws — a failed creation becomes the sentence the banner shows', async () => {
    const keeper = new Groundskeeper({
      pairs: ['BTC/USD'],
      seedWei: 5n,
      readMarkets: async () => [],
      readStrike: async () => 1n,
      ensureReady: async () => null,
      createMarket: async () => {
        throw new Error('WINDOW_TOO_SHORT')
      },
      recordSeed: () => {},
      updateSeedTx: () => {},
    })
    await keeper.sweep()
    expect(keeper.problem).toContain('WINDOW_TOO_SHORT')
  })

  it('a covered board is not a problem', async () => {
    const keeper = new Groundskeeper({
      pairs: ['BTC/USD'],
      seedWei: 5n,
      now: () => NOW * 1000,
      readMarkets: async () => [market()],
      readStrike: async () => 1n,
      ensureReady: async () => null,
      createMarket: async () => {
        throw new Error('must not create on a covered board')
      },
      recordSeed: () => {},
      updateSeedTx: () => {},
    })
    await keeper.sweep()
    expect(keeper.problem).toBeNull()
  })
})
