//
// The chain feed: this process asks the chain once, and every open tab gets the answer.
//
// A sibling of `rooms.ts`, and the comparison is the design. The RoomHub fans out ciphertext it
// cannot read; this hub fans out PUBLIC chain state it read itself — markets, launches, oracle
// prices, and the app contracts' own events. Nothing here is per-user, nothing is a secret, and
// nothing a subscriber sends selects anything, so the privacy analysis is one sentence: a
// connected stream tells the relayer someone has the app open, which the room stream it already
// holds said first.
//
// WHY THE RELAYER AND NOT THE BROWSER. N tabs polling markets+launches+three pairs is 5N chain
// reads per half-minute against public RPC hosts, every tab starting with an empty price history.
// This machine is one always-on process (fly.toml's argument) that already holds an RPC path —
// it reads once per tick, remembers a bounded history across everyone's page loads, and the
// browser's own read path demotes to a fallback for when this process is unreachable.
//
// MEMORY, PLUS ONE APPEND-ONLY FILE. The live state rebuilds itself from the chain inside a tick,
// so none of it earns a ledger — except the price history, whose whole value is the past this
// process witnessed and a redeploy would otherwise erase. That one series goes to a JSONL file on
// the volume (`RELAYER_CHAIN_FEED_STORE`), read back at boot, and every failure around that file
// degrades to "history starts now" rather than to a dead feed.
//
// EVERY LIMIT IS A REFUSAL, rooms.ts's rule: subscriber count, history length, tape length, event
// pages per tick — each turns an unbounded resource into a bounded one.
//
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

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
  type FeedFrame,
  type PricePoint,
  type TapeItem,
  type WirePrice,
} from '../../protocol/src/chain-feed-wire.js'
import type { PragmaReading } from '../../protocol/src/pragma-pairs.js'

/** Markets, launches and the event tape move when a block lands; blocks land in tens of seconds. */
export const APP_POLL_MS = 10_000

/** The oracle cadence the browser used to poll at — now paid once for everybody. */
export const PRICE_POLL_MS = 15_000

/** Readings kept per pair: 24 hours at the poll cadence. The chart's whole ambition. */
export const HISTORY_BOUND = 5_760

/** Tape rows kept and replayed to a fresh subscriber. A feed, not an archive. */
export const TAPE_BOUND = 120

/** How far back the first tick looks for events. ~2000 blocks is hours of "recently". */
export const TAPE_LOOKBACK_BLOCKS = 2_000

/** One `starknet_getEvents` page, and how many of them one tick may burn per contract. */
const EVENT_PAGE_SIZE = 100
const MAX_EVENT_PAGES = 5

/** Streams held at once. Above this the answer is 503, and the browser falls back to polling. */
export const MAX_FEED_SUBSCRIBERS = 256

/** Rewrite the JSONL once it holds this many lines; the tail is all anyone replays. */
const STORE_COMPACT_LINES = 60_000

// ── The app contracts' event selectors, pinned like `SELECTOR` in app-reads.ts. ───────────
// `chain-feed.test.ts` holds each to `hash.getSelectorFromName`, same discipline, same reason.
export const EVENT_KEY = {
  MarketCreated: '0x15d762f1fc581b3e684cf095d93d3a2c10754f60124b09bec8bf3d76473baaf',
  BetPlaced: '0x3714964c81efee0fe58ac4504b7913e0e777e5d0f90ab45fc44568dd4ca88c1',
  MarketResolved: '0x3a69063a7ce6bf68928eda97af8f80e63b16ada5f75dacc66f432ab2683963',
  MarketVoided: '0x22e796813637e01cc55546e5af27911e667117f1ddf02dad9709e6194aeb423',
  Claimed: '0x35cc0235f835cc84da50813dc84eb10a75e24a21d74d6d86278c0f037cb7429',
  CashedOut: '0x1e27bebcd46bc944065dc93e3f3b8d71b4ffe68d6cfca1ee14301239a41b01f',
  LaunchCreated: '0x357d68fbe7a6a30028c88b1094efd4614d9eed65cf27f0d40da9c405a629a12',
  Bought: '0x20cb8131637de1953a75938db3477cc6b648e5ed255f5b3fe3f0fb9299f0afc',
  Graduated: '0x36c2bc6e1f3df003a7f84d1a6f715017a63a49e4cf2f4d6c448a3b271423543',
  Failed: '0x29b6695cc078fec6f5eaa1763a4568ff856dfa63ebfa86719d6a43e911ffb23',
  Redeemed: '0x23e7cec2fb91669c83bda0a76c5b9291e64043ae4d6c7dece25843a6a1124ae',
  Refunded: '0x1e3aa8099bfbb7b9fee513355876c379349ac1dca81cd9eb4e0653e784ff985',
  // The Governor's public history — the events were always emitted; nothing consumed them.
  HouseCreated: '0x2553dfcdac928ed8545204c4385fa899d589476a55fae013f5c53a0718c919f',
  ProposalCreated: '0x2c0d1d9d0efb5c7398b67924974bb430e0de82d366c7ee89e068943383c0181',
  BallotCast: '0x22533cc45c07d80b456838832204cdd6d1f5a258aea753af84470c65b830573',
  Joined: '0xe186c9f9ae6099cab4fdeed472d27d45d775496082bf874ded47d4058dfc7c',
  TreasuryFunded: '0x314a49f14ef9154e2bc7f4f0c7b6453d83c74e3ae63ceca7f5a1cfe209d6d5c',
  TallyPublished: '0x18f4c17a4677ce43e2ebdc7476b4c9a54407ba407d3f83ae5618780212aa137',
  KeyPublished: '0xeff458ede0c729d0265ba767fc2c494b2b9e388296fdfe9f57c18d4f02d370',
  Executed: '0x1f4317aae43f6c24b2b85c6d8b21d5fa0a28cee0476cd52ca5d60d4787aab78',
  ProposalVoided: '0x3fc7d79ef885017803ff9a4b389bcd2ab4e4d2ec92a89e6aea2557fb81bd4c7',
} as const

