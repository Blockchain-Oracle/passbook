//
// The oracle's SHAPE, with nothing attached to it. `pragma.ts` reads the chain through `starknet`;
// a price strip that formats a number must not pull that into its chunk. THIS FILE MUST IMPORT
// NOTHING; `pragma.ts` re-exports every name below.
//

/** The pairs this app reads, with the short-string ids Pragma keys them by. */
export const PRAGMA_PAIRS = {
  'BTC/USD': '0x4254432f555344',
  'ETH/USD': '0x4554482f555344',
  'STRK/USD': '0x5354524b2f555344',
} as const

export type PragmaPair = keyof typeof PRAGMA_PAIRS

/** In display order — the strip renders them left to right in this order. */
export const PRAGMA_PAIR_LIST: readonly PragmaPair[] = ['BTC/USD', 'ETH/USD', 'STRK/USD']

/** One median reading. Everything a surface needs to render it honestly. */
export interface PragmaPrice {
  pair: PragmaPair
  /** The median, already scaled out of `decimals`. */
  price: number
  /** Pragma's own scale for this pair. 8 for every pair this app reads, but never assumed. */
  decimals: number
  /** The oracle's last-update time, in SECONDS since the epoch. Pragma's unit, not ms. */
  timestamp: number
  /** How many sources agreed. A median over 1 source is a price; over 11 it is a market. */
  sources: number
}

/** One reading per pair, or the reason there is not one. */
export type PragmaReading =
  | { ok: true; price: PragmaPrice }
  | { ok: false; pair: PragmaPair; because: string }

/**
 * Decode `get_data_median`'s four felts.
 *
 * The response is `[price, decimals, last_updated_timestamp, num_sources_aggregated]`, and every
 * one of them is validated rather than trusted: this is the number a bet settles against, so a
 * response that is short, or whose decimals are absurd, has to fail loudly here rather than become
 * a price that is wrong by a factor of a million further downstream.
 *
 * Pure, so it is testable without a chain — every other test on these surfaces injects past the
 * read, which would otherwise leave this as the one line nothing ever executed.
 */
export function medianFrom(pair: PragmaPair, result: readonly string[]): PragmaPrice {
  if (!result || result.length < 4) {
    throw new Error(
      `the oracle returned ${result?.length ?? 0} values for ${pair}, and a median is four`,
    )
  }

  let raw: bigint
  let decimals: bigint
  let timestamp: bigint
  let sources: bigint
  try {
    raw = BigInt(result[0]!)
    decimals = BigInt(result[1]!)
    timestamp = BigInt(result[2]!)
    sources = BigInt(result[3]!)
  } catch (e) {
    throw new Error(`the oracle's answer for ${pair} did not parse as felts: ${String(e)}`)
  }

  // A zero price is not a cheap asset — it is the answer for a pair the oracle does not carry, and
  // rendering it would put "$0.00" beside BTC.
  if (raw <= 0n) throw new Error(`the oracle has no price for ${pair}`)
  // Bounded before it becomes an exponent: `10 ** 10n**9` is not a number, it is a hang.
  if (decimals > 30n) throw new Error(`the oracle reported ${decimals} decimals for ${pair}`)

  return {
    pair,
    // Divided in floating point deliberately. This value is for DISPLAY and for drawing a chart —
    // it is never the input to a payout, which the contract computes in u256 from its own read.
    price: Number(raw) / 10 ** Number(decimals),
    decimals: Number(decimals),
    timestamp: Number(timestamp),
    sources: Number(sources),
  }
}

/** How stale a reading is, in seconds. Takes the clock — nothing here reads one. */
export function ageSeconds(price: PragmaPrice, nowMs: number): number {
  return Math.max(0, Math.floor(nowMs / 1000) - price.timestamp)
}

/**
 * How long before a reading should be shown as stale rather than current.
 *
 * Two minutes, and it is a DISPLAY threshold rather than the contract's rule. The day-0 checks
 * watched this feed hold one value for eleven minutes, and a live read taken while building the
 * strip came back 342 seconds old — so a surface that only ever renders a bright number would be
 * claiming immediacy the feed does not have. The contract's own freshness guard is separate and
 * stricter; this is when the UI stops implying "now".
 */
//
// MATCHED TO THE ORACLE'S OWN CADENCE, not to a wish. The day-0 checks watched this feed hold one
// value for eleven minutes, and a live read during the markets build came back 342 seconds old —
// on a feed behaving perfectly normally. At the old 120 the strip was amber almost always, which
// spends the warning on the ordinary case; a warning that is always on is one nobody reads. This
// clears the measured worst ordinary gap, so amber now means "older than this feed ever sits when
// healthy" — a fact worth interrupting someone with.
//
export const STALE_AFTER_SECONDS = 900

export function isStale(price: PragmaPrice, nowMs: number): boolean {
  return ageSeconds(price, nowMs) > STALE_AFTER_SECONDS
}

/**
 * A price formatted for display.
 *
 * THE PRECISION FOLLOWS THE MAGNITUDE, because one rule cannot serve an $80,000 asset and a $0.027
 * one: two decimals renders STRK as "0.03" — a 10% rounding error presented as a price — and six
 * decimals renders BTC with four digits nobody reads. Thresholds rather than per-pair rules, so a
 * pair added tomorrow is formatted correctly without a table entry.
 */
export function formatPrice(price: number): string {
  const decimals = price >= 1000 ? 2 : price >= 1 ? 3 : 5
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
