import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_WINDOW_BLOCKS,
  MAX_NARROWING_ATTEMPTS,
  MIN_WINDOW_BLOCKS,
  SECONDS_PER_BLOCK,
  describeSpan,
  readRecentEvents,
} from '../src/activity-window.js'
import { poolEventSelector, type EventRequest } from '../src/pool-events.js'

const sel = poolEventSelector

/**
 * A fake paged RPC that overflows any window wider than `fitsWithin` blocks.
 *
 * This is the shape of the real problem: a busy pool returns continuation tokens until the page
 * cap stops the walk, and it does so as a function of how MUCH history the window covers. Narrow
 * the window enough and the same pool answers in one page.
 */
function poolBusyAbove(fitsWithin: number) {
  const requests: EventRequest[] = []
  return {
    requests,
    read: async (request: EventRequest) => {
      requests.push(request)
      const width = request.to_block.block_number - request.from_block.block_number
      const event = {
        block_number: request.to_block.block_number,
        keys: [sel('NoteUsed'), '0x1'],
        data: [],
        transaction_hash: `0x${requests.length.toString(16)}`,
      }
      // Wider than it can serve → another token, forever. Narrow enough → one complete page.
      return width > fitsWithin
        ? { events: [event], continuation_token: `page-${requests.length}` }
        : { events: [event] }
    },
  }
}

