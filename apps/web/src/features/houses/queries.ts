import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
import type { OnChainHouse, OnChainProposal } from '@strk20/protocol/governance-reads'

import { appContracts, governanceWrites, housesQuery, proposalsQuery } from '@/queries'

const ACCUMULATOR_MS = 30_000

/** The contract's EC accumulators for one proposal — the lock the record page shows the reader. */
export function accumulatorsQuery(proposalId: number | undefined, options: number | undefined) {
  const contract = appContracts().governance
  return queryOptions({
    queryKey: ['houses', 'accumulators', proposalId ?? null, options ?? null],
    queryFn:
      contract && proposalId !== undefined && options !== undefined
        ? async () => {
            const { readAccumulators } = await import('@strk20/protocol/governance-reads')
            return readAccumulators(contract, proposalId, options)
          }
        : skipToken,
    staleTime: ACCUMULATOR_MS,
    refetchInterval: ACCUMULATOR_MS,
  })
}

export interface GovernanceRead {
  houses: OnChainHouse[]
  proposals: OnChainProposal[]
  loading: boolean
  /** One sentence when either read failed; rows that arrived still render. */
  problem: string | null
  deployed: boolean
  writes: ReturnType<typeof governanceWrites>
}

/** Houses + proposals as one reading, with the write-safety verdict beside it. */
export function useGovernanceRead(): GovernanceRead {
  const houses = useQuery(housesQuery())
  const proposals = useQuery(proposalsQuery())
  const deployed = Boolean(appContracts().governance)
  const problems = [
    houses.error ? `The DAOs could not be read: ${houses.error.message}` : houses.data?.problem,
    proposals.error ? `The proposals could not be read: ${proposals.error.message}` : proposals.data?.problem,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  return {
    houses: houses.data?.houses ?? [],
    proposals: proposals.data?.proposals ?? [],
    loading: deployed && (houses.isPending || proposals.isPending),
    problem: problems[0] ?? null,
    deployed,
    writes: governanceWrites(),
  }
}