/** One connected stream. The same testability argument as `RoomSubscriber`, verbatim. */
export interface FeedSubscriber {
  deliver(payload: string): void
  end(): void
}

interface RawEvent {
  keys?: unknown
  data?: unknown
  transaction_hash?: unknown
  block_number?: unknown
}

export interface ChainFeedDeps {
  /** The Markets contract, or absent — the feed carries what is deployed and says so. */
  markets?: string
  /** The Launch contract, or absent. */
  launch?: string
  /** The Governor, or absent. Its events feed the Houses surfaces' activity. */
  governance?: string
  /**
   * The price reader. A function rather than an oracle address so the `starknet`-reaching
   * import (`pragma.ts` → `rpc.ts`) stays at the composition root and tests need no chain.
   */
  readPrices?: () => Promise<PragmaReading[]>
  /** JSON-RPC seam, app-reads' shape. Defaults to the shared host-failover transport. */
  transport?: Transport
  /** The JSONL price-history file. Absent means history lives and dies with the process. */
  storePath?: string
  now?: () => number
  log?: (line: string) => void
  warn?: (line: string) => void
}

const toNum = (felt: string): number => Number(BigInt(felt))

const felt = (value: unknown): string | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) ? value : null

/**
 * One raw event into a tape row, or null for anything that does not decode.
 *
 * Null, never a throw: the tape is a convenience rendering of public history, and one undecodable
 * event — a contract upgrade, a struct edit, RPC noise — must cost that row, not the feed.
 */
