// The chain feed: this process asks the chain once, and every open tab gets the answer — PUBLIC
// state only (markets, launches, prices, app events). Live state rebuilds
// inside a tick; only the price history earns a file (`chain-feed-store.ts`). Every limit refuses.
import {
  defaultTransport,
  readLaunches,
  readMarkets,
  type OnChainLaunch,
  type OnChainMarket,
  type Transport,
} from '../../protocol/src/app-reads.js'
import {
  wireLaunch,
  wireMarket,
  wireSeries,
  type FeedFrame,
  type TapeItem,
  type WirePrice,
} from '../../protocol/src/chain-feed-wire.js'
import type { PragmaReading } from '../../protocol/src/pragma-pairs.js'
import { PriceHistoryStore, countPoints, pushPoint, type PriceHistory } from './chain-feed-store.js'
import { decodeTapeEvent, type RawEvent, type TapeSource } from './chain-feed-tape.js'
import type { OnChainSeries } from '../../protocol/src/app-codecs.js'

export { HISTORY_BOUND } from './chain-feed-store.js'
export { EVENT_KEY, decodeTapeEvent } from './chain-feed-tape.js'

/** Markets, launches and the event tape move when a block lands; blocks land in tens of seconds. */
export const APP_POLL_MS = 10_000

/** The oracle cadence the browser used to poll at — now paid once for everybody. */
export const PRICE_POLL_MS = 15_000

/** Tape rows kept and replayed to a fresh subscriber. A feed, not an archive. */
export const TAPE_BOUND = 120

/** How far back the first tick looks for events. ~2000 blocks is hours of "recently". */
export const TAPE_LOOKBACK_BLOCKS = 2_000

/** One `starknet_getEvents` page, and how many of them one tick may burn per contract. */
const EVENT_PAGE_SIZE = 100
const MAX_EVENT_PAGES = 5

/** Streams held at once. Above this the answer is 503, and the browser falls back to polling. */
export const MAX_FEED_SUBSCRIBERS = 256

/** One connected stream. */
export interface FeedSubscriber {
  deliver(payload: string): void
  end(): void
}

export interface ChainFeedDeps {
  markets?: string
  launch?: string
  /** The Governor, or absent. Its events feed the Houses surfaces' activity. */
  governance?: string
  /** A function, not an oracle address, so the `starknet` import stays at the composition root. */
  readPrices?: () => Promise<PragmaReading[]>
  transport?: Transport
  /** The JSONL price-history file. Absent means history lives and dies with the process. */
  storePath?: string
  now?: () => number
  log?: (line: string) => void
  warn?: (line: string) => void
}

export interface ChainFeedStats {
  subscribers: number
  historyPoints: number
  tapeRows: number
}

export class ChainFeed {
  private readonly subscribers = new Set<FeedSubscriber>()
  private markets: OnChainMarket[] = []
  private series: OnChainSeries[] = []
  private marketsTotal = 0
  private launches: OnChainLaunch[] = []
  private launchesTotal = 0
  private prices = new Map<string, WirePrice>()
  private history: PriceHistory = new Map()
  private tape: TapeItem[] = []
  private problem: string | null = null
  private readonly store: PriceHistoryStore

  /** Last block whose events were folded into the tape, per contract. -1 means "not yet". */
  private scanned: Record<TapeSource, number> = { markets: -1, launch: -1, governance: -1 }

  private appTimer: ReturnType<typeof setInterval> | null = null
  private priceTimer: ReturnType<typeof setInterval> | null = null

  /** The last emitted wire form, kept so an unchanged read emits nothing. */
  private lastMarketsWire = ''
  private lastLaunchesWire = ''

  constructor(private readonly deps: ChainFeedDeps) {
    this.store = new PriceHistoryStore(deps.storePath, this.history, (l) => this.log(l), (l) => this.warn(l))
    this.store.warm()
  }

  subscribe(subscriber: FeedSubscriber): { ok: true; hello: string; unsubscribe: () => void } | { ok: false } {
    if (this.subscribers.size >= MAX_FEED_SUBSCRIBERS) return { ok: false }
    this.subscribers.add(subscriber)
    return {
      ok: true,
      hello: JSON.stringify(this.helloFrame()),
      unsubscribe: () => {
        this.subscribers.delete(subscriber)
      },
    }
  }

  helloFrame(): FeedFrame {
    return {
      t: 'hello',
      at: (this.deps.now ?? Date.now)(),
      markets: this.markets.map(wireMarket),
      series: this.series.map(wireSeries),
      marketsTotal: this.marketsTotal,
      launches: this.launches.map(wireLaunch),
      launchesTotal: this.launchesTotal,
      prices: [...this.prices.values()],
      history: Object.fromEntries(this.history),
      tape: [...this.tape],
      problem: this.problem,
    }
  }

