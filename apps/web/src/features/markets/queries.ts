import { queryOptions, skipToken } from '@tanstack/react-query'

import { appContracts } from '@/queries/app'

const QUOTE_MS = 10_000

/** `quote_bet` — the tickets a stake buys right now. Amount as text: bigint in a key throws. */
export function betQuoteQuery(marketId: number | undefined, side: number, amountWei: bigint | null) {
  const contract = appContracts().markets
  const amount = amountWei !== null && amountWei > 0n ? amountWei.toString() : null
  return queryOptions({
    queryKey: ['markets', 'quote', marketId ?? null, side, amount],
    queryFn:
      contract && marketId !== undefined && amount
        ? async () => {
            const { quoteBet } = await import('@strk20/protocol/app-reads')
            return quoteBet(contract, marketId, side, BigInt(amount))
          }
        : skipToken,
    staleTime: QUOTE_MS,
  })
}
