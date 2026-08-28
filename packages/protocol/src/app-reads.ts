//
// Reading the Markets and Launch contracts — the browser's view of what is actually open.
//
// ── RAW `starknet_call`, NOT THE SDK, AND THAT IS A BUDGET RULE ──────────────────────────
//
// The surfaces that render these lists are EAGER routes, and the build gate bans the `starknet`
// graph from the eager chunks. `crowd-rpc.ts` already answered the same problem the same way: a
// view call is one POST with pre-computed selectors, and a selector is a deterministic hash of a
// fixed string — a CONSTANT, pinned below and held to `getSelectorFromName` by `app-reads.test.ts`
// so it cannot drift from the library's answer.
//
// ── DECODERS TRANSCRIBED FROM THE STRUCTS, AND HELD THERE ────────────────────────────────
//
// `markets.cairo` and `launch.cairo` both declare their structs public "so the web client can
// decode `get_market` without a hand-written ABI". These decoders are that sentence's other half:
// field-for-field transcriptions, in declaration order, of `Market` and `LaunchInfo`. A struct
// edit that reorders a field breaks the test vectors before it breaks a user.
//
// ── EVERY READ RETURNS OR THROWS PER CALL, AND THE CALLER DECIDES ────────────────────────
//
// A list read that half-succeeds is reported as what it is: the entries that decoded, plus a
// problem sentence. The surfaces render what arrived and say what did not — the same shape the
// balance walk uses — because "market 3 could not be read" and "there are no markets" are
// different facts and only one of them is about the user's money.
//
import { NET } from './constants.js'

// ── Selectors, pinned. `app-reads.test.ts` holds each to `hash.getSelectorFromName`. ──────
export const SELECTOR = {
  market_count: '0x34b53bfc209bd95471a64893a17d5f18812ef65e53cf785999990babfc31eb8',
  get_market: '0x5764f9d1572e4d8cb7432f108c87d6ba790e18eb821744b0eefd034e85fc79',
  quote_bet: '0x1d6e26c2530698c071cdd811139e91263d91b5e3b92486b6f96074d0d577abe',
  launch_count: '0x2909cbec54fa14313e5709d13f10f6b636fab9ddedecc5e719687441fe9e57c',
  get_launch: '0x311384b8f07fb7bcaf15cf41ea4fc846752894eeb3ed4b6926f10a13c3fa243',
  launch_name: '0x3b4e3053e26d78089f696e20cb6be2475a6983e3492da4870e909f39040bb77',
  launch_symbol: '0x3fe3c45b35be2ce898dd770cfddd5d58757d46fe9959e79df656deea301bcb0',
  launch_logo: '0x258cd291f3689b9c76fc62d1def3b5b2b297dc5ec349211a7ac7f499b3c02b6',
  quote_buy: '0x14b48ce6868b115791fd52c2a56e57ac8a205144b03b21af265c85884881bde',
  create_launch: '0x385b6268c717439a1106322e5a47c12378406dc2126d7cfa29bb0d3bc88d7e0',
} as const

// ── Contract state numbers, transcribed from the Cairo constants. ─────────────────────────
export const MARKET_STATE = { none: 0, active: 1, resolved: 2, voided: 3 } as const
export const LAUNCH_STATE = { none: 0, active: 1, graduated: 2, failed: 3 } as const

/** `launch.cairo`'s `UNITS_PER_EPOCH`. An epoch holds exactly sixteen units, by construction. */
export const UNITS_PER_EPOCH = 16

/** One market, decoded. Field names follow `markets.cairo`'s `Market` verbatim. */
export interface OnChainMarket {
  id: number
  /** The Pragma pair, decoded from its short string — `'BTC/USD'`. */
  pair: string
  /** The line, in Pragma's 8-decimal fixed point. */
  strike: bigint
  /** Unix seconds. */
  deadline: number
  token: string
  up: bigint
  down: bigint
  seed: bigint
  collateral: bigint
  state: number
  winner: number
  experimental: boolean
}