  private broadcast(frame: FeedFrame): void {
    if (this.subscribers.size === 0) return
    const payload = JSON.stringify(frame)
    for (const subscriber of this.subscribers) {
      // One dead socket must not take the fan-out down with it.
      try {
        subscriber.deliver(payload)
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  start(): void {
    const tickApp = () => {
      void this.tickApp().catch((e: unknown) => this.warn(`chain feed: app tick failed — ${String(e)}`))
    }
    const tickPrices = () => {
      void this.tickPrices().catch((e: unknown) => this.warn(`chain feed: price tick failed — ${String(e)}`))
    }
    tickApp()
    tickPrices()
    this.appTimer = setInterval(tickApp, APP_POLL_MS)
    this.priceTimer = setInterval(tickPrices, PRICE_POLL_MS)
    // A feed timer must not hold the process open on shutdown.
    this.appTimer.unref?.()
    this.priceTimer.unref?.()
  }

  stop(): void {
    if (this.appTimer) clearInterval(this.appTimer)
    if (this.priceTimer) clearInterval(this.priceTimer)
    for (const subscriber of this.subscribers) {
      try {
        subscriber.end()
      } catch {
        // Already gone.
      }
    }
    this.subscribers.clear()
  }

  /** Markets, launches, and their event tape — one tick, one block-number read. */
  async tickApp(): Promise<void> {
    const transport = this.deps.transport ?? defaultTransport
    const problems: string[] = []

    if (this.deps.markets) {
      try {
        const out = await readMarkets(this.deps.markets, { transport })
        if (out.problem) problems.push(out.problem)
        const markets = out.markets.map(wireMarket)
        const series = out.series.map(wireSeries)
        const wire = JSON.stringify({ markets, series })
        if (wire !== this.lastMarketsWire || out.total !== this.marketsTotal) {
          this.markets = out.markets
          this.series = out.series
          this.marketsTotal = out.total
          this.lastMarketsWire = wire
          this.broadcast({ t: 'markets', markets, series, total: out.total })
        }
      } catch (e) {
        problems.push(`The markets could not be read: ${String(e)}`)
      }
    }

    if (this.deps.launch) {
      try {
        const out = await readLaunches(this.deps.launch, { transport })
        if (out.problem) problems.push(out.problem)
        const wire = JSON.stringify(out.launches.map(wireLaunch))
        if (wire !== this.lastLaunchesWire || out.total !== this.launchesTotal) {
          this.launches = out.launches
          this.launchesTotal = out.total
          this.lastLaunchesWire = wire
          this.broadcast({ t: 'launches', launches: out.launches.map(wireLaunch), total: out.total })
        }
      } catch (e) {
        problems.push(`The launches could not be read: ${String(e)}`)
      }
    }

    try {
      await this.tickTape(transport)
    } catch (e) {
      problems.push(`The activity tape could not be read: ${String(e)}`)
    }

    const sentence = problems.length ? problems.join(' ') : null
    if (sentence !== this.problem) {
      this.problem = sentence
      this.broadcast({ t: 'health', problem: sentence })
    }
  }

  private async tickTape(transport: Transport): Promise<void> {
    const sources: Array<[TapeSource, string]> = []
    if (this.deps.markets) sources.push(['markets', this.deps.markets])
    if (this.deps.launch) sources.push(['launch', this.deps.launch])
    if (this.deps.governance) sources.push(['governance', this.deps.governance])
    if (sources.length === 0) return

    const latestRaw = await transport('starknet_blockNumber', [])
    const latest = typeof latestRaw === 'number' ? latestRaw : Number(latestRaw)
    if (!Number.isFinite(latest)) throw new Error('starknet_blockNumber did not answer a number')

    const fresh: TapeItem[] = []
    for (const [source, address] of sources) {
      const from = this.scanned[source] >= 0 ? this.scanned[source] + 1 : Math.max(0, latest - TAPE_LOOKBACK_BLOCKS)
      if (from > latest) continue
      let token: string | undefined
      for (let page = 0; page < MAX_EVENT_PAGES; page++) {
        const result = (await transport('starknet_getEvents', {
          filter: {
            address,
            from_block: { block_number: from },
            to_block: { block_number: latest },
            chunk_size: EVENT_PAGE_SIZE,
            ...(token ? { continuation_token: token } : {}),
          },
        })) as { events?: unknown; continuation_token?: unknown }
        const events = Array.isArray(result.events) ? (result.events as RawEvent[]) : []
        for (const ev of events) {
          const item = decodeTapeEvent(source, ev)
          if (item) fresh.push(item)
        }
        token = typeof result.continuation_token === 'string' ? result.continuation_token : undefined
        if (!token) break
        // A backlog beyond one tick's budget catches up next tick — nothing is lost.
      }
      this.scanned[source] = latest
    }

    if (fresh.length === 0) return
    fresh.sort((a, b) => a.block - b.block)
    this.tape = [...this.tape, ...fresh].slice(-TAPE_BOUND)
    this.broadcast({ t: 'tape', items: fresh })
  }

  async tickPrices(): Promise<void> {
    if (!this.deps.readPrices) return
    const readings = await this.deps.readPrices()
    const at = (this.deps.now ?? Date.now)()

    for (const reading of readings) {
      if (!reading.ok) continue
      const { pair, price, decimals, timestamp, sources } = reading.price
      const wire = { pair, price, decimals, timestamp, sources, at }
      const held = this.prices.get(pair)
      this.prices.set(pair, wire)
      // The line moves only on a CHANGE, so a stalled oracle does not draw a steady market.
      if (held?.price === price) continue

      pushPoint(this.history, pair, { t: at, p: price })
      this.store.append(pair, { t: at, p: price })
      this.broadcast({ t: 'price', price: wire })
    }
  }

  stats(): ChainFeedStats {
    return {
      subscribers: this.subscribers.size,
      historyPoints: countPoints(this.history),
      tapeRows: this.tape.length,
    }
  }

  private log(line: string): void {
    ;(this.deps.log ?? console.log)(line)
  }

  private warn(line: string): void {
    ;(this.deps.warn ?? console.warn)(line)
  }
}
