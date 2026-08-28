//
// The chain-feed store: one connection to the relayer's feed, one snapshot every surface reads.
//
// THE HOUSE PATTERN — a module singleton over `useSyncExternalStore`, like `chat-bus.ts` beside
// it — because the feed is one connection shared by every surface, and Context would re-render
// the tree to deliver what is really an external subscription.
//
// STREAM FIRST, POLL AS THE FALLBACK, AND BOTH LIVE HERE. The relayer's `/api/chain/stream`
// carries markets, launches, prices (with the history this tab was not open to witness), and the
// contracts' event tape. When the stream is anything but live, this store polls the same reads
// the surfaces always polled — through `pollWhileVisible`, so a hidden tab spends nothing — and
// the surfaces cannot tell which engine fed them. A dead relayer degrades to "slower", never to
// "blank", and never to a surface's problem.
//
// THE BUILD GATE SHAPES THE IMPORTS: `chain-feed-client.ts` and `chain-feed-wire.ts` are pure and
// eager-safe; `app-reads.ts` is fetch-only and already eager; the pragma reader reaches
// `starknet` and stays behind a dynamic import exactly as `use-pragma.ts` kept it.
//
import { useSyncExternalStore } from 'react'

import {
  launchFromWire,
  marketFromWire,
  type FeedFrame,
  type PricePoint,
  type TapeItem,
  type WirePrice,
} from '@strk20/protocol/chain-feed-wire'
import { openChainFeed, type ChainFeedHandle, type ChainFeedState } from '@strk20/protocol/chain-feed-client'
import { readLaunches, readMarkets, type OnChainLaunch, type OnChainMarket } from '@strk20/protocol/app-reads'
import { PRAGMA_PAIR_LIST } from '@strk20/protocol/pragma-pairs'

import { APP_CONTRACTS, PRAGMA_ORACLE } from './app-contracts'
import { pollWhileVisible } from './poll-while-visible'

/** Fallback cadences — the numbers the surfaces polled at before the feed existed. */
const FALLBACK_APP_MS = 30_000
const FALLBACK_PRICE_MS = 15_000

export interface ChainFeedSnapshot {
  /** The socket's honest state. `off` until the first surface asks for the feed. */
  stream: ChainFeedState | 'off'
  markets: OnChainMarket[]
  marketsTotal: number
  launches: OnChainLaunch[]
  launchesTotal: number
  /** Latest reading per pair — the full wire form, staleness fields included. */
  prices: Readonly<Record<string, WirePrice>>
  /** Per pair, oldest first. Server history when the stream answered; this session's otherwise. */
  history: Readonly<Record<string, readonly PricePoint[]>>
  tape: readonly TapeItem[]
  /** True once markets/launches have been answered by EITHER engine — the "has anything looked" bit. */
  appAnswered: boolean
  /** Same bit for prices. */
  pricesAnswered: boolean
  /** One sentence when part of the picture is missing. Rows that arrived still render. */
  problem: string | null
}

const EMPTY: ChainFeedSnapshot = {
  stream: 'off',
  markets: [],
  marketsTotal: 0,
  launches: [],
  launchesTotal: 0,
  prices: {},
  history: {},
  tape: [],
  appAnswered: false,
  pricesAnswered: false,
  problem: null,
}

let snapshot: ChainFeedSnapshot = EMPTY
const listeners = new Set<() => void>()

