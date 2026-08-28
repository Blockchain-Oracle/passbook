//
// The live price feed — the same `usePragma` the strip always rendered, now fed by the
// chain-feed store.
//
// WHAT CHANGED UNDERNEATH, honestly: the series used to be "what THIS page has watched since it
// opened", because there was no price-history source anywhere. The relayer's feed now carries the
// history IT witnessed — up to 24 hours of readings that survive this tab's reloads — so a chart
// finally opens with a past. When the stream is down, the store's fallback polls the oracle
// directly (the read this hook used to own, visibility rules kept) and the series degrades to
// session-observed again, which `observed` still counts faithfully: it is the number of points in
// the line, wherever they were witnessed from.
//
import { useMemo } from 'react'

import {
  PRAGMA_PAIR_LIST,
  type PragmaPair,
  type PragmaPrice,
  type PragmaReading,
} from '@strk20/protocol/pragma-pairs'

import { useChainFeed } from './chain-feed'

export interface PriceSeries {
  /** Oldest first. The feed's witnessed history, or this session's when the feed is down. */
  points: readonly number[]
  /** How many readings the line holds — the number a surface quotes, never an implied history. */
  observed: number
}

export interface PragmaState {
  /** The latest reading per pair, or the reason there is not one. */
  readings: readonly PragmaReading[]
  /** Per pair, the series behind the line. */
  series: Readonly<Record<PragmaPair, PriceSeries>>
  /** True until the first answer — distinct from "the oracle has no price". */
  loading: boolean
  /** Set when the whole feed failed. One pair failing is reported on that pair, not here. */
  problem: string | null
}

const EMPTY_SERIES: PriceSeries = { points: [], observed: 0 }

export function usePragma(pairs: readonly PragmaPair[] = PRAGMA_PAIR_LIST): PragmaState {
  const feed = useChainFeed()

  return useMemo(() => {
    const readings: PragmaReading[] = feed.pricesAnswered
      ? pairs.map((pair) => {
          const wire = feed.prices[pair]
          if (!wire) return { ok: false, pair, because: 'No reading has arrived for this pair yet.' }
          const price: PragmaPrice = {
            pair,
            price: wire.price,
            decimals: wire.decimals,
            timestamp: wire.timestamp,
            sources: wire.sources,
          }
          return { ok: true, price }
        })
      : []

    const series = Object.fromEntries(
      pairs.map((pair) => {
        const held = feed.history[pair]
        if (!held || held.length === 0) return [pair, EMPTY_SERIES]
        return [pair, { points: held.map((point) => point.p), observed: held.length }]
      }),
    ) as Record<PragmaPair, PriceSeries>

    return { readings, series, loading: !feed.pricesAnswered, problem: feed.problem }
  }, [feed, pairs.join(',')])
}

/** The reading for one pair, or `null`. */
export function priceOf(state: PragmaState, pair: PragmaPair): PragmaPrice | null {
  for (const reading of state.readings) {
    if (reading.ok && reading.price.pair === pair) return reading.price
  }
  return null
}
