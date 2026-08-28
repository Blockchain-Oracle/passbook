//
// The Houses' live state — houses and proposals, polled visibility-aware at block cadence.
//
// `use-app-reads.ts`'s old engine, deliberately: governance rows are not on the chain feed yet
// (the feed learns them when the deploy lands and M-next wires them), so this hook polls the
// browser-safe readers directly through the shared `pollWhileVisible` primitive. When the feed
// grows governance frames, this file becomes an adapter like its siblings — same API, new engine.
//
import { useEffect, useState } from 'react'

import {
  readHouses,
  readProposals,
  type OnChainHouse,
  type OnChainProposal,
} from '@strk20/protocol/governance-reads'

import { APP_CONTRACTS } from './app-contracts'
import { pollWhileVisible } from './poll-while-visible'

const POLL_MS = 30_000

export interface GovernanceRead {
  houses: OnChainHouse[]
  housesTotal: number
  proposals: OnChainProposal[]
  proposalsTotal: number
  problem: string | null
  loading: boolean
}

const EMPTY: GovernanceRead = {
  houses: [],
  housesTotal: 0,
  proposals: [],
  proposalsTotal: 0,
  problem: null,
  loading: true,
}

export function useGovernance(): GovernanceRead {
  const [state, setState] = useState<GovernanceRead>(EMPTY)

  useEffect(() => {
    const contract = APP_CONTRACTS.governance
    if (!contract) {
      setState({ ...EMPTY, loading: false })
      return
    }
    let live = true
    const stop = pollWhileVisible(() => {
      void Promise.all([readHouses(contract), readProposals(contract)]).then(
        ([houses, proposals]) => {
          if (!live) return
          setState({
            houses: houses.houses,
            housesTotal: houses.total,
            proposals: proposals.proposals,
            proposalsTotal: proposals.total,
            problem: houses.problem ?? proposals.problem,
            loading: false,
          })
        },
        (error: unknown) => {
          if (!live) return
          // Previous rows keep standing — they were true when read.
          setState((prev) => ({
            ...prev,
            loading: false,
            problem: `The Houses could not be read: ${error instanceof Error ? error.message : String(error)}`,
          }))
        },
      )
    }, POLL_MS)
    return () => {
      live = false
      stop()
    }
  }, [])

  return state
}
