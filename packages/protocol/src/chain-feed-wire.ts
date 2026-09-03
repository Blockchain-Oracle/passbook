//
// The chain feed's wire contract — one file both ends import, so the relayer's producer and the
// browser's store cannot drift apart about a frame's shape.
//
// ── WHY A SERVER-SIDE FEED EXISTS AT ALL ─────────────────────────────────────────────────
//
// Before this file, every open tab polled the chain for itself: markets every 30s, launches every
// 30s, three Pragma pairs every 15s — N browsers × M reads, all asking the same public questions
// and each starting from an empty price history. The relayer is one always-on machine that
// already holds an RPC provider; it asks once and fans the answers out over the same SSE-over-POST
// framing. The browser keeps its own
// read path as a fallback, so a dead feed degrades to "slower", never to "blank".
//
// ── BIGINTS TRAVEL AS HEX STRINGS ────────────────────────────────────────────────────────
//
// `JSON.stringify` throws on a bigint, and the app's decoded shapes (`OnChainMarket`,
// `OnChainLaunch`) are full of them. The wire forms below carry every u128/u256 as a `0x` string
// and the codec functions are the only place the conversion happens — a frame built any other way
// is a bug, not a variant.
//
// Pure: type-only imports, no `starknet`, no `fetch`, no DOM — loadable from the eager browser
// chunk and from the relayer's node process alike.
//
import type { OnChainLaunch, OnChainMarket, OnChainSeries } from './app-reads.js'

// ── Wire forms: the decoded chain shapes with every bigint as a hex string ────────────────

export interface WireMarket {
  id: number
  pair: string
  strike: string
  deadline: number
  token: string
  up: string
  down: string
  k: string
  seed: string
  collateral: string
  state: number
  winner: number
  experimental: boolean
  house: boolean
  series: number
  openCash: string
  vig: string
  window: number
  vigBps: number
}

export interface WireSeries {
  id: number
  pair: string
  window: number
  token: string
  seed: string
  minSources: number
  vigBps: number
  experimental: boolean
  active: boolean
}

export interface WireLaunch {
  id: number
  name: string
  symbol: string
  logoUri: string
  stakeToken: string
  token: string
  p0: string
  dp: string
  unitTokens: string
  epochs: number
  sold: number
  raised: string
  deadline: number
  state: number
  swept: boolean
}

/** One oracle observation. `p` is the price as a DECIMAL (77547.81 for BTC/USD) — `medianFrom` has already divided by 10^decimals. */
export interface PricePoint {
  /** Unix milliseconds, the relayer's clock at the read. */
  t: number
  p: number
}

/**
 * One row of the public activity tape, decoded from the app contracts' own events.
 *
 * `kind` names follow the Cairo event names, lowercased, because the tape is a rendering of the
 * contract's public history and inventing a second vocabulary for it would mean a mapping table
 * that can be wrong. Every field here is already public chain data — commitments are bearer
 * commitments, not identities, and the pool is what keeps the actor unlinkable.
 */
export type TapeItem =
  | { kind: 'market-created'; marketId: number; pair: string; strike: string; deadline: number; txHash: string; block: number }
  | { kind: 'market-opened'; marketId: number; series: number; strike: string; deadline: number; txHash: string; block: number }
  | { kind: 'bet'; marketId: number; side: number; amount: string; upAfter: string; downAfter: string; txHash: string; block: number }
  | { kind: 'market-resolved'; marketId: number; winner: number; settlePrice: string; txHash: string; block: number }
  | { kind: 'market-voided'; marketId: number; txHash: string; block: number }
  | { kind: 'market-claim'; marketId: number; amount: string; txHash: string; block: number }
  | { kind: 'market-cashout'; marketId: number; tickets: string; amount: string; txHash: string; block: number }
  | { kind: 'launch-created'; launchId: number; deadline: number; txHash: string; block: number }
  | { kind: 'buy'; launchId: number; epoch: number; units: number; cost: string; soldAfter: number; txHash: string; block: number }
  | { kind: 'graduated'; launchId: number; token: string; txHash: string; block: number }
  | { kind: 'launch-failed'; launchId: number; sold: number; raised: string; txHash: string; block: number }
  | { kind: 'redeem'; launchId: number; units: number; amount: string; txHash: string; block: number }
  | { kind: 'refund'; launchId: number; amount: string; txHash: string; block: number }
  // ── The Governor's public history (governance.cairo). Weights and amounts stay felt strings
  //    like every other row; identities never appear because the contract never emits one —
  //    ballots carry a pool-derived pseudonymous handle the tape deliberately does not carry.
  | { kind: 'house-created'; houseId: number; token: string; txHash: string; block: number }
  | { kind: 'proposal-created'; proposalId: number; houseId: number; deadline: number; txHash: string; block: number }
  | { kind: 'gov-ballot'; proposalId: number; weight: string; seq: number; txHash: string; block: number }
  | { kind: 'gov-joined'; houseId: number; memberCount: number; txHash: string; block: number }
  | { kind: 'treasury-funded'; houseId: number; amount: string; treasuryAfter: string; txHash: string; block: number }
  | { kind: 'tally-published'; proposalId: number; tallyFor: string; tallyAgainst: string; outcome: number; txHash: string; block: number }
  | { kind: 'key-published'; proposalId: number; txHash: string; block: number }
  | { kind: 'gov-executed'; proposalId: number; amount: string; txHash: string; block: number }
  | { kind: 'proposal-voided'; proposalId: number; txHash: string; block: number }

