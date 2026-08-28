import { describe, it, expect } from 'vitest'
import { hash } from 'starknet'

import {
  LAUNCH_STATE,
  MARKET_STATE,
  SELECTOR,
  UNITS_PER_EPOCH,
  currentEpoch,
  decodeByteArray,
  decodeLaunch,
  decodeMarket,
  decodeShortString,
  marketQuestion,
  potShare,
  quoteBet,
  quoteBuy,
  raiseTarget,
  readLaunches,
  readMarkets,
  soldPct,
  strikeDisplay,
  timeLeft,
  unitPriceAt,
  type Transport,
} from '../src/app-reads.js'

//
// ── THE SELECTORS ARE PINNED, AND THIS IS THE PIN ─────────────────────────────────────────
//
// `app-reads.ts` cannot import `starknet` (the build gate bans the graph from the eager chunks a
// markets surface lives in), so its selectors are constants. This test is the only thing keeping
// them equal to what the library — and therefore the chain — computes. A drifted selector fails
// every call with ENTRYPOINT_NOT_FOUND, which a user reads as "markets are broken".
//
describe('selectors', () => {
  it.each(Object.entries(SELECTOR))('%s matches getSelectorFromName', (name, pinned) => {
    expect(BigInt(pinned)).toBe(BigInt(hash.getSelectorFromName(name)))
  })
})

describe('decodeShortString', () => {
  it('round-trips the pair id', () => {
    // 'BTC/USD' encoded as its ASCII bytes, exactly as the contracts store a Pragma pair id.
    const felt = '0x4254432f555344'
    expect(decodeShortString(felt)).toBe('BTC/USD')
  })
})

describe('encodeByteArray', () => {
  it('round-trips through the decoder at both boundary shapes', async () => {
    const { encodeByteArray } = await import('../src/app-reads.js')
    for (const text of ['OWL', 'a'.repeat(31), 'a'.repeat(31) + 'bc', '', 'Night Owl']) {
      expect(decodeByteArray(encodeByteArray(text)).text).toBe(text)
    }
  })

  it('refuses non-ASCII rather than encoding a name that renders as another', async () => {
    const { encodeByteArray } = await import('../src/app-reads.js')
    expect(() => encodeByteArray('café')).toThrow(/ASCII/)
  })
})

describe('decodeByteArray', () => {
  it('decodes a pending-word-only string', () => {
    // "OWL": no full bytes31 words, three pending bytes.
    const felts = ['0x0', '0x4f574c', '0x3']
    expect(decodeByteArray(felts)).toEqual({ text: 'OWL', next: 3 })
  })

  it('decodes a full word plus pending and reports where it stopped', () => {
    // 31 'a's as one full word, then "bc" pending — 33 characters.
    const word = '0x' + BigInt('0x' + '61'.repeat(31)).toString(16)
    const felts = ['0x1', word, '0x6263', '0x2', '0xdead']
    const out = decodeByteArray(felts)
    expect(out.text).toBe('a'.repeat(31) + 'bc')
    expect(out.next).toBe(4)
  })
})

//
// The vector transcribes `markets.cairo`'s `Market` field order. If a struct edit reorders a
// field, this is the assertion that catches it before a surface renders a strike as a deadline.
//
const MARKET_FELTS = [
  '0x4254432f555344', // pair_id 'BTC/USD'
  '0x7524963f400', // strike — 80,500 * 1e8
  '0x68b0f4d0', // deadline
  '0x4718', // token (abbreviated felt is still a felt)
  '0x64', // up = 100
  '0x12c', // down = 300
  '0x1', // k.low
  '0x0', // k.high
  '0x50', // seed
  '0x190', // collateral
  '0x1', // state = active
  '0x0', // winner
  '0x0', // experimental = false
]

describe('decodeMarket', () => {
  const market = decodeMarket(7, MARKET_FELTS)

  it('transcribes the struct in declaration order', () => {
    expect(market).toMatchObject({
      id: 7,
      pair: 'BTC/USD',
      strike: 8_050_000_000_000n,
      token: '0x4718',
      up: 100n,
      down: 300n,
      seed: 80n,
      collateral: 400n,
      state: MARKET_STATE.active,
      winner: 0,
      experimental: false,
    })
  })

  it('derives the question in the prototype’s words', () => {
    expect(marketQuestion(market)).toBe('BTC/USD above $80,500')
  })

  it('splits the pot to a whole hundred', () => {
    expect(potShare(market)).toEqual({ upPct: 25, downPct: 75 })
    expect(potShare({ ...market, up: 0n, down: 0n })).toEqual({ upPct: 50, downPct: 50 })
  })

  it('refuses a truncated span', () => {
    expect(() => decodeMarket(0, MARKET_FELTS.slice(0, 12))).toThrow(/13/)
  })
})

