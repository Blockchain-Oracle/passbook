//
// A position, derived from the note walk rather than remembered.
//
// ── WHY THERE IS NO STORE HERE ────────────────────────────────────────────────────────────
//
// Markets and Launch positions are bearer claims: a secret in this browser is the money, so losing
// it loses the position. An Earn position is not like that at all. Supplying mints vToken notes
// into the pool, and those notes are found by the same walk that finds every other balance — so a
// cleared browser, a new device, or a restored account finds the position again with nothing but
// the account key. That is a genuinely better property and it is worth not throwing away by
// caching it into a store that could then disagree with the chain.
//
// So: `positionsFrom` takes the walk and the live share price, and that is the whole state. The
// only local thing Earn keeps is presentation — labels and progress — which has no spend authority
// and never becomes the source of truth.
//
// Aggregated by MARKET, not by note. Three supplies into Re7 USDC Core are one position with three
// notes in it, the same way nine buys on one launch are one position.
//

import { EARN_MARKETS, marketByVToken, type EarnMarketDefinition } from './earn-markets.js'
import { redeemable, type Redeemable } from './earn-rate.js'

/** The shape this needs from a walk. Structural, so `DiscoveredNote` satisfies it unchanged. */
export interface EarnNote {
  readonly id: bigint
  readonly token: string
  readonly amount: bigint
}

export interface EarnPosition {
  readonly market: EarnMarketDefinition
  /** Every vToken note in this market, summed. The position, exactly. */
  readonly sharesWei: bigint
  readonly noteCount: number
  /**
   * What those shares are worth in the underlying right now, or `null` when the market's share
   * price could not be read. `null`, never `0` — a failed read is not an empty position.
   */
  readonly valueWei: bigint | null
  /** How much could actually come out today, which is not the same as what it is worth. */
  readonly redeemable: Redeemable | null
}

/** What one market's share price and liquidity say, when they could be read. */
export interface EarnMarketPricing {
  /** `convert_to_assets(1 whole share)`, so value is a multiplication rather than a round trip. */
  readonly sharePriceWei: bigint | null
  readonly reserveWei: bigint | null
  readonly paused: boolean
}

/**
 * Shares priced in the underlying.
 *
 * Integer arithmetic on purpose: `sharePriceWei` is what ONE whole share converts to, so the
 * position's value is `shares × price / 1 whole share`. Doing this in floating point would lose
 * cents on a large position, and the 18-decimal share against a 6-decimal asset is exactly the
 * scale gap where that starts to show.
 */
export function valueOf(sharesWei: bigint, market: EarnMarketDefinition, sharePriceWei: bigint | null): bigint | null {
  if (sharePriceWei === null) return null
  const whole = 10n ** BigInt(market.shareDecimals)
  return (sharesWei * sharePriceWei) / whole
}

/**
 * Every Earn position this walk holds.
 *
 * Markets with no notes are omitted — an absent position and a zero one are the same thing here,
 * and the catalog is where a market with nothing in it still gets shown.
 */
export function positionsFrom(
  notes: readonly EarnNote[],
  pricing: (market: EarnMarketDefinition) => EarnMarketPricing,
): EarnPosition[] {
  const shares = new Map<string, { sharesWei: bigint; noteCount: number }>()
  for (const note of notes) {
    const market = marketByVToken(note.token)
    if (!market) continue
    const held = shares.get(market.marketId) ?? { sharesWei: 0n, noteCount: 0 }
    held.sharesWei += note.amount
    held.noteCount += 1
    shares.set(market.marketId, held)
  }

  const out: EarnPosition[] = []
  // Registry order, so the list does not reshuffle as amounts move.
  for (const market of EARN_MARKETS) {
    const held = shares.get(market.marketId)
    if (!held || held.sharesWei <= 0n) continue
    const { sharePriceWei, reserveWei, paused } = pricing(market)
    const valueWei = valueOf(held.sharesWei, market, sharePriceWei)
    out.push({
      market,
      sharesWei: held.sharesWei,
      noteCount: held.noteCount,
      valueWei,
      redeemable:
        valueWei === null || reserveWei === null ? null : redeemable({ valueWei, reserveWei, paused }),
    })
  }
  return out
}

/**
 * The portfolio total, in the underlying.
 *
 * `null` the moment ANY held market's price is unreadable, rather than quietly summing the ones
 * that answered. A total that silently omits a position is worse than no total: it looks precise
 * and it is wrong, and the user has no way to tell which of the two they are looking at.
 */
export function totalValue(positions: readonly EarnPosition[]): bigint | null {
  let sum = 0n
  for (const position of positions) {
    if (position.valueWei === null) return null
    sum += position.valueWei
  }
  return sum
}

/** Shares held in one market, for a redeem form's max. `0n` when nothing is held. */
export function sharesIn(positions: readonly EarnPosition[], marketId: string): bigint {
  return positions.find((p) => p.market.marketId === marketId)?.sharesWei ?? 0n
}
