import { useSyncExternalStore } from 'react'
import type { FeedFrame, PricePoint, TapeItem, WirePrice } from '@strk20/protocol/chain-feed-wire'

import { queryClient } from '@/app/query-client'
import { RelayerError, relayerStream } from '@/lib/relayer'
import { launchesQuery, marketsQuery } from './app'

export type ChainFeedState = 'off' | 'connecting' | 'live' | 'retrying' | 'polling'

/**
 * The genuinely live, non-cacheable part of the stream. Market and launch ROWS are not here: the
 * stream writes them straight into `marketsQuery` / `launchesQuery`, so TanStack holds the one copy
 * and owns the poll fallback (`refetchInterval` while the feed is not live).
 */
export interface ChainFeed {
  state: ChainFeedState
  /** Latest reading per pair, the full wire form so staleness stays honest. */
  prices: Readonly<Record<string, WirePrice>>
  /** Per pair, oldest first. */
  history: Readonly<Record<string, readonly PricePoint[]>>
  tape: readonly TapeItem[]
  /** One sentence when part of the picture is missing. Rows that arrived still render. */
  problem: string | null
}

const STREAM_PATH = '/api/chain/stream'
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const
const TAPE_KEEP = 120

const EMPTY: ChainFeed = { state: 'off', prices: {}, history: {}, tape: [], problem: null }

// The one socket every venue shares. Module-level because it is a live subscription, not a cache.
let snapshot: ChainFeed = EMPTY
const listeners = new Set<() => void>()
let controller: AbortController | null = null
let started = false

function patch(next: Partial<ChainFeed>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function appendPrice(price: WirePrice): void {
  const held = snapshot.history[price.pair] ?? []
  const last = held[held.length - 1]
  patch({
    prices: { ...snapshot.prices, [price.pair]: price },
    // A reconnect's hello can repeat the tail; the line moves only on a changed value.
    history: last?.p === price.price ? snapshot.history : { ...snapshot.history, [price.pair]: [...held, { t: price.at, p: price.price }] },
  })
}

async function onFrame(frame: FeedFrame): Promise<void> {
  const { marketFromWire, launchFromWire, seriesFromWire } = await import('@strk20/protocol/chain-feed-wire')
  switch (frame.t) {
    case 'hello':
      queryClient.setQueryData(marketsQuery().queryKey, {
        markets: frame.markets.map(marketFromWire),
        series: frame.series.map(seriesFromWire),
        total: frame.marketsTotal,
        nowSec: frame.nowSec,
        problem: null,
      })
      queryClient.setQueryData(launchesQuery().queryKey, { launches: frame.launches.map(launchFromWire), total: frame.launchesTotal, problem: null })
      patch({
        prices: Object.fromEntries(frame.prices.map((p) => [p.pair, p])),
        history: frame.history,
        tape: frame.tape,
        problem: frame.problem,
      })
      return
    case 'markets':
      queryClient.setQueryData(marketsQuery().queryKey, {
        markets: frame.markets.map(marketFromWire),
        series: frame.series.map(seriesFromWire),
        total: frame.total,
        nowSec: frame.nowSec,
        problem: null,
      })
      return
    case 'launches':
      queryClient.setQueryData(launchesQuery().queryKey, { launches: frame.launches.map(launchFromWire), total: frame.total, problem: null })
      return
    case 'price':
      appendPrice(frame.price)
      return
    case 'tape':
      patch({ tape: [...snapshot.tape, ...frame.items].slice(-TAPE_KEEP) })
      return
    case 'health':
      patch({ problem: frame.problem })
      return
  }
}

// ── Stream: reconnect forever with a backoff ramp; a 503 means "at capacity", consumers poll ──

async function runStream(): Promise<void> {
  let attempt = 0
  while (controller && !controller.signal.aborted) {
    const signal = controller.signal
    try {
      patch({ state: attempt === 0 ? 'connecting' : 'retrying' })
      let sawHello = false
      await relayerStream<unknown>(
        STREAM_PATH,
        {},
        (frame) => {
          void (async () => {
            const { isFeedFrame } = await import('@strk20/protocol/chain-feed-wire')
            if (!isFeedFrame(frame)) return
            if (!sawHello) {
              sawHello = true
              attempt = 0
              patch({ state: 'live' })
            }
            await onFrame(frame)
          })()
        },
        signal,
      )
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof RelayerError && error.status === 503) patch({ state: 'polling' })
    }
    if (signal.aborted) return
    if (snapshot.state !== 'polling') patch({ state: 'retrying' })
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
    attempt += 1
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

function openStream(): void {
  if (controller) return
  controller = new AbortController()
  void runStream()
}

function closeStream(): void {
  controller?.abort()
  controller = null
}

function ensureStarted(): void {
  if (started) return
  started = true
  openStream()
  // A hidden tab holds no socket; returning reopens it and the hello resyncs everything.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') openStream()
    else {
      closeStream()
      patch({ state: 'retrying' })
    }
  })
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The feed, live. Mounting this anywhere starts the one subscription; it outlives every mount. */
export function useChainFeed(): ChainFeed {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
}

/** The venue rows' poll cadence: off while the stream feeds the cache, 30 s otherwise. */
export const FEED_FALLBACK_POLL_MS = 30_000