/** One launch, decoded. Field names follow `launch.cairo`'s `LaunchInfo` verbatim. */
export interface OnChainLaunch {
  id: number
  name: string
  symbol: string
  /** `launch_logo` — empty string when the creator pointed at nothing, an `ipfs://CID` when set. */
  logoUri: string
  stakeToken: string
  /** The deployed ERC20 — zero until graduation. */
  token: string
  /** Price of one unit in epoch 0, in stake base units. */
  p0: bigint
  /** Added to the unit price with each epoch. */
  dp: bigint
  unitTokens: bigint
  epochs: number
  /** Units sold so far. `sold == epochs * UNITS_PER_EPOCH` is graduation. */
  sold: number
  raised: bigint
  deadline: number
  state: number
  swept: boolean
}

export type Transport = (method: string, params: unknown) => Promise<unknown>

/**
 * The built-in transport, exported so a server-side caller (the relayer's chain feed) can ride
 * the same host-failover loop instead of growing a second copy of it.
 */
export const defaultTransport: Transport = (method, params) => rpc(method, params)

/** One JSON-RPC round trip, against each configured host in turn — `crowd-rpc.ts`'s shape. */
async function rpc(method: string, params: unknown): Promise<unknown> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`${nodeUrl} answered ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: unknown }
      if (body.error) throw new Error(`${nodeUrl} returned an error: ${JSON.stringify(body.error)}`)
      return body.result
    } catch (error) {
      last = error
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

/** A `starknet_call` at the latest block, returning the felt array. */
async function call(
  contract: string,
  selector: string,
  calldata: readonly string[],
  transport: Transport,
): Promise<string[]> {
  const result = await transport('starknet_call', {
    request: { contract_address: contract, entry_point_selector: selector, calldata },
    block_id: 'latest',
  })
  if (!Array.isArray(result) || result.some((f) => typeof f !== 'string')) {
    throw new Error('starknet_call returned something that is not a felt array')
  }
  return result as string[]
}

const toBig = (felt: string): bigint => BigInt(felt)
const toNum = (felt: string): number => Number(BigInt(felt))
const hex = (value: number | bigint): string => `0x${BigInt(value).toString(16)}`

/** A Cairo short string — the pair id — back into ASCII. */
export function decodeShortString(felt: string): string {
  let value = BigInt(felt)
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return String.fromCharCode(...bytes)
}

/**
 * A string into a serialised `ByteArray` — the inverse of `decodeByteArray`, for the calldata a
 * `create_launch` carries. ASCII only by refusal: a name with a multi-byte character would encode
 * to different bytes than the reader shows, and a launch named one thing that renders as another
 * is the kind of ambiguity a token name cannot afford.
 */
export function encodeByteArray(text: string): string[] {
  const bytes: number[] = []
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code > 0x7f) throw new Error(`"${ch}" is not ASCII, and a ByteArray this app writes stays ASCII`)
    bytes.push(code)
  }
  const felts: string[] = []
  const fullWords = Math.floor(bytes.length / 31)
  felts.push(hex(fullWords))
  const word = (slice: number[]): string => {
    let value = 0n
    for (const b of slice) value = (value << 8n) | BigInt(b)
    return hex(value)
  }
  for (let i = 0; i < fullWords; i++) felts.push(word(bytes.slice(i * 31, i * 31 + 31)))
  const pending = bytes.slice(fullWords * 31)
  felts.push(pending.length === 0 ? '0x0' : word(pending))
  felts.push(hex(pending.length))
  return felts
}

/**
 * A serialised `ByteArray` — `[data_len, ...bytes31 words, pending_word, pending_word_len]` —
 * back into a string. Consumes from `felts` starting at `at`; returns the text and the next index,
 * because launch reads decode several of these in a row.
 */
export function decodeByteArray(felts: readonly string[], at = 0): { text: string; next: number } {
  const words = toNum(felts[at]!)
  const bytes: number[] = []
  const word31 = (felt: string, take: number) => {
    let value = BigInt(felt)
    const out: number[] = []
    while (value > 0n) {
      out.unshift(Number(value & 0xffn))
      value >>= 8n
    }
    while (out.length < take) out.unshift(0)
    return out
  }
  for (let i = 0; i < words; i++) bytes.push(...word31(felts[at + 1 + i]!, 31))
  const pendingLen = toNum(felts[at + 1 + words + 1]!)
  if (pendingLen > 0) bytes.push(...word31(felts[at + 1 + words]!, pendingLen))
  return { text: String.fromCharCode(...bytes), next: at + words + 3 }
}

/** `Market`'s 13 felts, in declaration order. Exported so the test can feed it a pinned vector. */
export function decodeMarket(id: number, felts: readonly string[]): OnChainMarket {
  if (felts.length < 13) throw new Error(`get_market returned ${felts.length} felts; Market is 13`)
  return {
    id,
    pair: decodeShortString(felts[0]!),
    strike: toBig(felts[1]!),
    deadline: toNum(felts[2]!),
    token: felts[3]!,
    up: toBig(felts[4]!),
    down: toBig(felts[5]!),
    // k rides felts 6–7 (u256 low, high) and nothing on a surface needs it.
    seed: toBig(felts[8]!),
    collateral: toBig(felts[9]!),
    state: toNum(felts[10]!),
    winner: toNum(felts[11]!),
    experimental: toBig(felts[12]!) !== 0n,
  }
}

/** `LaunchInfo`'s 12 felts, in declaration order. */
export function decodeLaunch(
  id: number,
  felts: readonly string[],
  name: string,
  symbol: string,
  logoUri = '',
): OnChainLaunch {
  if (felts.length < 12) throw new Error(`get_launch returned ${felts.length} felts; LaunchInfo is 12`)
  return {
    id,
    name,
    symbol,
    logoUri,
    stakeToken: felts[0]!,
    token: felts[1]!,
    p0: toBig(felts[2]!),
    dp: toBig(felts[3]!),
    unitTokens: toBig(felts[4]!),
    epochs: toNum(felts[5]!),
    sold: toNum(felts[6]!),
    raised: toBig(felts[7]!),
    deadline: toNum(felts[8]!),
    // creator_commitment rides felt 9 and no surface renders it.
    state: toNum(felts[10]!),
    swept: toBig(felts[11]!) !== 0n,
  }
}

/**
 * Every market the contract has, newest first. A cap because `market_count` is unbounded and one
 * screen is not; the cap is stated in the result so a truncated list can say so.
 */
export async function readMarkets(
  contract: string,
  { cap = 24, transport = rpc as Transport } = {},
): Promise<{ markets: OnChainMarket[]; total: number; problem: string | null }> {
  const countFelts = await call(contract, SELECTOR.market_count, [], transport)
  const total = toNum(countFelts[0] ?? '0x0')
  const ids = Array.from({ length: Math.min(total, cap) }, (_, i) => total - 1 - i)
  const markets: OnChainMarket[] = []
  let problem: string | null = null
  for (const id of ids) {
    try {
      markets.push(decodeMarket(id, await call(contract, SELECTOR.get_market, [hex(id)], transport)))
    } catch (error) {
      problem = `Market ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { markets, total, problem }
}