describe('reading recent events keeps the bound and moves the window', () => {
  it('takes one read when the full window fits', async () => {
    const reader = poolBusyAbove(Number.MAX_SAFE_INTEGER)
    const result = await readRecentEvents({ toBlock: 1_000_000, getEvents: reader.read })

    expect(result.complete).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.blocks).toBe(ACTIVITY_WINDOW_BLOCKS)
    // The ordinary case costs exactly one round trip. A feed that always narrowed would be paying
    // for a rare pool on every load.
    expect(reader.requests).toHaveLength(1)
  })

  it('every read ends at toBlock, so narrowing moves the window TOWARD the present', async () => {
    // THE BUG THIS MODULE EXISTS FOR. `readPoolEvents` pages forward, so a truncated read holds
    // the OLDEST events in its range. If narrowing moved `toBlock` instead of `fromBlock`, the
    // feed would keep discarding exactly the rows a reader came for.
    // Serves only a window at the floor, so narrowing has to run most of the way down.
    const reader = poolBusyAbove(MIN_WINDOW_BLOCKS)
    const result = await readRecentEvents({ toBlock: 900_000, getEvents: reader.read })

    expect(result.complete).toBe(true)
    expect(result.attempts).toBeGreaterThan(1)
    // EVERY request, internal paging included, ends at the same height. The window's far end is
    // what moves; its near end is pinned to the moment the balance was read beside.
    for (const request of reader.requests) {
      expect(request.to_block.block_number).toBe(900_000)
    }
    // And each attempt starts LATER than the one before it — strictly closing on the head.
    // Deduped in order, because `readPoolEvents` pages internally and every page of one attempt
    // repeats that attempt's `from_block`.
    const starts = [...new Set(reader.requests.map((r) => r.from_block.block_number))]
    expect(starts.length).toBe(result.attempts)
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThan(starts[i - 1]!)
  })

  it('halves until it fits, and reports the width it settled on', async () => {
    // Derived from the constants rather than written as a literal: the window is sized in TIME
    // and converted through a measured block rate, so any literal here would be a second, silent
    // copy of a number that is expected to change when Starknet's block time does.
    const third = Math.floor(ACTIVITY_WINDOW_BLOCKS / 8)
    const reader = poolBusyAbove(third)
    const result = await readRecentEvents({ toBlock: 500_000, getEvents: reader.read })

    expect(result.complete).toBe(true)
    // Three halvings — the first width at or below what this pool can serve.
    expect(result.blocks).toBeLessThanOrEqual(third)
    expect(result.blocks).toBeGreaterThan(Math.floor(third / 2))
    expect(result.attempts).toBe(4)
  })

  it('gives up at the floor rather than halving forever, and says it is incomplete', async () => {
    // A pool nothing can window its way out of.
    const reader = poolBusyAbove(0)
    const result = await readRecentEvents({ toBlock: 500_000, getEvents: reader.read })

    expect(result.complete).toBe(false)
    expect(result.blocks).toBe(MIN_WINDOW_BLOCKS)
    expect(result.attempts).toBeLessThanOrEqual(MAX_NARROWING_ATTEMPTS)
    // THE ROWS SURVIVE. A truncated page is still rows, and returning none of them because the
    // read was imperfect would be strictly worse than returning some and saying so.
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('does not re-read the same range once the floor is reached', async () => {
    const reader = poolBusyAbove(0)
    const result = await readRecentEvents({
      toBlock: 500_000,
      windowBlocks: MIN_WINDOW_BLOCKS,
      getEvents: reader.read,
    })
    // Already at the floor on the first try: narrowing has nowhere to go, so a second attempt
    // would ask the identical question and get the identical answer.
    //
    // Asserted on `attempts` and on DISTINCT ranges, not on the raw request count — `readPoolEvents`
    // pages internally up to `MAX_EVENT_PAGES`, so one attempt against an endless pool is already
    // 64 requests. Counting those would be measuring the wrong loop.
    expect(result.attempts).toBe(1)
    const ranges = new Set(reader.requests.map((r) => r.from_block.block_number))
    expect(ranges.size).toBe(1)
  })

  it('refuses a nonsense height before spending a round trip', async () => {
    const reader = poolBusyAbove(Number.MAX_SAFE_INTEGER)
    await expect(readRecentEvents({ toBlock: -1, getEvents: reader.read })).rejects.toThrow(
      /whole block height/,
    )
    expect(reader.requests).toHaveLength(0)
  })

  it('clamps a window narrower than the floor up to it', async () => {
    const reader = poolBusyAbove(Number.MAX_SAFE_INTEGER)
    const result = await readRecentEvents({ toBlock: 500_000, windowBlocks: 1, getEvents: reader.read })
    expect(result.blocks).toBe(MIN_WINDOW_BLOCKS)
  })
})

describe('the window is sized in time, not in a guessed block rate', () => {
  it('the default window really is a week at the measured block time', () => {
    // THE BUG THIS GUARDS. The first version hardcoded 20,000 blocks on the widely-quoted
    // 30-second block time. Starknet mainnet measures 1.7s, so that window covered nine hours,
    // and this app's own three-day-old registration fell outside it — the feed truthfully
    // reported an empty window for a pool that held the transaction the product exists to show.
    const days = (ACTIVITY_WINDOW_BLOCKS * SECONDS_PER_BLOCK) / 86_400
    expect(days).toBeCloseTo(7, 1)
  })

  it('the floor is six hours, not a number that happens to look small', () => {
    expect((MIN_WINDOW_BLOCKS * SECONDS_PER_BLOCK) / 3600).toBeCloseTo(6, 1)
  })

  it('narrowing can actually REACH the floor within the attempt budget', () => {
    // `MAX_NARROWING_ATTEMPTS` too low makes the floor unreachable while the code still claims to
    // have narrowed as far as it could. Asserted arithmetically so the three constants cannot
    // drift apart silently.
    let blocks = ACTIVITY_WINDOW_BLOCKS
    let halvings = 0
    while (blocks > MIN_WINDOW_BLOCKS) {
      blocks = Math.max(MIN_WINDOW_BLOCKS, Math.floor(blocks / 2))
      halvings++
    }
    expect(halvings + 1).toBeLessThanOrEqual(MAX_NARROWING_ATTEMPTS)
  })
})

describe('a span is described the way a person would say it', () => {
  const blocksFor = (seconds: number) => Math.round(seconds / SECONDS_PER_BLOCK)

  it('names the unit a reader thinks in', () => {
    expect(describeSpan(ACTIVITY_WINDOW_BLOCKS)).toBe('7 days')
    expect(describeSpan(blocksFor(3 * 86_400))).toBe('3 days')
    expect(describeSpan(blocksFor(30 * 3600))).toBe('1 day')
    expect(describeSpan(blocksFor(6 * 3600))).toBe('6 hours')
    expect(describeSpan(blocksFor(3600))).toBe('1 hour')
  })

  it('rounds DOWN, so the window is never described as reaching further than it does', () => {
    // A reader is deciding whether their transaction should be in this list. Overstating the
    // reach is what makes them conclude it is missing rather than out of range.
    expect(describeSpan(blocksFor(23 * 3600))).toBe('23 hours')
    // 47 hours is one day and twenty-three; "1 day" understates it, which is the safe direction.
    expect(describeSpan(blocksFor(47 * 3600))).toBe('1 day')
    expect(describeSpan(blocksFor(71 * 3600))).toBe('2 days')
    expect(describeSpan(blocksFor(59 * 60))).toBe('under an hour')
    expect(describeSpan(0)).toBe('under an hour')
  })
})