export function decodeTapeEvent(
  source: 'markets' | 'launch' | 'governance',
  ev: RawEvent,
): TapeItem | null {
  if (!Array.isArray(ev.keys) || !Array.isArray(ev.data)) return null
  const keys = ev.keys.map(felt)
  const data = ev.data.map(felt)
  if (keys.some((k) => k === null) || data.some((d) => d === null)) return null
  const txHash = felt(ev.transaction_hash)
  const block = typeof ev.block_number === 'number' ? ev.block_number : null
  if (txHash === null || block === null || keys.length === 0) return null

  const key = BigInt(keys[0] as string)
  const k = (name: keyof typeof EVENT_KEY) => key === BigInt(EVENT_KEY[name])
  const at = (list: (string | null)[], i: number): string => list[i] as string

  try {
    if (source === 'markets') {
      const marketId = keys.length > 1 ? toNum(at(keys, 1)) : 0
      if (k('MarketCreated') && data.length >= 7) {
        return {
          kind: 'market-created',
          marketId,
          pair: decodePairShortString(at(data, 0)),
          strike: at(data, 1),
          deadline: toNum(at(data, 2)),
          txHash,
          block,
        }
      }
      if (k('BetPlaced') && data.length >= 6) {
        return {
          kind: 'bet',
          marketId,
          side: toNum(at(data, 0)),
          amount: at(data, 1),
          upAfter: at(data, 3),
          downAfter: at(data, 4),
          txHash,
          block,
        }
      }
      if (k('MarketResolved') && data.length >= 3) {
        return { kind: 'market-resolved', marketId, winner: toNum(at(data, 0)), settlePrice: at(data, 1), txHash, block }
      }
      if (k('MarketVoided')) return { kind: 'market-voided', marketId, txHash, block }
      // Claimed and CashedOut carry the commitment in the key slot and the market id in data.
      if (k('Claimed') && data.length >= 3) {
        return { kind: 'market-claim', marketId: toNum(at(data, 0)), amount: at(data, 1), txHash, block }
      }
      if (k('CashedOut') && data.length >= 3) {
        return {
          kind: 'market-cashout',
          marketId: toNum(at(data, 0)),
          tickets: at(data, 1),
          amount: at(data, 2),
          txHash,
          block,
        }
      }
      return null
    }

    if (source === 'governance') {
      // Every Governor event carries its entity id as the single #[key] after the selector.
      const entityId = keys.length > 1 ? toNum(at(keys, 1)) : 0
      if (k('HouseCreated') && data.length >= 3) {
        return { kind: 'house-created', houseId: entityId, token: at(data, 0), txHash, block }
      }
      if (k('ProposalCreated') && data.length >= 6) {
        return {
          kind: 'proposal-created',
          proposalId: entityId,
          houseId: toNum(at(data, 0)),
          deadline: toNum(at(data, 3)),
          txHash,
          block,
        }
      }
      // `sealed` (choice ciphertext) rides the event past the weight; the tape carries the
      // PUBLIC half only — weight and sequence — the same split §4.2 draws for the chain itself.
      if (k('BallotCast') && data.length >= 3) {
        return { kind: 'gov-ballot', proposalId: entityId, weight: at(data, 1), seq: toNum(at(data, 2)), txHash, block }
      }
      if (k('Joined') && data.length >= 1) {
        return { kind: 'gov-joined', houseId: entityId, memberCount: toNum(at(data, 0)), txHash, block }
      }
      if (k('TreasuryFunded') && data.length >= 2) {
        return {
          kind: 'treasury-funded',
          houseId: entityId,
          amount: at(data, 0),
          treasuryAfter: at(data, 1),
          txHash,
          block,
        }
      }
      if (k('TallyPublished') && data.length >= 4) {
        return {
          kind: 'tally-published',
          proposalId: entityId,
          tallyFor: at(data, 0),
          tallyAgainst: at(data, 1),
          outcome: toNum(at(data, 3)),
          txHash,
          block,
        }
      }
      if (k('KeyPublished') && data.length >= 1) {
        return { kind: 'key-published', proposalId: entityId, txHash, block }
      }
      if (k('Executed') && data.length >= 2) {
        return { kind: 'gov-executed', proposalId: entityId, amount: at(data, 1), txHash, block }
      }
      if (k('ProposalVoided')) {
        return { kind: 'proposal-voided', proposalId: entityId, txHash, block }
      }
      return null
    }

    const launchId = keys.length > 1 ? toNum(at(keys, 1)) : 0
    if (k('LaunchCreated') && data.length >= 7) {
      return { kind: 'launch-created', launchId, deadline: toNum(at(data, 5)), txHash, block }
    }
    if (k('Bought') && data.length >= 5) {
      return {
        kind: 'buy',
        launchId,
        epoch: toNum(at(data, 0)),
        units: toNum(at(data, 1)),
        cost: at(data, 2),
        soldAfter: toNum(at(data, 3)),
        txHash,
        block,
      }
    }
    if (k('Graduated') && data.length >= 1) {
      return { kind: 'graduated', launchId, token: at(data, 0), txHash, block }
    }
    if (k('Failed') && data.length >= 2) {
      return { kind: 'launch-failed', launchId, sold: toNum(at(data, 0)), raised: at(data, 1), txHash, block }
    }
    if (k('Redeemed') && data.length >= 3) {
      return { kind: 'redeem', launchId: toNum(at(data, 0)), units: toNum(at(data, 1)), amount: at(data, 2), txHash, block }
    }
    if (k('Refunded') && data.length >= 2) {
      return { kind: 'refund', launchId: toNum(at(data, 0)), amount: at(data, 1), txHash, block }
    }
    return null
  } catch {
    return null
  }
}

/** The pair short string, decoded here so the wire carries `'BTC/USD'` and not a felt. */
function decodePairShortString(feltHex: string): string {
  let value = BigInt(feltHex)
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return String.fromCharCode(...bytes)
}

export interface ChainFeedStats {
  subscribers: number
  historyPoints: number
  tapeRows: number
}

export class ChainFeed {
  private readonly subscribers = new Set<FeedSubscriber>()

