//
// The live price feed. The one thing on these surfaces that is real before any deployment.
//
// ── IT POLLS, AND THE INTERVAL IS ARGUED RATHER THAN PICKED ──────────────────────────────
//
// A view call per pair per tick, three pairs, through a public RPC. Fifteen seconds is slower than
// the feed's own cadence (it publishes when sources move, and the day-0 measurement watched it sit
// eleven minutes) so nothing is missed by waiting, and it is fast enough that a chart moves while
// somebody is looking at it. Anything tighter would spend a stranger's RPC quota to re-read a
// number that had not changed.
//
// ── AND IT STOPS WHEN NOBODY IS LOOKING ──────────────────────────────────────────────────
//
// A hidden tab polls nothing. Three chain reads every fifteen seconds, forever, in a tab somebody
// left open a week ago is exactly the kind of thing that gets an origin rate-limited — and the
// value is worthless because no frame is being painted anyway. The first read on becoming visible
// again is immediate rather than one interval late.
//
// ── THE HISTORY IS THIS SESSION'S, AND IT SAYS SO ────────────────────────────────────────
//
// There is no price-history endpoint here, so the series a chart draws is what THIS page has
// watched since it opened. That is honest and it is thin — `PriceSeries.observed` is the count, so
// a surface can say "12 readings since you opened this" rather than implying a market history it
// does not have. Nothing is persisted: a stored series would become a claim about a past this
// browser did not witness.
//
import { useEffect, useRef, useState } from 'react'

import {
  PRAGMA_PAIR_LIST,
  type PragmaPair,
  type PragmaPrice,
  type PragmaReading,
} from '@strk20/protocol/pragma-pairs'

import { PRAGMA_ORACLE } from './app-contracts'

/** How often to re-read. See the header — slower than the feed, fast enough to watch. */
export const POLL_MS = 15_000

/** How many readings one pair's series keeps. Enough to draw a shape, bounded so it cannot grow. */
export const SERIES_BOUND = 120

export interface PriceSeries {
  /** Oldest first. What this page has watched, and nothing more. */
  points: readonly number[]
  /** How many readings have landed. The number a surface quotes rather than implying a history. */
  observed: number
}

export interface PragmaState {
  /** The latest reading per pair, or the reason there is not one. */
  readings: readonly PragmaReading[]
  /** Per pair, the series this session has observed. */
  series: Readonly<Record<PragmaPair, PriceSeries>>
  /** True until the first answer — distinct from "the oracle has no price". */
  loading: boolean
  /** Set when every pair failed. One pair failing is reported on that pair, not here. */
  problem: string | null
}

const EMPTY_SERIES: PriceSeries = { points: [], observed: 0 }

function emptyState(): PragmaState {
  return {
    readings: [],
    series: Object.fromEntries(PRAGMA_PAIR_LIST.map((p) => [p, EMPTY_SERIES])) as Record<
      PragmaPair,
      PriceSeries
    >,
    loading: true,
    problem: null,
  }
}

export function usePragma(pairs: readonly PragmaPair[] = PRAGMA_PAIR_LIST): PragmaState {
  const [state, setState] = useState<PragmaState>(emptyState)
  // The series live in a ref and are copied into state on each landing: keeping them in state and
  // appending would need the previous state inside an async callback, which is the classic way to
  // append to a stale array and silently lose readings.
  const series = useRef<Record<string, PriceSeries>>({})

  useEffect(() => {
    let live = true
    let timer: number | null = null

    const read = async () => {
      // Lazy for the gate's reason: `pragma.ts` reaches `rpc.ts`, which constructs a `RpcProvider`
      // from `starknet`. A static import here would put the SDK in whichever chunk imported this.
      const { readAllMedians } = await import('@strk20/protocol/pragma')
      const readings = await readAllMedians(PRAGMA_ORACLE, pairs)
      if (!live) return

      for (const reading of readings) {
        if (!reading.ok) continue
        const pair = reading.price.pair
        const held = series.current[pair] ?? EMPTY_SERIES
        const last = held.points[held.points.length - 1]
        //
        // THE COUNT MOVES ON EVERY READ; THE LINE ONLY ON A CHANGE.
        //
        // An unchanged reading is not appended to the series — the feed stalls for minutes and
        // padding it with repeats would draw a flat run that looks like a market holding steady
        // when it is really an oracle that has not published. But `observed` is what the surface
        // renders as "N readings this session", so counting only the changes made it report 1
        // after forty-four successful polls. Two different questions, incremented separately.
        //
        const observed = held.observed + 1
        if (last === reading.price.price) {
          series.current[pair] = { points: held.points, observed }
          continue
        }
        series.current[pair] = {
          points: [...held.points, reading.price.price].slice(-SERIES_BOUND),
          observed,
        }
      }

      setState({
        readings,
        series: Object.fromEntries(
          pairs.map((p) => [p, series.current[p] ?? EMPTY_SERIES]),
        ) as Record<PragmaPair, PriceSeries>,
        loading: false,
        problem: readings.every((r) => !r.ok)
          ? 'The price oracle could not be read, so these are not live prices.'
          : null,
      })
    }

    const tick = () => {
      // A hidden tab reads nothing — see the header.
      if (document.visibilityState !== 'visible') return
      void read().catch((error: unknown) => {
        if (!live) return
        //
        // `readAllMedians` settles per pair, so reaching here is a failed CHUNK LOAD rather than a
        // failed read. It has to REPORT, not just stop loading: with `readings` still empty and no
        // problem set, every cell fell through to "No price yet." and the surface was
        // indistinguishable from a first poll that had not landed — permanently, after a stale
        // deploy 404s the chunk.
        //
        // Previous readings are kept: a strip showing the last price it had, plus a line saying
        // the feed stopped, beats blanking three numbers somebody was reading.
        //
        setState((held) => ({
          ...held,
          loading: false,
          problem: `The price feed could not be loaded, so these are not live prices: ${String(error)}`,
        }))
      })
    }

    tick()
    timer = window.setInterval(tick, POLL_MS)
    // Reading immediately on becoming visible again, rather than waiting out an interval that
    // elapsed while the tab was in the background.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      live = false
      if (timer !== null) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // `pairs` is compared by its joined value: a caller passing an inline array literal would
    // otherwise restart the poll on every render.
  }, [pairs.join(',')])

  return state
}

/** The reading for one pair, or `null`. */
export function priceOf(state: PragmaState, pair: PragmaPair): PragmaPrice | null {
  for (const reading of state.readings) {
    if (reading.ok && reading.price.pair === pair) return reading.price
  }
  return null
}
