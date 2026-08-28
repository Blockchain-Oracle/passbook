//
// The live Markets and Launch lists — the same two hooks the panels always had, now fed by the
// chain-feed store instead of a private interval each.
//
// The engine moved, the contract did not: `chain-feed.ts` holds one relayer stream plus the
// fallback polling both hooks used to run for themselves (visibility-aware now, which the old
// intervals were not), and these adapters just shape its snapshot into the panels' vocabulary.
// A surface cannot tell which engine answered — that is the point.
//
import { useMemo } from 'react'

import type { OnChainLaunch, OnChainMarket } from '@strk20/protocol/app-reads'

import { APP_CONTRACTS } from './app-contracts'
import { useChainFeed } from './chain-feed'

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
  const feed = useChainFeed()
  return useMemo(() => {
    if (!APP_CONTRACTS.markets) return { markets: [], total: 0, problem: null, loading: false }
    return {
      markets: feed.markets,
      total: feed.marketsTotal,
      problem: feed.problem,
      loading: !feed.appAnswered,
    }
  }, [feed])
}

/** The launch list — same contract, same grammar. */
export function useLaunches(): LaunchesRead {
  const feed = useChainFeed()
  return useMemo(() => {
    if (!APP_CONTRACTS.launch) return { launches: [], total: 0, problem: null, loading: false }
    return {
      launches: feed.launches,
      total: feed.launchesTotal,
      problem: feed.problem,
      loading: !feed.appAnswered,
    }
  }, [feed])
}
