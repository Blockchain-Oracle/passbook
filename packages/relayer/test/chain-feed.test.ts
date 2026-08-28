//
// The chain feed: pinned event selectors, the tape decoder's refusals, and the hub's behavior —
// an unchanged read emits nothing, a hello carries everything, a dead socket costs only itself.
//
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hash } from 'starknet'
import { describe, expect, it } from 'vitest'

import type { Transport } from '../../protocol/src/app-reads.js'
import type { FeedFrame } from '../../protocol/src/chain-feed-wire.js'
import { ChainFeed, decodeTapeEvent, EVENT_KEY } from '../src/chain-feed.js'

// ── THE EVENT KEYS ARE PINNED, AND THIS IS THE PIN — app-reads.test.ts's discipline. ──────
describe('EVENT_KEY', () => {
  it.each(Object.entries(EVENT_KEY))('%s matches getSelectorFromName', (name, pinned) => {
    expect(BigInt(pinned)).toBe(BigInt(hash.getSelectorFromName(name)))
  })
})

describe('decodeTapeEvent', () => {
  const bet = {
    keys: [EVENT_KEY.BetPlaced, '0x7'],
    // side, amount, tickets, up_after, down_after, commitment — BetPlaced's data, in order.
    data: ['0x1', '0xde0b6b3a7640000', '0x2', '0x5', '0x3', '0xabc'],
    transaction_hash: '0xdead',
    block_number: 42,
  }

  it('decodes a BetPlaced into a tape row with its transaction hash', () => {
    expect(decodeTapeEvent('markets', bet)).toEqual({
      kind: 'bet',
      marketId: 7,
      side: 1,
      amount: '0xde0b6b3a7640000',
      upAfter: '0x5',
      downAfter: '0x3',
      txHash: '0xdead',
      block: 42,
    })
  })

  it('answers null for anything that does not decode, never a throw', () => {
    expect(decodeTapeEvent('markets', {})).toBeNull()
    expect(decodeTapeEvent('markets', { ...bet, keys: ['not-a-felt', '0x7'] })).toBeNull()
    expect(decodeTapeEvent('markets', { ...bet, data: ['0x1'] })).toBeNull()
    expect(decodeTapeEvent('markets', { ...bet, transaction_hash: undefined })).toBeNull()
    // A launch-side key arriving tagged as a markets event is not one of that contract's rows.
    expect(decodeTapeEvent('markets', { ...bet, keys: [EVENT_KEY.Bought, '0x7'] })).toBeNull()
  })

  it('decodes the launch side, including the id-in-data settling events', () => {
    const redeem = decodeTapeEvent('launch', {
      keys: [EVENT_KEY.Redeemed, '0xabc'],
      data: ['0x3', '0x4', '0x64'],
      transaction_hash: '0xbeef',
      block_number: 9,
    })
    expect(redeem).toEqual({ kind: 'redeem', launchId: 3, units: 4, amount: '0x64', txHash: '0xbeef', block: 9 })
  })
})

// A market's 13 felts: pair 'BTC/USD', strike, deadline, token, up, down, k.lo, k.hi, seed,
// collateral, state, winner, experimental.
const MARKET_FELTS = [
  '0x4254432f555344',
  '0x8bb2c97000',
  '0x66f0000',
  '0x7777',
  '0x5',
  '0x3',
  '0x0',
  '0x0',
  '0x2',
  '0x8',
  '0x1',
  '0x0',
  '0x0',
]

/** A transport answering the exact sequence `tickApp` asks for. */
function stubTransport(events: unknown[] = []): Transport {
  return (method, params) => {
    if (method === 'starknet_blockNumber') return Promise.resolve(100)
    if (method === 'starknet_getEvents') return Promise.resolve({ events })
    const { request } = params as { request: { entry_point_selector: string; calldata: string[] } }
    // market_count then get_market — the only calls a markets-only feed makes.
    if (request.calldata.length === 0) return Promise.resolve(['0x1'])
    return Promise.resolve(MARKET_FELTS)
  }
}

function collect(feed: ChainFeed): FeedFrame[] {
  const frames: FeedFrame[] = []
  const attached = feed.subscribe({
    deliver: (payload) => frames.push(JSON.parse(payload) as FeedFrame),
    end: () => {},
  })
  if (!attached.ok) throw new Error('subscribe refused')
  frames.push(JSON.parse(attached.hello) as FeedFrame)
  return frames
}