  private markets: OnChainMarket[] = []
  private marketsTotal = 0
  private launches: OnChainLaunch[] = []
  private launchesTotal = 0
  private prices = new Map<string, WirePrice>()
  private history = new Map<string, PricePoint[]>()
  private tape: TapeItem[] = []
  private problem: string | null = null

  /** Last block whose events were folded into the tape, per contract. -1 means "not yet". */
  private scanned: Record<'markets' | 'launch' | 'governance', number> = {
    markets: -1,
    launch: -1,
    governance: -1,
  }

  private appTimer: ReturnType<typeof setInterval> | null = null
  private priceTimer: ReturnType<typeof setInterval> | null = null

  /** The last emitted wire form, kept so an unchanged read emits nothing. */
  private lastMarketsWire = ''
  private lastLaunchesWire = ''

  constructor(private readonly deps: ChainFeedDeps) {
    if (deps.storePath) this.warmFromStore(deps.storePath)
  }

  // ── Subscribers ───────────────────────────────────────────────────────────────────────

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
      // rooms.ts's rule: one dead socket must not take the fan-out down with it.
      try {
        subscriber.deliver(payload)
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  // ── The pollers ───────────────────────────────────────────────────────────────────────

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
    // `unref` for the keeper's reason: a feed timer must not hold the process open on shutdown.
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
        const wire = JSON.stringify(out.markets.map(wireMarket))
        if (wire !== this.lastMarketsWire || out.total !== this.marketsTotal) {
          this.markets = out.markets
          this.marketsTotal = out.total
          this.lastMarketsWire = wire
          this.broadcast({ t: 'markets', markets: out.markets.map(wireMarket), total: out.total })
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
    const sources: Array<['markets' | 'launch' | 'governance', string]> = []
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
        // A sixth page means a backlog beyond one tick's budget; the NEXT tick starts where this
        // one's `latest` is, so nothing is lost — the tape just catches up a tick late.
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
      // use-pragma's rule, kept: the line moves only on a CHANGE, so an oracle that stalls for
      // eleven minutes does not draw a steady market that is really a silent feed. The latest
      // reading still updates above, because staleness is about `timestamp`, not the line.
      if (held?.price === price) continue

      const series = this.history.get(pair) ?? []
      series.push({ t: at, p: price })
      if (series.length > HISTORY_BOUND) series.shift()
      this.history.set(pair, series)
      this.appendToStore(pair, { t: at, p: price })
      this.broadcast({ t: 'price', price: wire })
    }
  }

  // ── The one durable piece: the price history ──────────────────────────────────────────

  private storeLines = 0

  private warmFromStore(path: string): void {
    try {
      if (!existsSync(path)) return
      const lines = readFileSync(path, 'utf8').split('\n')
      for (const line of lines) {
        if (!line) continue
        try {
          const row = JSON.parse(line) as { pair?: unknown; t?: unknown; p?: unknown }
          if (typeof row.pair !== 'string' || typeof row.t !== 'number' || typeof row.p !== 'number') continue
          const series = this.history.get(row.pair) ?? []
          series.push({ t: row.t, p: row.p })
          if (series.length > HISTORY_BOUND) series.shift()
          this.history.set(row.pair, series)
          this.storeLines += 1
        } catch {
          // One corrupt line costs one point.
        }
      }
      this.log(
        `chain feed: warmed ${[...this.history.values()].reduce((n, s) => n + s.length, 0)} price points from ${path}`,
      )
    } catch (e) {
      // History starts now. The feed itself is unaffected — this file is a convenience, not a ledger.
      this.warn(`chain feed: could not read ${path} — ${String(e)}; price history starts empty`)
    }
  }

  private appendToStore(pair: string, point: PricePoint): void {
    const path = this.deps.storePath
    if (!path) return
    try {
      appendFileSync(path, `${JSON.stringify({ pair, ...point })}\n`)
      this.storeLines += 1
      if (this.storeLines > STORE_COMPACT_LINES) this.compactStore(path)
    } catch (e) {
      this.warn(`chain feed: could not append to ${path} — ${String(e)}`)
    }
  }

  /** Rewrite the file as exactly the rings in memory — the tail is all a boot ever replays. */
  private compactStore(path: string): void {
    const lines: string[] = []
    for (const [pair, series] of this.history) {
      for (const point of series) lines.push(JSON.stringify({ pair, ...point }))
    }
    writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''))
    this.storeLines = lines.length
    this.log(`chain feed: compacted ${path} to ${lines.length} lines`)
  }

  stats(): ChainFeedStats {
    return {
      subscribers: this.subscribers.size,
      historyPoints: [...this.history.values()].reduce((n, s) => n + s.length, 0),
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