describe('strikeDisplay', () => {
  it('follows the magnitude the way formatPrice does', () => {
    expect(strikeDisplay(8_050_000_000_000n)).toBe('80,500')
    expect(strikeDisplay(300_000_000n)).toBe('3.00')
    expect(strikeDisplay(3_000_000n)).toBe('0.03000')
  })
})

describe('timeLeft', () => {
  const now = 1_000_000_000_000 // ms
  it('formats each band and closes honestly', () => {
    expect(timeLeft(1_000_000_000 + 2 * 86_400 + 4 * 3_600, now)).toBe('2d 4h')
    expect(timeLeft(1_000_000_000 + 3 * 3_600 + 12 * 60, now)).toBe('3h 12m')
    expect(timeLeft(1_000_000_000 + 47 * 60, now)).toBe('47m')
    expect(timeLeft(1_000_000_000, now)).toBe('closed')
  })
})

const LAUNCH_FELTS = [
  '0x4718', // stake_token
  '0x0', // token — not graduated
  '0xa', // p0 = 10
  '0x5', // dp = 5
  '0x3e8', // unit_tokens = 1000
  '0x4', // epochs = 4
  '0x23', // sold = 35 units → epoch 2
  '0x1f4', // raised = 500
  '0x68b0f4d0', // deadline
  '0xbeef', // creator_commitment
  '0x1', // state = active
  '0x0', // swept
]

describe('decodeLaunch', () => {
  const launch = decodeLaunch(3, LAUNCH_FELTS, 'Night Owl', 'OWL')

  it('transcribes the struct in declaration order', () => {
    expect(launch).toMatchObject({
      id: 3,
      name: 'Night Owl',
      symbol: 'OWL',
      stakeToken: '0x4718',
      p0: 10n,
      dp: 5n,
      unitTokens: 1000n,
      epochs: 4,
      sold: 35,
      raised: 500n,
      state: LAUNCH_STATE.active,
      swept: false,
    })
  })

  it('derives the staircase: epoch, price inside it, progress, target', () => {
    expect(currentEpoch(launch)).toBe(2) // 35 sold / 16 per epoch
    expect(unitPriceAt(launch, 2)).toBe(20n) // 10 + 5×2
    expect(soldPct(launch)).toBe(55) // 35 of 64
    // Σ (10+5e)×16 for e in 0..3 = (10+15+20+25)×16
    expect(raiseTarget(launch)).toBe(1120n)
    expect(UNITS_PER_EPOCH).toBe(16)
  })

  it('clamps the epoch at the top of the staircase', () => {
    expect(currentEpoch({ ...launch, sold: 64 })).toBe(3)
  })
})

//
// The list reads, driven through the transport seam — nothing here touches a network. The seam
// answers `market_count`/`launch_count` and each getter, and the half-failure arm proves a broken
// entry becomes a sentence beside the survivors rather than an empty list.
//
describe('readMarkets', () => {
  const transport =
    (answers: Record<string, string[] | Error>): Transport =>
    (_method, params) => {
      const { request } = params as { request: { entry_point_selector: string; calldata: string[] } }
      const key = `${request.entry_point_selector}:${request.calldata.join(',')}`
      const hit = answers[key] ?? answers[request.entry_point_selector]
      if (hit === undefined) throw new Error(`unstubbed call ${key}`)
      if (hit instanceof Error) return Promise.reject(hit)
      return Promise.resolve(hit)
    }

  it('reads newest first and carries a per-entry failure as a sentence', async () => {
    const out = await readMarkets('0xM', {
      transport: transport({
        [SELECTOR.market_count]: ['0x2'],
        [`${SELECTOR.get_market}:0x1`]: MARKET_FELTS,
        [`${SELECTOR.get_market}:0x0`]: new Error('rpc fell over'),
      }),
    })
    expect(out.total).toBe(2)
    expect(out.markets.map((m) => m.id)).toEqual([1])
    expect(out.problem).toContain('Market 0')
  })

  it('reads launches with their names', async () => {
    const out = await readLaunches('0xL', {
      transport: transport({
        [SELECTOR.launch_count]: ['0x1'],
        [`${SELECTOR.get_launch}:0x0`]: LAUNCH_FELTS,
        [`${SELECTOR.launch_name}:0x0`]: ['0x0', '0x4e69676874204f776c', '0x9'],
        [`${SELECTOR.launch_symbol}:0x0`]: ['0x0', '0x4f574c', '0x3'],
      }),
    })
    expect(out.launches).toHaveLength(1)
    expect(out.launches[0]).toMatchObject({ name: 'Night Owl', symbol: 'OWL' })
    expect(out.problem).toBeNull()
  })

  it('quotes ride the same seam', async () => {
    const seam = transport({
      [`${SELECTOR.quote_bet}:0x1,0x1,0x64`]: ['0xc8'],
      [`${SELECTOR.quote_buy}:0x0,0x4`]: ['0x50'],
    })
    expect(await quoteBet('0xM', 1, 1, 100n, seam)).toBe(200n)
    expect(await quoteBuy('0xL', 0, 4, seam)).toBe(80n)
  })
})
