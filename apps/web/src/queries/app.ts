import { queryOptions, skipToken } from '@tanstack/react-query'
import { appContractsFromEnv, governanceWriteSafety, type AppContracts } from '@strk20/protocol/app-contracts'

const APP_MS = 30_000

let contracts: AppContracts | null = null

/** The deployed venue contracts, from the build's env. Absent means the surface says "not open yet". */
export function appContracts(): AppContracts {
  contracts ??= appContractsFromEnv({
    APP_MARKETS_ADDRESS: import.meta.env.VITE_APP_MARKETS_ADDRESS,
    APP_MARKETS_V1_ADDRESS: import.meta.env.VITE_APP_MARKETS_V1_ADDRESS,
    APP_LAUNCH_ADDRESS: import.meta.env.VITE_APP_LAUNCH_ADDRESS,
    APP_PRAGMA_ADDRESS: import.meta.env.VITE_APP_PRAGMA_ADDRESS,
    APP_GOVERNANCE_ADDRESS: import.meta.env.VITE_APP_GOVERNANCE_ADDRESS,
    APP_GOVERNANCE_CLASS_HASH: import.meta.env.VITE_APP_GOVERNANCE_CLASS_HASH,
    APP_MAILBOX_ADDRESS: import.meta.env.VITE_APP_MAILBOX_ADDRESS,
    APP_MAILBOX_BLOCK: import.meta.env.VITE_APP_MAILBOX_BLOCK,
    APP_VESU_EARN_ADDRESS: import.meta.env.VITE_APP_VESU_EARN_ADDRESS,
    APP_VESU_EARN_BLOCK: import.meta.env.VITE_APP_VESU_EARN_BLOCK,
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

/** The house float idle in Markets for `token`. Absent contract → skipped; unreadable → `—`. */
export function houseFloatQuery(token: string) {
  const contract = appContracts().markets
  return queryOptions({
    queryKey: ['markets', 'float', contract ?? null, token],
    queryFn: contract
      ? async () => {
          const { readFloat } = await import('@strk20/protocol/app-reads')
          return readFloat(contract, token)
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

/**
 * One market by id, for a position whose window has rolled off the board: the board keeps the
 * current and last window of each series, a claim can be older than both, and a claim on a market
 * this build cannot describe used to read as "Retired" — which is a bet nobody can collect.
 */
export function marketByIdQuery(marketId: number | undefined) {
  const contract = appContracts().markets
  return queryOptions({
    queryKey: ['markets', 'one', contract ?? null, marketId ?? null],
    queryFn:
      contract && marketId !== undefined
        ? async () => {
            const { readMarket } = await import('@strk20/protocol/app-reads')
            return readMarket(contract, marketId)
          }
        : skipToken,
    staleTime: APP_MS,
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
