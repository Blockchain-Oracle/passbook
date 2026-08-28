//
// The live Markets and Launch lists — what the chain says is open, polled at block cadence.
//
// Same architecture as `use-pragma.ts` for the same budget reason: `app-reads.ts` is raw
// `starknet_call` over `fetch` with pinned selectors, so these hooks cost the eager chunk nothing.
// The poll is block cadence — a market's pot moves when a transaction lands, and Starknet blocks
// arrive on the order of tens of seconds, so anything faster is battery spent on a value that
// cannot have changed.
//
import { useEffect, useState } from 'react'

import {
  readLaunches,
  readMarkets,
  type OnChainLaunch,
  type OnChainMarket,
} from '@strk20/protocol/app-reads'

import { APP_CONTRACTS } from './app-contracts'

const POLL_MS = 30_000

export interface MarketsRead {
  markets: OnChainMarket[]
  total: number
  /** One sentence when part of the read failed. The rows that arrived still render. */
  problem: string | null
  /** True until the FIRST answer, success or failure — the "has anything looked yet" bit. */
  loading: boolean
}

export interface LaunchesRead {
  launches: OnChainLaunch[]
  total: number
  problem: string | null
  loading: boolean
}

/** The market list, or the honest empty when the contract is absent from this build. */
export function useMarkets(): MarketsRead {
  const [state, setState] = useState<MarketsRead>({ markets: [], total: 0, problem: null, loading: true })

  useEffect(() => {
    const contract = APP_CONTRACTS.markets
    if (!contract) {
      setState({ markets: [], total: 0, problem: null, loading: false })
      return
    }
    let live = true
    const tick = () =>
      readMarkets(contract).then(
        (out) => {
          if (live) setState({ ...out, loading: false })
        },
        (error: unknown) => {
          // A failed read leaves the previous rows standing — they were true when read — and adds
          // the sentence. Blanking the list on a flaky RPC would render "no markets" over markets.
          if (live) {
            setState((prev) => ({
              ...prev,
              loading: false,
              problem: `The markets could not be read: ${error instanceof Error ? error.message : String(error)}`,
            }))
          }
        },
      )
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  return state
}

/** The launch list — same contract, same grammar. */
export function useLaunches(): LaunchesRead {
  const [state, setState] = useState<LaunchesRead>({ launches: [], total: 0, problem: null, loading: true })

  useEffect(() => {
    const contract = APP_CONTRACTS.launch
    if (!contract) {
      setState({ launches: [], total: 0, problem: null, loading: false })
      return
    }
    let live = true
    const tick = () =>
      readLaunches(contract).then(
        (out) => {
          if (live) setState({ ...out, loading: false })
        },
        (error: unknown) => {
          if (live) {
            setState((prev) => ({
              ...prev,
              loading: false,
              problem: `The launches could not be read: ${error instanceof Error ? error.message : String(error)}`,
            }))
          }
        },
      )
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  return state
}
