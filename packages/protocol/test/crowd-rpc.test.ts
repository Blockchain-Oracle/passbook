import { describe, it, expect } from 'vitest'
import { DEPOSIT_EVENT_KEY, readCrowd } from '../src/crowd-rpc.js'
import { poolEventSelector } from '../src/pool-events.js'
import { NET } from '../src/constants.js'
import { INDEXER_UNREACHABLE } from '../src/linkability-copy.js'

//
// Driven entirely through the transport seam, so nothing here touches a network.
//

const HEAD = 6_000

function deposit(blockNumber: number, depositor: string) {
  return { keys: [DEPOSIT_EVENT_KEY, depositor], data: ['0x64'], block_number: blockNumber }
}

type Page = { events?: unknown[]; continuation_token?: string } | null

const run = (page: Page, head: unknown = HEAD) =>
  readCrowd({
    call: async (method) => (method === 'starknet_blockNumber' ? head : page),
  })

describe('the duplicated selector is pinned to the original', () => {
  it('equals what `poolEventSelector` computes', () => {
    // THE WHOLE REASON THE CONSTANT IS SAFE. `starknetKeccak` is the import the browser cannot
    // afford; this test runs in Node, where it costs nothing, and fails the moment the two drift.
    // Same device `disclosure.test.ts` uses for its two duplicated sentences.
    expect(DEPOSIT_EVENT_KEY).toBe(poolEventSelector('Deposit'))
  })
})

describe('the request it builds', () => {
  it('asks one host for one event type over a bounded range', async () => {
    const seen: Array<{ method: string; params: unknown }> = []
    await readCrowd({
      call: async (method, params) => {
        seen.push({ method, params })
        return method === 'starknet_blockNumber' ? HEAD : { events: [] }
      },
    })

    const events = seen.find((s) => s.method === 'starknet_getEvents')
    const filter = (events?.params as unknown[])[0] as Record<string, unknown>
    expect(filter.address).toBe(NET.pool)
    expect(filter.from_block).toEqual({ block_number: 0 })
    expect(filter.to_block).toEqual({ block_number: HEAD })
  })

  it('never sends an empty key filter, which is the match-anything wildcard', async () => {
    // An empty inner array asks for EVERY event the pool has ever emitted, turning a bounded
    // question into the firehose. `pool-events.ts` refuses an empty name list over this exact case.
    const seen: unknown[] = []
    await readCrowd({
      call: async (method, params) => {
        if (method === 'starknet_getEvents') seen.push(params)
        return method === 'starknet_blockNumber' ? HEAD : { events: [] }
      },
    })
    const filter = (seen[0] as unknown[])[0] as { keys: string[][] }
    expect(filter.keys).toEqual([[DEPOSIT_EVENT_KEY]])
    expect(filter.keys[0]!.length).toBeGreaterThan(0)
  })
})

describe('the reading it builds', () => {
  it('counts DISTINCT depositors, not deposits', async () => {
    const events = Array.from({ length: 10 }, (_, i) => deposit(5_500 + i, '0xa11ce'))
    const reading = await run({ events })
    expect(reading.state === 'measured' && reading.candidates).toBe(1)
  })

  it('treats two spellings of one address as one depositor', async () => {
    // Felts have no canonical padding. Counting `0x0a11ce` and `0xa11ce` separately would inflate
    // the exact number the user is being asked to trust.
    const reading = await run({ events: [deposit(5_500, '0x0a11ce'), deposit(5_600, '0xa11ce')] })
    expect(reading.state === 'measured' && reading.candidates).toBe(1)
  })

  it('reports the most recent bucket, so the count and the sample share a unit', async () => {
    const reading = await run({
      events: [deposit(100, '0x0d'), deposit(5_200, '0xa'), deposit(5_300, '0xb'), deposit(5_400, '0xc')],
    })
    expect(reading.state === 'measured' && reading.candidates).toBe(3)
  })

  it('spreads depositors across the buckets they landed in', async () => {
    const reading = await run({
      events: [deposit(200, '0xa'), deposit(1_200, '0xb'), deposit(2_200, '0xc'), deposit(5_500, '0xd')],
    })
    expect(reading.state === 'measured' && [...reading.distribution]).toEqual([1, 1, 1, 0, 0, 1])
  })

  it('produces a sample long enough to support a quartile', async () => {
    const reading = await run({ events: [] })
    expect(reading.state === 'measured' && reading.distribution.length).toBe(6)
  })

  it('stamps the block it read to and names its window in blocks', async () => {
    const reading = await run({ events: [] })
    expect(reading.state === 'measured' && reading.blockNumber).toBe(HEAD)
    expect(reading.state === 'measured' && reading.window).toBe('the last 1,000 blocks')
  })

  it('never claims a largest-ever from a bounded range', async () => {
    // AD-14 reserves the unbounded aggregate for the relayer stats endpoint. A window maximum is
    // not "the largest crossing this pool has ever carried", and the sentence says ever.
    const reading = await run({ events: [deposit(5_500, '0xa')] })
    expect(reading.state === 'measured' && reading.largestEverWei).toBeNull()
  })

  it('drops an unreadable event without losing the reading', async () => {
    const rotten = { keys: [DEPOSIT_EVENT_KEY, '0xnothex'], block_number: 5_500 }
    const reading = await run({ events: [rotten, deposit(5_500, '0xa')] })
    expect(reading.state).toBe('measured')
    expect(reading.state === 'measured' && reading.candidates).toBe(1)
  })

  it('reports an empty pool as zero without inventing anyone', async () => {
    const reading = await run({ events: [] })
    expect(reading.state === 'measured' && reading.candidates).toBe(0)
  })
})

describe('what it refuses to report', () => {
  it('will not present a truncated page as a count', async () => {
    const reading = await run({ events: [deposit(5_500, '0xa')], continuation_token: 'more' })
    expect(reading).toEqual({ state: 'unmeasurable', because: INDEXER_UNREACHABLE })
  })

  it('degrades when the head is not a block number', async () => {
    expect((await run({ events: [] }, 'not a number')).state).toBe('unmeasurable')
    expect((await run({ events: [] }, null)).state).toBe('unmeasurable')
  })

  it('degrades when the page is missing or malformed', async () => {
    expect((await run(null)).state).toBe('unmeasurable')
    expect((await run({})).state).toBe('unmeasurable')
  })

  it('degrades rather than throwing when the transport fails', async () => {
    const reading = await readCrowd({
      call: async () => {
        throw new Error('all RPC hosts failed')
      },
    })
    expect(reading).toEqual({ state: 'unmeasurable', because: INDEXER_UNREACHABLE })
  })

  it('uses the sourced sentence, honest because a read was attempted', async () => {
    const reading = await run(null)
    expect(reading.state === 'unmeasurable' && reading.because).toBe('Our indexer is unreachable')
  })
})
