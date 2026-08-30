import { queryOptions, skipToken } from '@tanstack/react-query'
import { appContractsFromEnv, governanceWriteSafety, type AppContracts } from '@strk20/protocol/app-contracts'

const APP_MS = 30_000

let contracts: AppContracts | null = null

/** The deployed venue contracts, from the build's env. Absent means the surface says "not open yet". */
export function appContracts(): AppContracts {
  contracts ??= appContractsFromEnv({
    APP_MARKETS_ADDRESS: import.meta.env.VITE_APP_MARKETS_ADDRESS,
    APP_MARKETS_LEGACY_ADDRESS: import.meta.env.VITE_APP_MARKETS_LEGACY_ADDRESS,
    APP_LAUNCH_ADDRESS: import.meta.env.VITE_APP_LAUNCH_ADDRESS,
    APP_PRAGMA_ADDRESS: import.meta.env.VITE_APP_PRAGMA_ADDRESS,
    APP_GOVERNANCE_ADDRESS: import.meta.env.VITE_APP_GOVERNANCE_ADDRESS,
    APP_GOVERNANCE_CLASS_HASH: import.meta.env.VITE_APP_GOVERNANCE_CLASS_HASH,
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

/**
 * Markets on the SUPERSEDED contract, for positions only — never the board.
 *
 * A claim on a pre-migration bet needs its market's STATE and DEADLINE to know which door to
 * offer; without them `marketPositionAction` is never called and the row renders as "Reading"
 * forever, which is a settled bet with no Claim button on it. Kept out of `marketsQuery` on
 * purpose: that one feeds the board and the live stream writes into its cache, so merging a
 * retired contract into it would both pollute the board and be clobbered by the next tape frame.
 */
export function legacyMarketsQuery() {
  const contract = appContracts().marketsLegacy
  return queryOptions({
    queryKey: ['markets', 'legacy', contract ?? null],
    queryFn: contract
      ? async () => {
          const { readMarkets } = await import('@strk20/protocol/app-reads')
          return readMarkets(contract)
        }
      : skipToken,
    // A retired contract does not gain markets. Read it once.
    staleTime: Infinity,
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
/**
 * One market position, read from the contract it actually lives on.
 *
 * A bet opened before the v2 migration is recorded on the OLD Markets address. Asking only the
 * current one returns an empty position, which `marketPositionAction` reads as "not open yet" and
 * the board renders as STILL RUNNING — on a market that resolved days ago, hiding a payout its
 * holder can no longer reach. So a miss on the current contract falls back to the superseded one,
 * and the answer carries the address it came from because the claim has to go back to the same
 * place.
 */
export function marketPositionQuery(commitment: string | undefined) {
  const { markets, marketsLegacy } = appContracts()
  return queryOptions({
    queryKey: ['position', 'market', commitment ?? null],
    queryFn:
      markets && commitment
        ? async () => {
            const { readMarketPosition } = await import('@strk20/protocol/position-reads')
            const current = await readMarketPosition(markets, commitment)
            // `state === 0` is "this contract has never heard of that commitment".
            if (current.state !== 0 || !marketsLegacy) return { ...current, contract: markets }
            const legacy = await readMarketPosition(marketsLegacy, commitment).catch(() => null)
            return legacy && legacy.state !== 0 ? { ...legacy, contract: marketsLegacy } : { ...current, contract: markets }
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