function patch(next: Partial<ChainFeedSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

// ── The stream engine ─────────────────────────────────────────────────────────────────────

let handle: ChainFeedHandle | null = null
let started = false
let streamLive = false

function onFrame(frame: FeedFrame): void {
  switch (frame.t) {
    case 'hello': {
      patch({
        markets: frame.markets.map(marketFromWire),
        marketsTotal: frame.marketsTotal,
        launches: frame.launches.map(launchFromWire),
        launchesTotal: frame.launchesTotal,
        prices: Object.fromEntries(frame.prices.map((p) => [p.pair, p])),
        history: frame.history,
        tape: frame.tape,
        appAnswered: true,
        pricesAnswered: true,
        problem: frame.problem,
      })
      return
    }
    case 'markets':
      patch({ markets: frame.markets.map(marketFromWire), marketsTotal: frame.total, appAnswered: true })
      return
    case 'launches':
      patch({ launches: frame.launches.map(launchFromWire), launchesTotal: frame.total, appAnswered: true })
      return
    case 'price': {
      const { price } = frame
      const held = snapshot.history[price.pair] ?? []
      const last = held[held.length - 1]
      patch({
        prices: { ...snapshot.prices, [price.pair]: price },
        // The server only sends a `price` frame on a change, but a reconnect's hello followed by
        // a delta can repeat the tail — appending only on a changed value keeps the line honest.
        history:
          last?.p === price.price
            ? snapshot.history
            : { ...snapshot.history, [price.pair]: [...held, { t: price.at, p: price.price }] },
        pricesAnswered: true,
      })
      return
    }
    case 'tape':
      patch({ tape: [...snapshot.tape, ...frame.items].slice(-120) })
      return
    case 'health':
      patch({ problem: frame.problem })
      return
  }
}

function openStream(): void {
  if (handle) return
  handle = openChainFeed({
    onFrame,
    onState: (state) => {
      streamLive = state === 'live'
      patch({ stream: state })
    },
  })
}

function closeStream(): void {
  handle?.close()
  handle = null
  streamLive = false
}

// ── The fallback engine — the reads the surfaces always ran, now in one place ─────────────

let stopAppPoll: (() => void) | null = null
let stopPricePoll: (() => void) | null = null

function startFallbacks(): void {
  if (!stopAppPoll) {
    stopAppPoll = pollWhileVisible(() => {
      if (streamLive) return
      void pollAppOnce()
    }, FALLBACK_APP_MS)
  }
  if (!stopPricePoll) {
    stopPricePoll = pollWhileVisible(() => {
      if (streamLive) return
      void pollPricesOnce()
    }, FALLBACK_PRICE_MS)
  }
}

async function pollAppOnce(): Promise<void> {
  const problems: string[] = []
  if (APP_CONTRACTS.markets) {
    try {
      const out = await readMarkets(APP_CONTRACTS.markets)
      if (streamLive) return
      if (out.problem) problems.push(out.problem)
      patch({ markets: out.markets, marketsTotal: out.total, appAnswered: true })
    } catch (e) {
      problems.push(`The markets could not be read: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (APP_CONTRACTS.launch) {
    try {
      const out = await readLaunches(APP_CONTRACTS.launch)
      if (streamLive) return
      if (out.problem) problems.push(out.problem)
      patch({ launches: out.launches, launchesTotal: out.total, appAnswered: true })
    } catch (e) {
      problems.push(`The launches could not be read: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // A failed read keeps the previous rows standing — they were true when read — and adds the
  // sentence. Blanking a list on a flaky RPC would render "no markets" over markets.
  patch({ appAnswered: true, problem: problems.length ? problems.join(' ') : null })
}

async function pollPricesOnce(): Promise<void> {
  if (!PRAGMA_ORACLE) {
    patch({ pricesAnswered: true })
    return
  }
  try {
    // Lazy for the build gate's reason: `pragma.ts` reaches `rpc.ts`, which constructs an
    // `RpcProvider` from `starknet`. A static import here would sink the eager budget.
    const { readAllMedians } = await import('@strk20/protocol/pragma')
    const readings = await readAllMedians(PRAGMA_ORACLE, PRAGMA_PAIR_LIST)
    if (streamLive) return
    const at = Date.now()
    const prices = { ...snapshot.prices }
    const history = { ...snapshot.history }
    for (const reading of readings) {
      if (!reading.ok) continue
      const { pair, price, decimals, timestamp, sources } = reading.price
      prices[pair] = { pair, price, decimals, timestamp, sources, at }
      const held = history[pair] ?? []
      // The line moves only on a CHANGE — `use-pragma.ts`'s rule, kept through the migration.
      if (held[held.length - 1]?.p !== price) history[pair] = [...held, { t: at, p: price }]
    }
    patch({ prices, history, pricesAnswered: true })
  } catch (e) {
    patch({
      pricesAnswered: true,
      problem: `The price feed could not be loaded, so these are not live prices: ${String(e)}`,
    })
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────

function ensureStarted(): void {
  if (started) return
  started = true
  patch({ stream: 'connecting' })
  openStream()
  startFallbacks()
  // A hidden tab holds no socket — yosuku's measured lesson. The fallback pollers are already
  // visibility-aware, so hiding stops everything and returning restarts both engines at once.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      openStream()
    } else {
      closeStream()
      patch({ stream: 'retrying' })
    }
  })
}

function subscribe(listener: () => void): () => void {
  ensureStarted()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The snapshot, live. Mounting this anywhere starts the feed; the store outlives every mount. */
export function useChainFeed(): ChainFeedSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** For non-React callers (stores, tests). */
export function chainFeedSnapshot(): ChainFeedSnapshot {
  return snapshot
}