/**
 * The latest reading per pair — the full `PragmaPrice`, not a bare number, so staleness checks
 * and the "N sources" sentence stay honest through the feed. `price` is a DECIMAL, never the
 * oracle's fixed point; a market's `strike` IS fixed point, so compare against `strike / 1e8`.
 * `at` is when THIS relayer read it; `timestamp` stays Pragma's own last-update in seconds.
 */
export interface WirePrice {
  pair: string
  price: number
  decimals: number
  timestamp: number
  sources: number
  at: number
}

/**
 * The frames. `hello` arrives once per (re)connect and carries the whole state — including the
 * price history the browser cannot have witnessed — so the client has exactly one ordering rule:
 * apply everything in arrival order, starting from the hello. Everything after is a delta.
 */
export type FeedFrame =
  | {
      t: 'hello'
      at: number
      markets: WireMarket[]
      series: WireSeries[]
      marketsTotal: number
      launches: WireLaunch[]
      launchesTotal: number
      prices: WirePrice[]
      history: Record<string, PricePoint[]>
      tape: TapeItem[]
      problem: string | null
    }
  | { t: 'markets'; markets: WireMarket[]; series: WireSeries[]; total: number }
  | { t: 'launches'; launches: WireLaunch[]; total: number }
  | { t: 'price'; price: WirePrice }
  | { t: 'tape'; items: TapeItem[] }
  /** The poller's honest state. `null` clears a previous sentence. */
  | { t: 'health'; problem: string | null }

// ── Codec ─────────────────────────────────────────────────────────────────────────────────

const big = (value: string): bigint => BigInt(value)
const hex = (value: bigint): string => `0x${value.toString(16)}`

export function wireMarket(m: OnChainMarket): WireMarket {
  return {
    id: m.id,
    pair: m.pair,
    strike: hex(m.strike),
    deadline: m.deadline,
    token: m.token,
    up: hex(m.up),
    down: hex(m.down),
    k: hex(m.k),
    seed: hex(m.seed),
    collateral: hex(m.collateral),
    state: m.state,
    winner: m.winner,
    experimental: m.experimental,
    house: m.house,
    series: m.series,
    openCash: hex(m.openCash),
    vig: hex(m.vig),
    window: m.window,
    vigBps: m.vigBps,
  }
}

export function marketFromWire(w: WireMarket): OnChainMarket {
  return {
    id: w.id,
    pair: w.pair,
    strike: big(w.strike),
    deadline: w.deadline,
    token: w.token,
    up: big(w.up),
    down: big(w.down),
    k: big(w.k),
    seed: big(w.seed),
    collateral: big(w.collateral),
    state: w.state,
    winner: w.winner,
    experimental: w.experimental,
    house: w.house,
    series: w.series,
    openCash: big(w.openCash),
    vig: big(w.vig),
    window: w.window,
    vigBps: w.vigBps,
  }
}

export function wireSeries(s: OnChainSeries): WireSeries {
  return { ...s, seed: hex(s.seed) }
}

export function seriesFromWire(w: WireSeries): OnChainSeries {
  return { ...w, seed: big(w.seed) }
}

export function wireLaunch(l: OnChainLaunch): WireLaunch {
  return {
    id: l.id,
    name: l.name,
    symbol: l.symbol,
    logoUri: l.logoUri,
    stakeToken: l.stakeToken,
    token: l.token,
    p0: hex(l.p0),
    dp: hex(l.dp),
    unitTokens: hex(l.unitTokens),
    epochs: l.epochs,
    sold: l.sold,
    raised: hex(l.raised),
    deadline: l.deadline,
    state: l.state,
    swept: l.swept,
  }
}

export function launchFromWire(w: WireLaunch): OnChainLaunch {
  return {
    id: w.id,
    name: w.name,
    symbol: w.symbol,
    logoUri: w.logoUri,
    stakeToken: w.stakeToken,
    token: w.token,
    p0: big(w.p0),
    dp: big(w.dp),
    unitTokens: big(w.unitTokens),
    epochs: w.epochs,
    sold: w.sold,
    raised: big(w.raised),
    deadline: w.deadline,
    state: w.state,
    swept: w.swept,
  }
}

/**
 * The shape gate a browser runs on every arriving frame. Deliberately shallow — it answers "is
 * this one of ours" so the store can switch on `t`, and leaves field validation to the decoders,
 * which already refuse malformed hex by throwing where the caller can attribute it.
 */
export function isFeedFrame(value: unknown): value is FeedFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const t = (value as { t?: unknown }).t
  return t === 'hello' || t === 'markets' || t === 'launches' || t === 'price' || t === 'tape' || t === 'health'
}
