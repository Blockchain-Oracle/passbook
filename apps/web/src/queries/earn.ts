import { queryOptions, skipToken } from '@tanstack/react-query'
import type { EarnMarketDefinition } from '@strk20/protocol/earn-markets'
import type { EarnMarketSnapshot } from '@strk20/protocol/earn-reads'
import { positionsFrom, type EarnPosition } from '@strk20/protocol/earn-position'

import { queryClient } from '@/app/query-client'
import { appContracts } from './app'
import { shieldedQuery } from './shielded'

//
// Every chain read Earn does, as TanStack query options.
//
// One key prefix — `['earn', …]` — so `invalidateMoney()` can move all of it after a supply or a
// redeem with a single call, which matters because a transaction changes the position AND the
// market's share price AND its liquidity at the same instant.
//
// Rates move, so these refetch. But they refetch on a slower clock than the pool walk: a lending
// rate that shifts in the fourth decimal every twelve seconds is not news, and re-reading seven
// markets' worth of contracts that often would spend a lot of somebody's rate limit to redraw the
// same number.
//

const CATALOG_MS = 60_000
const POSITION_MS = 30_000

/**
 * All seven markets, validated and measured.
 *
 * Never rejects: `readCatalog` turns a dead read into a snapshot carrying a `blocker`, because one
 * market failing must not blank the other six. The rail renders whatever came back.
 */
export function earnCatalogQuery() {
  return queryOptions({
    queryKey: ['earn', 'catalog'],
    queryFn: async (): Promise<EarnMarketSnapshot[]> => {
      const [{ readCatalog }, { defaultTransport }] = await Promise.all([
        import('@strk20/protocol/earn-reads'),
        import('@strk20/protocol/app-reads'),
      ])
      return readCatalog(defaultTransport)
    },
    staleTime: CATALOG_MS,
    refetchInterval: CATALOG_MS,
  })
}

/**
 * The positions this account holds, from the note walk joined to the catalog's prices.
 *
 * Dependent on both through the client, so the walk is shared with every other balance on screen
 * and the prices are shared with the rail — one read of each, not one per consumer.
 */
export function earnPositionsQuery(address: string | undefined, accountKey: string | undefined) {
  return queryOptions({
    queryKey: ['earn', 'positions', address ?? null],
    queryFn:
      address && accountKey
        ? async (): Promise<EarnPosition[]> => {
            // `earn-position` is a pure leaf (registry + arithmetic, no I/O), so it rides in the
            // eager chunk with the surface that renders from it. Only the modules that reach the
            // network — `earn-reads`, `app-reads` — are worth splitting out.
            const [walk, catalog] = await Promise.all([
              queryClient.fetchQuery(shieldedQuery(address, accountKey)),
              // A failed catalog does not blank the position: shares are still known from the
              // walk, and the value renders as `—` until a price can be read again.
              queryClient.fetchQuery(earnCatalogQuery()).catch((): EarnMarketSnapshot[] => []),
            ])
            if (walk.state !== 'walked') return []
            const byId = new Map(catalog.map((snapshot) => [snapshot.market.marketId, snapshot]))
            return positionsFrom(walk.notes, (market: EarnMarketDefinition) => {
              const snapshot = byId.get(market.marketId)
              return {
                sharePriceWei: snapshot?.sharePriceWei ?? null,
                reserveWei: snapshot?.reserveWei ?? null,
                paused: snapshot?.paused ?? false,
              }
            })
          }
        : skipToken,
    staleTime: POSITION_MS,
    refetchInterval: POSITION_MS,
  })
}

/**
 * That the deployed helper is ours and the pool will let it deposit.
 *
 * Read at call time rather than trusted from the build. The pool keeps a BLOCKLIST of open-note
 * depositors, so a fresh helper works by default — but "by default" is a thing to check, and a
 * blocked one fails only after the fee has been spent.
 */
export function earnHelperQuery() {
  const helper = appContracts().vesuEarn
  return queryOptions({
    queryKey: ['earn', 'helper', helper ?? null],
    queryFn: helper
      ? async () => {
          const [{ checkHelper }, { defaultTransport }, { NET }] = await Promise.all([
            import('@strk20/protocol/earn-reads'),
            import('@strk20/protocol/app-reads'),
            import('@strk20/protocol/constants'),
          ])
          return checkHelper(helper, NET.pool, defaultTransport)
        }
      : skipToken,
    staleTime: 5 * 60_000,
  })
}

/** `preview_deposit` / `preview_redeem` for one amount. The market's own reckoning, not ours. */
export function earnQuoteQuery(market: EarnMarketDefinition | null, direction: 'supply' | 'redeem', amountWei: bigint | null) {
  const enabled = market !== null && amountWei !== null && amountWei > 0n
  return queryOptions({
    queryKey: ['earn', 'quote', market?.marketId ?? null, direction, String(amountWei ?? '')],
    queryFn: enabled
      ? async (): Promise<bigint> => {
          const [{ previewSupply, previewRedeem }, { defaultTransport }] = await Promise.all([
            import('@strk20/protocol/earn-reads'),
            import('@strk20/protocol/app-reads'),
          ])
          return direction === 'supply'
            ? previewSupply(market, amountWei, defaultTransport)
            : previewRedeem(market, amountWei, defaultTransport)
        }
      : skipToken,
    // A quote is about an amount the user is still typing; keeping it a moment avoids a read per
    // keystroke without ever showing a figure from a different amount.
    staleTime: 15_000,
  })
}
