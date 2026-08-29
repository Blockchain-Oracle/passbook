//
// Reading the Markets and Launch contracts — the browser's view of what is actually open.
//
// RAW `starknet_call`, NOT THE SDK, and that is a budget rule: the surfaces that render these lists
// are eager routes, and the `starknet` graph stays out of the eager chunks. A view call is one POST
// with a pre-computed selector (`app-codecs.ts`).
//
// EVERY READ RETURNS OR THROWS PER CALL, AND THE CALLER DECIDES. A list read that half-succeeds is
// reported as what it is: the entries that decoded, plus a problem sentence. "Market 3 could not be
// read" and "there are no markets" are different facts and only one of them is about the user's money.
//
import { NET } from './constants.js'
import {
  SELECTOR,
  UNITS_PER_EPOCH,
  decodeByteArray,
  decodeLaunch,
  decodeMarket,
  hex,
  toBig,
  toNum,
  type OnChainLaunch,
  type OnChainMarket,
} from './app-codecs.js'

export * from './app-codecs.js'

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
 * The pot split, as percentages that always sum to 100. This is the POT, not a probability claim:
 * "pays if right" comes from `quote_bet`, which is the number the contract will actually honour.
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
