import { queryOptions, skipToken } from '@tanstack/react-query'
import { fetchForwardFee, type ForwardFeeResult } from '@strk20/protocol/bridge'
import type { CrowdReading } from '@strk20/protocol/crowd'

// The two reads this surface owns and the core lacks: the crowd (the meter's denominator) and
// Circle's forward fee. Both are fetch-only protocol modules — no chain client in either, so
// `bridge.ts` is imported statically (it is already eager via the token-list decimals table).

const CROWD_MS = 60_000
const FEE_MS = 30_000

/** Recent deposits, as the anonymity set the meter judges an exit against. Never throws. */
export function crowdQuery() {
  return queryOptions({
    queryKey: ['crowd'],
    queryFn: async (): Promise<CrowdReading> => {
      const { readCrowd } = await import('@strk20/protocol/crowd-rpc')
      return readCrowd()
    },
    staleTime: CROWD_MS,
    refetchInterval: CROWD_MS,
  })
}

/**
 * Circle's fee for this route at this amount. Keyed on the amount as a string — a bigint in a
 * query key throws. `skipToken` until there is an amount worth quoting.
 */
export function forwardFeeQuery(destinationDomain: number, amountWei: bigint | null) {
  const wei = amountWei !== null && amountWei > 0n ? amountWei : null
  return queryOptions({
    queryKey: ['bridge', 'forward-fee', destinationDomain, wei === null ? null : wei.toString()],
    queryFn: wei !== null ? (): Promise<ForwardFeeResult> => fetchForwardFee({ destinationDomain, amount: wei }) : skipToken,
    staleTime: FEE_MS,
  })
}
