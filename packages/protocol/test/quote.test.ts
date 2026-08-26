import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SLIPPAGE_BPS,
  fetchQuote,
  minimumOut,
  priceImpact,
  quoteUrl,
  type Quote,
} from '../src/quote.js'

const STRK = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const USDC = '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'

/** The shape the live endpoint actually returned for 1 STRK → USDC, trimmed. */
const LIVE_SHAPE = {
  quoteId: '2ecea312-beb0-4abc-8ae4-4813cde733da',
  sellTokenAddress: STRK,
  sellAmount: '0xde0b6b3a7640000',
  buyTokenAddress: USDC,
  buyAmount: '0x632e',
  sellAmountInUsd: 0.025442,
  buyAmountInUsd: 0.025389,
  gasFees: '0x18335cc0',
  routes: [{ name: '0dAMM', percent: 1 }],
}

const ask = (payload: unknown, sellAmount = 10n ** 18n) =>
  fetchQuote({ sellToken: STRK, buyToken: USDC, sellAmount }, { fetchJson: async () => payload })

describe('the request it builds', () => {
  it('sends the amount as hex, which is what the venue echoes back', () => {
    const url = quoteUrl({ sellToken: STRK, buyToken: USDC, sellAmount: 10n ** 18n })
    expect(url).toContain('sellAmount=0xde0b6b3a7640000')
    expect(url).toContain(`sellTokenAddress=${STRK}`)
    expect(url).toContain(`buyTokenAddress=${USDC}`)
  })

  it('names a taker only when one is supplied', () => {
    const plain = quoteUrl({ sellToken: STRK, buyToken: USDC, sellAmount: 1n })
    expect(plain).not.toContain('takerAddress')
    const withTaker = quoteUrl({ sellToken: STRK, buyToken: USDC, sellAmount: 1n, takerAddress: '0xabc' })
    expect(withTaker).toContain('takerAddress=0xabc')
  })
})

describe('parsing a real answer', () => {
  it('reads the live payload shape', async () => {
    const result = await ask([LIVE_SHAPE])
    expect(result.state).toBe('quoted')
    if (result.state !== 'quoted') return
    expect(result.quote.quoteId).toBe(LIVE_SHAPE.quoteId)
    // 0x632e = 25390 in USDC's 6 decimals = 0.025390 USDC.
    expect(result.quote.buyAmount).toBe(0x632en)
    expect(result.quote.sellAmount).toBe(10n ** 18n)
    expect(result.quote.gasFeesWei).toBe(0x18335cc0n)
    expect(result.quote.routes).toEqual([{ name: '0dAMM', percent: 1 }])
  })

  it('accepts a bare object as well as an array', async () => {
    expect((await ask(LIVE_SHAPE)).state).toBe('quoted')
  })

  it('keeps amounts as bigint, never as a float', async () => {
    // An 18-decimal amount through a float loses its low digits, and those decide whether the
    // transaction reverts.
    const result = await ask([{ ...LIVE_SHAPE, buyAmount: '0xde0b6b3a7640001' }])
    if (result.state !== 'quoted') throw new Error('expected a quote')
    expect(result.quote.buyAmount).toBe(1000000000000000001n)
  })
})

describe('what it refuses to call a price', () => {
  it('does not ask at all for a zero amount', async () => {
    let asked = false
    const result = await fetchQuote(
      { sellToken: STRK, buyToken: USDC, sellAmount: 0n },
      {
        fetchJson: async () => {
          asked = true
          return [LIVE_SHAPE]
        },
      },
    )
    expect(asked).toBe(false)
    expect(result.state).toBe('no-route')
  })

  it('reports no-route on an empty answer', async () => {
    expect((await ask([])).state).toBe('no-route')
    expect((await ask(null)).state).toBe('no-route')
  })

  it('reports no-route on a quote of zero, because zero is not a price', async () => {
    expect((await ask([{ ...LIVE_SHAPE, buyAmount: '0x0' }])).state).toBe('no-route')
  })

  it('reports no-route when there is no quoteId to build calls from', async () => {
    expect((await ask([{ ...LIVE_SHAPE, quoteId: '' }])).state).toBe('no-route')
  })

  it('separates "could not ask" from "there is no route"', async () => {
    // These need different words on screen: one is our problem, one is the market's.
    const unreachable = await fetchQuote(
      { sellToken: STRK, buyToken: USDC, sellAmount: 1n },
      {
        fetchJson: async () => {
          throw new Error('offline')
        },
      },
    )
    expect(unreachable.state).toBe('unavailable')
    expect((await ask([])).state).toBe('no-route')
  })

  it('never throws, whatever comes back', async () => {
    for (const payload of [undefined, 'nonsense', 42, [], [{}], { routes: 'no' }]) {
      await expect(ask(payload)).resolves.toBeDefined()
    }
  })
})

describe('minimumOut', () => {
  it('applies slippage exactly, in bigint', () => {
    expect(minimumOut(10_000n, 100)).toBe(9_900n)
    expect(minimumOut(1_000_000n, 50)).toBe(995_000n)
  })

  it('defaults to the venue default', () => {
    expect(minimumOut(10_000n)).toBe(minimumOut(10_000n, DEFAULT_SLIPPAGE_BPS))
  })

  it('REFUSES to produce zero — the sponsor example ships this foot-gun', () => {
    // A floor of zero accepts any output including nothing, which is exactly what a sandwich
    // needs. Throwing beats sending.
    expect(() => minimumOut(1n, 9_999)).toThrow(/zero/)
    expect(() => minimumOut(0n, 100)).toThrow(/zero/)
  })

  it('refuses a slippage that is not whole basis points below 100%', () => {
    expect(() => minimumOut(10_000n, 10_000)).toThrow(/basis points/)
    expect(() => minimumOut(10_000n, -1)).toThrow(/basis points/)
    expect(() => minimumOut(10_000n, 1.5)).toThrow(/basis points/)
  })

  it('a zero slippage is legal and means "exactly the quote"', () => {
    expect(minimumOut(10_000n, 0)).toBe(10_000n)
  })
})

describe('priceImpact', () => {
  const quote = (over: Partial<Quote> = {}): Quote => ({
    quoteId: 'q',
    sellToken: STRK,
    buyToken: USDC,
    sellAmount: 1n,
    buyAmount: 1n,
    sellAmountUsd: 100,
    buyAmountUsd: 99,
    gasFeesWei: null,
    routes: [],
    ...over,
  })

  it('is the fraction of value the route costs', () => {
    expect(priceImpact(quote())).toBeCloseTo(0.01, 10)
  })

  it('is null when the venue did not price both sides', () => {
    expect(priceImpact(quote({ buyAmountUsd: null }))).toBeNull()
    expect(priceImpact(quote({ sellAmountUsd: null }))).toBeNull()
  })

  it('is null rather than infinite when the sell side is priced at zero', () => {
    expect(priceImpact(quote({ sellAmountUsd: 0 }))).toBeNull()
  })

  it('is negative when the route returns more than it took', () => {
    expect(priceImpact(quote({ buyAmountUsd: 101 }))).toBeCloseTo(-0.01, 10)
  })
})
