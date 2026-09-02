//
// Market Pulse (AD-10): three deterministic projections over public market facts, and nothing
// that needs an index. Every ordering is total — ties break on the market id — so two clients
// reading the same block draw the same list. Ratios compare by bigint cross-multiplication, never
// by a float that could put two markets in either order. Event-derived metrics (volume, trades)
// are deliberately absent until a durable index can promise complete coverage.
//

import { MARKET_STATE, type OnChainMarket } from './app-codecs.js'

export type PulseMetric = 'closing-soon' | 'largest-open-pot' | 'closest-market'

export const PULSE_METRICS: readonly PulseMetric[] = ['closing-soon', 'largest-open-pot', 'closest-market']

export const PULSE_TITLE: Record<PulseMetric, string> = {
  'closing-soon': 'Closing soon',
  'largest-open-pot': 'Largest open pot',
  'closest-market': 'Closest call',
}

export const PULSE_BODY: Record<PulseMetric, string> = {
  'closing-soon': 'Bettable markets, soonest deadline first.',
  'largest-open-pot': 'Active markets by collateral at stake.',
  'closest-market': 'Active markets whose two sides are nearest even.',
}

export type PulseState = 'live' | 'stale' | 'partial' | 'empty'

export interface PulseRow {
  readonly market: OnChainMarket
  /** The metric's own number for this row, as the chain has it — never a derived percentage. */
  readonly figure: string
}

export interface PulseReading {
  readonly metric: PulseMetric
  readonly rows: readonly PulseRow[]
  readonly state: PulseState
  /** When the markets underneath were read (epoch ms), so a stale list is legible as stale. */
  readonly observedAt: number
}

const byId = (a: OnChainMarket, b: OnChainMarket) => a.id - b.id

/** A series window stops taking bets a quarter of its length before the mark (`openableUntil`). */
const openableUntil = (m: OnChainMarket) => (m.window > 0 ? m.deadline - Math.floor(m.window / 4) : m.deadline)

/** Active, or a house window nobody has opened yet — the first bet opens it, so it takes bets. */
const bettable = (m: OnChainMarket, nowSec: number) => (m.state === MARKET_STATE.active || (m.state === MARKET_STATE.none && m.house)) && nowSec < openableUntil(m)
const active = (m: OnChainMarket) => m.state === MARKET_STATE.active

/** |up − down| / (up + down), compared as a/b < c/d ⇔ a·d < c·b. Zero-pot markets are excluded before. */
function closerThan(a: OnChainMarket, b: OnChainMarket): number {
  const ga = a.up > a.down ? a.up - a.down : a.down - a.up
  const gb = b.up > b.down ? b.up - b.down : b.down - b.up
  const left = ga * (b.up + b.down)
  const right = gb * (a.up + a.down)
  return left < right ? -1 : left > right ? 1 : 0
}

export function pulse(metric: PulseMetric, markets: readonly OnChainMarket[], nowSec: number, cap = 5): PulseRow[] {
  switch (metric) {
    case 'closing-soon':
      return markets
        .filter((m) => bettable(m, nowSec))
        .sort((a, b) => a.deadline - b.deadline || byId(a, b))
        .slice(0, cap)
        .map((market) => ({ market, figure: String(market.deadline) }))
    case 'largest-open-pot':
      return markets
        .filter(active)
        .sort((a, b) => (a.collateral > b.collateral ? -1 : a.collateral < b.collateral ? 1 : a.deadline - b.deadline || byId(a, b)))
        .slice(0, cap)
        .map((market) => ({ market, figure: market.collateral.toString() }))
    case 'closest-market':
      return markets
        .filter((m) => active(m) && m.up + m.down > 0n)
        .sort((a, b) => closerThan(a, b) || (a.collateral > b.collateral ? -1 : a.collateral < b.collateral ? 1 : byId(a, b)))
        .slice(0, cap)
        .map((market) => ({ market, figure: `${market.up.toString()}/${market.down.toString()}` }))
  }
}

/** The whole reading, with its honesty flags: what was read, when, and whether all of it came back. */
export function pulseReading(
  metric: PulseMetric,
  input: { markets: readonly OnChainMarket[]; problem: string | null; observedAt: number; stale: boolean },
  nowSec: number,
): PulseReading {
  const rows = pulse(metric, input.markets, nowSec)
  const state: PulseState = rows.length === 0 ? 'empty' : input.problem ? 'partial' : input.stale ? 'stale' : 'live'
  return { metric, rows, state, observedAt: input.observedAt }
}
