//
// Reading the pool's recent events for a feed, without giving up the bound.
//
// ── THE TRAP THIS MODULE EXISTS FOR ──────────────────────────────────────────────────────
//
// `readPoolEvents` walks FORWARD from `fromBlock`, following continuation tokens until the range
// is exhausted or `MAX_EVENT_PAGES` stops it. So a read that hits the cap stopped part-way UP the
// range: it holds the OLDEST events in the window and is missing everything since.
//
// For a balance walk that is fine. For a FEED it is backwards — the rows a reader most needs are
// the ones truncation drops. A feed built on a capped read shows last week and silently omits this
// morning, and the natural sentence for it ("recent activity") is then false in the one direction
// that matters.
//
// ── NARROWING, NOT RESUMING ──────────────────────────────────────────────────────────────
//
// `PoolEventPage.continuation` would let a caller keep paging to the head. That is the first
// instinct and the wrong one: following the token until it stops is exactly the unbounded read
// `MAX_EVENT_PAGES` exists to prevent, spelled across several calls instead of one. The cap would
// become a formality.
//
// This keeps the bound and moves the window instead. Each attempt asks for half as many blocks,
// all of them nearer the present, so a busy pool yields a SHORT and COMPLETE view rather than a
// long one with its recent end shorn off. Round trips are bounded by `MAX_NARROWING_ATTEMPTS`,
// and in the ordinary case there is exactly one.
//
import {
  MAX_EVENT_CHUNK_SIZE,
  readPoolEvents,
  type EventRequest,
  type RawPoolEvent,
} from './pool-events.js'

/**
 * Seconds per Starknet mainnet block, MEASURED rather than assumed.
 *
 * 1.7s, taken across 20,000 real blocks on 2026-08-27 (block 13,899,686 → 13,919,686 spanned
 * 33,987 seconds). This number is here because guessing it wrong is not a rounding error: the
 * first draft of this module assumed the widely-quoted 30 seconds and sized a "roughly a week"
 * window that actually covered NINE HOURS. The account this app registered three days earlier
 * fell outside it, so the feed correctly reported an empty window for a pool that held the very
 * transaction the product was built to show.
 *
 * Starknet's block time has fallen steadily and will fall again. When it does, this constant is
 * the one thing to change, and the windows below follow from it.
 */
export const SECONDS_PER_BLOCK = 1.7

const blocksFor = (seconds: number) => Math.round(seconds / SECONDS_PER_BLOCK)

/**
 * How far back a feed looks: one week.
 *
 * A week is the shortest window in which a returning user reliably finds themselves — this app's
 * own mainnet registration is three days old, and the nine-hour window this constant used to
 * describe excluded it. Measured against mainnet on 2026-08-27 a week is 3,080 pool events read
 * in 8.5 seconds, one attempt, comfortably inside the page cap. It is still a WINDOW and the UI
 * has to say so.
 *
 * The read is not on the first-paint path: the balance walk renders first and this fills the feed
 * underneath it. Widening further is a decision about that wait, not a formality.
 */
export const ACTIVITY_WINDOW_BLOCKS = blocksFor(7 * 24 * 60 * 60)

/**
 * The narrowest window worth asking for before giving up on narrowing: six hours.
 *
 * A pool busy enough to overflow one bounded read across six hours is not a pool this can window
 * its way out of, and halving further would only spend round trips to arrive at the same
 * sentence. At that point the read is reported as truncated and described honestly, rather than
 * narrowed into uselessness.
 */
export const MIN_WINDOW_BLOCKS = blocksFor(6 * 60 * 60)

/**
 * The most reads one call will make.
 *
 * Enough for the window to halve all the way from a week to the six-hour floor — that is five
 * halvings, so six reads. A number too small silently makes the floor UNREACHABLE: an earlier
 * draft bottomed out one step short and gave up while claiming to have narrowed as far as it
 * could. The test `gives up at the floor` asserts the floor is actually arrived at, so this
 * cannot drift out of step with the two windows above without failing.
 *
 * Halving rather than quartering is deliberate even though quartering would get there faster: an
 * over-aggressive step lands on six hours of history when three days would have fitted, and the
 * pathological pool that needs every read is far rarer than the ordinary one that needs a single
 * one.
 */
export const MAX_NARROWING_ATTEMPTS = 6

