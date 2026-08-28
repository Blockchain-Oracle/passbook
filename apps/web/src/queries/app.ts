import { queryOptions, skipToken } from '@tanstack/react-query'
import { appContractsFromEnv, governanceWriteSafety, type AppContracts } from '@strk20/protocol/app-contracts'

const APP_MS = 30_000

let contracts: AppContracts | null = null

/** The deployed venue contracts, from the build's env. Absent means the surface says "not open yet". */
export function appContracts(): AppContracts {
  contracts ??= appContractsFromEnv({
    PASSBOOK_MARKETS_ADDRESS: import.meta.env.VITE_PASSBOOK_MARKETS_ADDRESS,
    PASSBOOK_LAUNCH_ADDRESS: import.meta.env.VITE_PASSBOOK_LAUNCH_ADDRESS,
    PASSBOOK_PRAGMA_ADDRESS: import.meta.env.VITE_PASSBOOK_PRAGMA_ADDRESS,
    PASSBOOK_GOVERNANCE_ADDRESS: import.meta.env.VITE_PASSBOOK_GOVERNANCE_ADDRESS,
    PASSBOOK_GOVERNANCE_CLASS_HASH: import.meta.env.VITE_PASSBOOK_GOVERNANCE_CLASS_HASH,
  })
  return contracts
}

export function governanceWrites() {
  return governanceWriteSafety(appContracts())
}

export function marketsQuery() {
  const contract = appContracts().markets
  return queryOptions({
    queryKey: ['markets', contract ?? null],
    queryFn: contract
      ? async () => {
          const { readMarkets } = await import('@strk20/protocol/app-reads')
          return readMarkets(contract)
        }
      : skipToken,
    staleTime: APP_MS,
    refetchInterval: APP_MS,
  })
}

export function launchesQuery() {
  const contract = appContracts().launch
  return queryOptions({
    queryKey: ['launches', contract ?? null],
    queryFn: contract
      ? async () => {
          const { readLaunches } = await import('@strk20/protocol/app-reads')
          return readLaunches(contract)
        }
      : skipToken,
    staleTime: APP_MS,
    refetchInterval: APP_MS,
  })
}

export function housesQuery() {
  const contract = appContracts().governance
  return queryOptions({
    queryKey: ['houses', contract ?? null],
    queryFn: contract
      ? async () => {
          const { readHouses } = await import('@strk20/protocol/governance-reads')
          return readHouses(contract)
        }
      : skipToken,
    staleTime: APP_MS,
    refetchInterval: APP_MS,
  })
}

export function proposalsQuery() {
  const contract = appContracts().governance
  return queryOptions({
    queryKey: ['proposals', contract ?? null],
    queryFn: contract
      ? async () => {
          const { readProposals } = await import('@strk20/protocol/governance-reads')
          return readProposals(contract)
        }
      : skipToken,
    staleTime: APP_MS,
    refetchInterval: APP_MS,
  })
}

/** A bearer position on the Markets contract, by its commitment. Absent contract → skipped. */
export function marketPositionQuery(commitment: string | undefined) {
  const contract = appContracts().markets
  return queryOptions({
    queryKey: ['position', 'market', commitment ?? null],
    queryFn:
      contract && commitment
        ? async () => {
            const { readMarketPosition } = await import('@strk20/protocol/position-reads')
            return readMarketPosition(contract, commitment)
          }
        : skipToken,
    staleTime: APP_MS,
  })
}

export function launchPositionQuery(commitment: string | undefined) {
  const contract = appContracts().launch
  return queryOptions({
    queryKey: ['position', 'launch', commitment ?? null],
    queryFn:
      contract && commitment
        ? async () => {
            const { readLaunchPosition } = await import('@strk20/protocol/position-reads')
            return readLaunchPosition(contract, commitment)
          }
        : skipToken,
    staleTime: APP_MS,
  })
}
