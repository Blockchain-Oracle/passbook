import { queryOptions, skipToken } from '@tanstack/react-query'
import type { DiscoveryResult } from '@strk20/protocol/discovery'
import type { ShieldedBalance } from '@strk20/protocol/balances'

import { queryClient } from '@/app/query-client'
import { decimalsTable, tokenListQuery } from './tokens'

const SHIELDED_MS = 20_000

/**
 * The pool walk: every note this key can open, plus the wallet data a send spends from.
 * The result never throws — `unreachable` is a state, and the UI renders it as a gap, not zero.
 */
export function shieldedQuery(address: string | undefined, accountKey: string | undefined) {
  return queryOptions({
    queryKey: ['shielded', address ?? null],
    queryFn:
      address && accountKey
        ? async (): Promise<DiscoveryResult> => {
            const { discoverWallet } = await import('@strk20/protocol/discovery')
            return discoverWallet(address, accountKey)
          }
        : skipToken,
    staleTime: SHIELDED_MS,
    refetchInterval: SHIELDED_MS,
  })
}

/**
 * The walk summed per token, with decimals from the list. Dependent on `shieldedQuery` through the
 * client so both keys share one walk; `fetchQuery` honours staleness and invalidation.
 */
export function shieldedBalanceQuery(address: string | undefined, accountKey: string | undefined) {
  return queryOptions({
    queryKey: ['shielded', address ?? null, 'balance'],
    queryFn:
      address && accountKey
        ? async (): Promise<ShieldedBalance> => {
            const [{ balancesFrom }, read, tokens] = await Promise.all([
              import('@strk20/protocol/balances'),
              queryClient.fetchQuery(shieldedQuery(address, accountKey)),
              // The list is a convenience for decimals; a failed list must not blank the balance.
              queryClient.fetchQuery(tokenListQuery()).catch(() => undefined),
            ])
            return balancesFrom(read, { decimals: decimalsTable(tokens) })
          }
        : skipToken,
    staleTime: SHIELDED_MS,
    refetchInterval: SHIELDED_MS,
  })
}