/**
 * A block count as a span a person would say out loud: "3 days", "18 hours", "1 hour".
 *
 * Lives here, beside `SECONDS_PER_BLOCK`, because it is the same fact read the other way round —
 * a formatter kept anywhere else would need its own copy of the block rate, and two copies of a
 * number that changes is one copy too many.
 *
 * Rounds DOWN, deliberately. A window is being described to someone deciding whether their
 * transaction should be in it, and overstating the reach is the error that makes them conclude it
 * is missing rather than out of range.
 */
export function describeSpan(blocks: number): string {
  const hours = Math.floor((blocks * SECONDS_PER_BLOCK) / 3600)
  if (hours >= 48) return `${Math.floor(hours / 24)} days`
  if (hours >= 24) return '1 day'
  if (hours >= 2) return `${hours} hours`
  if (hours === 1) return '1 hour'
  return 'under an hour'
}

export interface RecentEventsOptions {
  /**
   * The height to read up to.
   *
   * Callers pass the height their balance walk was read BESIDE, not the live head, so a feed and
   * the balance above it describe the same moment. Reading to head instead puts rows on screen
   * that the balance has not yet accounted for.
   */
  toBlock: number
  /** Overrides the starting width. Present for tests; production wants the default. */
  windowBlocks?: number
  /** Injected by tests: the paged reader, instead of a live RPC. Passed straight through. */
  getEvents?: (request: EventRequest) => Promise<{ events: unknown[]; continuation_token?: string }>
}

export interface RecentEvents {
  events: readonly RawPoolEvent[]
  /**
   * False when even the narrowest window overflowed. The rows are then the START of that window
   * and do not reach `toBlock` — the caller MUST say so rather than calling them recent.
   */
  complete: boolean
  /** The width actually read. Below the starting width means narrowing happened. */
  blocks: number
  /** How many reads it took. 1 is the ordinary case. */
  attempts: number
}

/**
 * Read as far back as one bounded read can reach, ending at `toBlock`.
 *
 * Never throws for a truncation — that is a reported state, not an error. It does propagate a
 * read that FAILED, because a caller must not publish an empty feed as though the pool were empty.
 */
export async function readRecentEvents(options: RecentEventsOptions): Promise<RecentEvents> {
  const { toBlock, windowBlocks = ACTIVITY_WINDOW_BLOCKS, getEvents } = options

  if (!Number.isInteger(toBlock) || toBlock < 0) {
    throw new Error(`toBlock must be a whole block height, not ${String(toBlock)}`)
  }

  let blocks = Math.max(MIN_WINDOW_BLOCKS, windowBlocks)
  // Declared out here so the last attempt's page is what gets returned when narrowing runs out.
  // A truncated page is still rows; discarding it to return nothing would be strictly worse.
  let events: RawPoolEvent[] = []
  let complete = false
  let attempts = 0
  // THE WIDTH THAT WAS READ, not the width that would have been tried next. Reporting `blocks`
  // after the loop is the bug that reads correct and is not: on the attempt where narrowing runs
  // out, `blocks` has already been halved past the range that produced `events`, so the caller is
  // handed a number describing a read that never happened.
  let readBlocks = blocks

  for (let attempt = 0; attempt < MAX_NARROWING_ATTEMPTS; attempt++) {
    attempts++
    const fromBlock = Math.max(0, toBlock - blocks)
    // Measured from the clamped start, so a chain younger than the window reports the width it
    // actually has rather than the one that was asked for.
    readBlocks = toBlock - fromBlock

    // THE BIG CHUNK IS THE POINT. `EVENT_CHUNK_SIZE`'s default of 100 buys incremental rendering,
    // and this caller renders nothing until the whole page is in hand — so it pays 30 round trips
    // for a benefit it cannot collect. At the ceiling the same week is six.
    const page = await readPoolEvents({
      fromBlock,
      toBlock,
      chunkSize: MAX_EVENT_CHUNK_SIZE,
      getEvents,
    })
    events = page.events
    complete = page.complete
    if (complete) break

    // CHECKED AFTER THE READ, NOT BEFORE THE HALVING. At the floor the window cannot usefully
    // shrink further, so another attempt would re-read the same range and return the same answer.
    if (blocks <= MIN_WINDOW_BLOCKS) break
    blocks = Math.max(MIN_WINDOW_BLOCKS, Math.floor(blocks / 2))
  }

  return { events, complete, blocks: readBlocks, attempts }
}
