import { queryOptions } from '@tanstack/react-query'
import type { PragmaReading } from '@strk20/protocol/pragma-pairs'

import { appContracts } from './app'

const PRICES_MS = 60_000

/** Pragma medians for BTC/ETH/STRK. One pair failing is one honest gap, not three blanks. */
export function pricesQuery() {
  return queryOptions({
    queryKey: ['prices'],
    queryFn: async (): Promise<PragmaReading[]> => {
      const { readAllMedians, PRAGMA_MAINNET } = await import('@strk20/protocol/pragma')
      return readAllMedians(appContracts().pragma ?? PRAGMA_MAINNET)
    },
    staleTime: PRICES_MS,
    refetchInterval: PRICES_MS,
  })
}