describe('ChainFeed', () => {
  it('broadcasts a markets frame on change and nothing on an unchanged read', async () => {
    const feed = new ChainFeed({ markets: '0xM', transport: stubTransport(), log: () => {}, warn: () => {} })
    const frames = collect(feed)

    await feed.tickApp()
    await feed.tickApp()

    const marketFrames = frames.filter((f) => f.t === 'markets')
    expect(marketFrames).toHaveLength(1)
    expect(marketFrames[0]).toMatchObject({ total: 1 })
    // The second identical read said nothing — the wire carries changes, not reassurance.
  })

  it('hands a late subscriber the whole state in its hello', async () => {
    const feed = new ChainFeed({
      markets: '0xM',
      transport: stubTransport([
        {
          keys: [EVENT_KEY.MarketCreated, '0x0'],
          data: ['0x4254432f555344', '0x1', '0x2', '0x7777', '0x2', '0xabc', '0x0'],
          transaction_hash: '0xcafe',
          block_number: 99,
        },
      ]),
      readPrices: async () => [
        { ok: true, price: { pair: 'BTC/USD', price: 63000, decimals: 8, timestamp: 1_700_000_000, sources: 7 } },
      ],
      log: () => {},
      warn: () => {},
    })
    await feed.tickApp()
    await feed.tickPrices()

    const frames = collect(feed)
    const hello = frames[0]!
    expect(hello.t).toBe('hello')
    if (hello.t !== 'hello') return
    expect(hello.markets).toHaveLength(1)
    expect(hello.markets[0]!.pair).toBe('BTC/USD')
    expect(hello.prices[0]).toMatchObject({ pair: 'BTC/USD', price: 63000, sources: 7 })
    expect(hello.history['BTC/USD']).toHaveLength(1)
    expect(hello.tape[0]).toMatchObject({ kind: 'market-created', txHash: '0xcafe' })
  })

  it('appends the price line only on a change, while the reading always updates', async () => {
    let price = 100
    const feed = new ChainFeed({
      readPrices: async () => [
        { ok: true, price: { pair: 'STRK/USD', price, decimals: 8, timestamp: 1, sources: 3 } },
      ],
      log: () => {},
      warn: () => {},
    })
    await feed.tickPrices()
    await feed.tickPrices() // unchanged — reading refreshes, line does not
    price = 101
    await feed.tickPrices()

    const hello = collect(feed)[0]!
    if (hello.t !== 'hello') throw new Error('no hello')
    expect(hello.history['STRK/USD']).toHaveLength(2)
    expect(hello.prices[0]!.price).toBe(101)
  })

  it('drops a subscriber whose socket throws, and only that one', async () => {
    const feed = new ChainFeed({ markets: '0xM', transport: stubTransport(), log: () => {}, warn: () => {} })
    const alive: FeedFrame[] = []
    const dead = feed.subscribe({
      deliver: () => {
        throw new Error('socket closed')
      },
      end: () => {},
    })
    const good = feed.subscribe({ deliver: (p) => alive.push(JSON.parse(p) as FeedFrame), end: () => {} })
    expect(dead.ok && good.ok).toBe(true)

    await feed.tickApp()
    expect(alive.some((f) => f.t === 'markets')).toBe(true)
    expect(feed.stats().subscribers).toBe(1)
  })

  it('warms the price history from the JSONL store and survives a corrupt line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chain-feed-'))
    const path = join(dir, 'feed.jsonl')
    writeFileSync(
      path,
      ['{"pair":"BTC/USD","t":1,"p":50}', 'not json at all', '{"pair":"BTC/USD","t":2,"p":51}', ''].join('\n'),
    )
    const feed = new ChainFeed({ storePath: path, log: () => {}, warn: () => {} })
    const hello = collect(feed)[0]!
    if (hello.t !== 'hello') throw new Error('no hello')
    expect(hello.history['BTC/USD']).toEqual([
      { t: 1, p: 50 },
      { t: 2, p: 51 },
    ])
  })

  it('appends new points to the store it warmed from', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chain-feed-'))
    const path = join(dir, 'feed.jsonl')
    const feed = new ChainFeed({
      storePath: path,
      readPrices: async () => [
        { ok: true, price: { pair: 'ETH/USD', price: 3200, decimals: 8, timestamp: 5, sources: 4 } },
      ],
      now: () => 1234,
      log: () => {},
      warn: () => {},
    })
    await feed.tickPrices()
    expect(readFileSync(path, 'utf8')).toBe('{"pair":"ETH/USD","t":1234,"p":3200}\n')
  })
})
