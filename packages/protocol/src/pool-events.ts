//
// Pool events — the bounded read. The decoders live in `pool-event-decoders.ts`.
//
// This is the only thing in the story that touches a chain over a RANGE rather than at a point,
// so it is the only thing that can run away: `fromBlock` is required, pages are capped, and a
// walk that stopped early says so with `complete: false`.
//

import { NET } from './constants.js'
import { withFallback } from './rpc.js'
import { POOL_EVENT_NAMES, poolEventSelector, type PoolEventName } from './pool-event-decoders.js'

export * from './pool-event-decoders.js'

/**
 * How many events one RPC request asks for by default. 100 so a caller can render its first page
 * while later ones arrive; a caller that does not render incrementally should ask for more
 * (measured 2026-08-27: a week of history is 30 round trips at 100, 6 at the ceiling).
 */
export const EVENT_CHUNK_SIZE = 100

/** The documented ceiling on `starknet_getEvents`. A clamp, not a suggestion — beyond it hosts refuse. */
export const MAX_EVENT_CHUNK_SIZE = 1000

/** The most pages one call walks before it stops and SAYS it stopped (`complete: false`). */
export const MAX_EVENT_PAGES = 64

/** One event as the RPC returned it, before any field is understood. */
export interface RawPoolEvent {
  keys: string[]
  data: string[]
  blockNumber: number
  transactionHash: string
}

/**
 * A resume token, bound to the host that issued it. A continuation token is an opaque,
 * host-specific cursor; the two RPC hosts index independently, so a resume is pinned to its
 * issuer and REFUSES elsewhere rather than silently returning somebody else's page.
 */
export interface EventCursor {
  token: string
  /** The `nodeUrl` of the host that minted `token`. */
  host: string
}

/** The outcome of one bounded read. */
export interface PoolEventPage {
  events: RawPoolEvent[]
  /** The range actually asked for — echoed back so a caller can page from where this stopped. */
  fromBlock: number
  toBlock: number
  /** False when the page cap stopped the walk before the chain ran out: a window, not a history. */
  complete: boolean
  pagesRead: number
  /** Where to resume when `complete` is false. `null` when the range was exhausted. */
  continuation: EventCursor | null
}

/** What a bounded read needs. `fromBlock` has no default, which is the bound. */
export interface ReadPoolEventsOptions {
  /** REQUIRED: there is no overload that reads from genesis. */
  fromBlock: number
  /** The last block to read. Defaults to the live head, read through the same fallback. */
  toBlock?: number
  /** Which events to ask for. Defaults to all seven. */
  names?: readonly PoolEventName[]
  /**
   * Another contract's events, by address and selector. The pool is the default; a helper we
   * deployed (the Mailbox) reads through the same bounded loop rather than its own.
   */
  address?: string
  selectors?: readonly string[]
  chunkSize?: number
  maxPages?: number
  /** Resume cursor from a previous page whose `complete` was false. Pinned to its issuing host. */
  continuation?: EventCursor
  /** Injected by tests: the paged reader, instead of a live RPC. */
  getEvents?: (request: EventRequest) => Promise<{ events: unknown[]; continuation_token?: string }>
}

/** The request shape the RPC takes, named so a test seam has something to assert on. */
export interface EventRequest {
  address: string
  from_block: { block_number: number }
  to_block: { block_number: number }
  keys: string[][]
  chunk_size: number
  continuation_token?: string
}

/**
 * Reads pool events over a bounded block range, following continuation tokens up to a cap.
 * The whole loop runs inside ONE `withFallback` attempt so every page comes from the same host.
 * A range whose start is above its end returns an empty, COMPLETE page rather than throwing.
 */