/** Every launch, newest first, names included — same shape and same caveats as `readMarkets`. */
export async function readLaunches(
  contract: string,
  { cap = 24, transport = rpc as Transport } = {},
): Promise<{ launches: OnChainLaunch[]; total: number; problem: string | null }> {
  const countFelts = await call(contract, SELECTOR.launch_count, [], transport)
  const total = toNum(countFelts[0] ?? '0x0')
  const ids = Array.from({ length: Math.min(total, cap) }, (_, i) => total - 1 - i)
  const launches: OnChainLaunch[] = []
  let problem: string | null = null
  for (const id of ids) {
    try {
      const [info, nameFelts, symbolFelts, logoFelts] = await Promise.all([
        call(contract, SELECTOR.get_launch, [hex(id)], transport),
        call(contract, SELECTOR.launch_name, [hex(id)], transport),
        call(contract, SELECTOR.launch_symbol, [hex(id)], transport),
        call(contract, SELECTOR.launch_logo, [hex(id)], transport),
      ])
      launches.push(
        decodeLaunch(
          id,
          info,
          decodeByteArray(nameFelts).text,
          decodeByteArray(symbolFelts).text,
          decodeByteArray(logoFelts).text,
        ),
      )
    } catch (error) {
      problem = `Launch ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { launches, total, problem }
}

/** `quote_bet` — the tickets a stake buys right now. The number the ticket displays and asserts. */
export async function quoteBet(
  contract: string,
  marketId: number,
  side: number,
  amount: bigint,
  transport: Transport = rpc as Transport,
): Promise<bigint> {
  const out = await call(contract, SELECTOR.quote_bet, [hex(marketId), hex(side), hex(amount)], transport)
  return toBig(out[0] ?? '0x0')
}

/** `quote_buy` — what `units` costs in stake base units, at the curve's current epoch. */
export async function quoteBuy(
  contract: string,
  launchId: number,
  units: number,
  transport: Transport = rpc as Transport,
): Promise<bigint> {
  const out = await call(contract, SELECTOR.quote_buy, [hex(launchId), hex(units)], transport)
  return toBig(out[0] ?? '0x0')
}

// ── Derivations the surfaces share ────────────────────────────────────────────────────────

/** The question a market asks, in the prototype's own words: "BTC/USD above $80,500". */
export function marketQuestion(market: OnChainMarket): string {
  return `${market.pair} above $${strikeDisplay(market.strike)}`
}

/** The strike out of Pragma's 8-decimal fixed point, at the pair's own precision. */
export function strikeDisplay(strike: bigint): string {
  const value = Number(strike) / 1e8
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 5
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * The pot split, as percentages that always sum to 100.
 *
 * This is the POT, not a probability claim: the ticket's "pays if right" comes from `quote_bet`,
 * which is the number the contract will actually honour. Rendering the pot as the bar keeps the
 * bar a fact.
 */
export function potShare(market: OnChainMarket): { upPct: number; downPct: number } {
  const total = market.up + market.down
  if (total === 0n) return { upPct: 50, downPct: 50 }
  const upPct = Math.round(Number((market.up * 100n) / total))
  return { upPct, downPct: 100 - upPct }
}

/** "2d 4h" · "3h 12m" · "47m" · "closed" — the deadline against the caller's clock. */
export function timeLeft(deadline: number, nowMs: number): string {
  const seconds = deadline - Math.floor(nowMs / 1000)
  if (seconds <= 0) return 'closed'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** The epoch the NEXT unit sells in, zero-based, and clamped to the last epoch. */
export function currentEpoch(launch: OnChainLaunch): number {
  return Math.min(Math.floor(launch.sold / UNITS_PER_EPOCH), Math.max(0, launch.epochs - 1))
}

/** The unit price inside an epoch: `p0 + dp × epoch`. Flat within, steps between — the staircase. */
export function unitPriceAt(launch: OnChainLaunch, epoch: number): bigint {
  return launch.p0 + launch.dp * BigInt(epoch)
}

/** Units sold over units on offer, as a 0–100 number for a progress bar. */
export function soldPct(launch: OnChainLaunch): number {
  const offered = launch.epochs * UNITS_PER_EPOCH
  if (offered === 0) return 0
  return Math.min(100, Math.round((launch.sold / offered) * 100))
}

/** The full raise if every epoch sells: `Σ (p0 + dp·e) × 16` — the graduation target. */
export function raiseTarget(launch: OnChainLaunch): bigint {
  let total = 0n
  for (let e = 0; e < launch.epochs; e++) {
    total += unitPriceAt(launch, e) * BigInt(UNITS_PER_EPOCH)
  }
  return total
}