export async function readPoolEvents(options: ReadPoolEventsOptions): Promise<PoolEventPage> {
  const { fromBlock } = options

  // Every bound is validated BEFORE a provider is chosen, so a bad call costs no round trip.
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(`fromBlock must be a whole block height, not ${String(fromBlock)}`)
  }
  if (options.toBlock !== undefined && (!Number.isInteger(options.toBlock) || options.toBlock < 0)) {
    throw new Error(`toBlock must be a whole block height, not ${String(options.toBlock)}`)
  }
  if (options.chunkSize !== undefined && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1)) {
    throw new Error(`chunkSize must be at least 1, not ${String(options.chunkSize)}`)
  }
  if (options.maxPages !== undefined && (!Number.isInteger(options.maxPages) || options.maxPages < 1)) {
    throw new Error(`maxPages must be at least 1, not ${String(options.maxPages)}`)
  }

  const address = options.address ?? NET.pool
  const selectors = options.selectors ?? (options.names ?? POOL_EVENT_NAMES).map(poolEventSelector)
  // `keys: [[]]` is starknet's "match anything" wildcard — an empty list would be the firehose.
  if (selectors.length === 0) {
    throw new Error(
      'readPoolEvents was asked for zero event types. An empty key filter matches every event ' +
        'the contract emits, so this is refused rather than silently read as "all of them".',
    )
  }

  // Clamped to the SPEC ceiling, not to the default — a bigger chunk was a deliberate trade.
  const chunkSize = Math.min(options.chunkSize ?? EVENT_CHUNK_SIZE, MAX_EVENT_CHUNK_SIZE)
  const maxPages = Math.min(options.maxPages ?? MAX_EVENT_PAGES, MAX_EVENT_PAGES)
  const resume = options.continuation

  return withFallback(async (provider) => {
    // A resume is pinned to its issuer; refusing here lets the fallback move on to the next host.
    const host = provider.channel.nodeUrl
    if (resume && resume.host !== host) {
      throw new Error(
        `this continuation cursor was issued by ${resume.host} and cannot be resumed against ` +
          `${host}: a continuation token is an opaque, host-specific cursor.`,
      )
    }

    const toBlock = options.toBlock ?? (await provider.getBlockNumber())
    if (fromBlock > toBlock) {
      return { events: [], fromBlock, toBlock, complete: true, pagesRead: 0, continuation: null }
    }

    const read =
      options.getEvents ??
      ((request: EventRequest) => provider.getEvents(request as never) as Promise<{ events: unknown[]; continuation_token?: string }>)

    const events: RawPoolEvent[] = []
    let continuation = resume?.token
    let pagesRead = 0

    do {
      const page = await read({
        address,
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        // ONE inner array: `[[a, b, c]]` means "keys[0] is any of a, b, c"; `[[a], [b]]` would
        // filter keys[1] on a note id and match nothing.
        keys: [[...selectors]],
        chunk_size: chunkSize,
        ...(continuation === undefined ? {} : { continuation_token: continuation }),
      })
      for (const raw of page.events ?? []) events.push(toRawEvent(raw))
      continuation = page.continuation_token
      pagesRead += 1
    } while (continuation && pagesRead < maxPages)

    return {
      events,
      fromBlock,
      toBlock,
      complete: !continuation,
      pagesRead,
      continuation: continuation === undefined ? null : { token: continuation, host },
    }
  })
}

/**
 * Normalizes one RPC event into the shape the decoders take. Both identifiers are REQUIRED: a
 * missing block would become a row claiming block 0, and a defaulted hash would collapse every
 * hash-less event into one synthetic transaction sharing ids and fees (a pending-block event has
 * no business in a settled record). Element types are checked rather than cast.
 */
export function toRawEvent(raw: unknown): RawPoolEvent {
  const e = (raw ?? {}) as {
    keys?: unknown
    data?: unknown
    block_number?: unknown
    transaction_hash?: unknown
  }
  const blockNumber = e.block_number
  if (typeof blockNumber !== 'number' || !Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new Error(`a pool event arrived without a usable block number: ${JSON.stringify(blockNumber)}`)
  }
  const transactionHash = e.transaction_hash
  if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
    throw new Error(
      `a pool event in block ${blockNumber} arrived without a transaction hash: ` +
        `${JSON.stringify(transactionHash)}. It is half of every entry id and the key a fee is ` +
        'joined on, so it cannot be defaulted.',
    )
  }
  return {
    keys: feltArray(e.keys, 'keys', blockNumber),
    data: feltArray(e.data, 'data', blockNumber),
    blockNumber,
    transactionHash,
  }
}

/** An event's `keys` or `data` as felt strings, or a classified failure. Absent means empty. */
function feltArray(value: unknown, field: string, blockNumber: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`a pool event in block ${blockNumber} carried a non-array ${field}`)
  }
  return value.map((element, index) => {
    if (typeof element === 'string') return element
    // Numbers are accepted and normalized; anything else is a response that is not an event.
    if (typeof element === 'number' || typeof element === 'bigint') return `0x${BigInt(element).toString(16)}`
    throw new Error(
      `a pool event in block ${blockNumber} carried a ${typeof element} at ${field}[${index}], ` +
        'which is not a felt',
    )
  })
}
