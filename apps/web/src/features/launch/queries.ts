import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
// `app-reads` is a fetch-only leaf (constants only), so it rides the eager chunk like the cards that render it.
import { quoteBuy, type OnChainLaunch } from '@strk20/protocol/app-reads'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { appContracts, launchesQuery, useChainFeed } from '@/queries'
import { FEED_FALLBACK_POLL_MS } from '@/queries/chain-feed'
import { findToken, tokenListQuery } from '@/queries/tokens'
import { shortAddress } from '@/lib/format'

const QUOTE_MS = 15_000

/** `quote_buy` — the contract is the only party that prices a batch across an epoch boundary. */
export function quoteBuyQuery(launchId: number, units: number | null) {
  const contract = appContracts().launch
  return queryOptions({
    queryKey: ['launch', 'quote', launchId, units],
    queryFn:
      contract && units !== null && units > 0
        ? async () =>
            // Stringified at the boundary: a bigint in a query result is fine, in a key it throws.
            (await quoteBuy(contract, launchId, units)).toString()
        : skipToken,
    staleTime: QUOTE_MS,
  })
}

export interface LaunchBoard {
  launches: OnChainLaunch[]
  total: number
  loading: boolean
  problem: string | null
  live: boolean
}

/** The board's one source of rows: `launchesQuery`. The stream writes into it; TanStack polls otherwise. */
export function useLaunchBoard(): LaunchBoard {
  const feed = useChainFeed()
  const live = feed.state === 'live'
  const rows = useQuery({
    ...launchesQuery(),
    refetchInterval: live ? false : FEED_FALLBACK_POLL_MS,
    staleTime: FEED_FALLBACK_POLL_MS,
  })
  return {
    launches: rows.data?.launches ?? [],
    total: rows.data?.total ?? 0,
    loading: rows.isPending && !rows.isError,
    problem: feed.problem ?? rows.data?.problem ?? (rows.error ? String(rows.error) : null),
    live,
  }
}

export function useLaunch(id: number): { launch: OnChainLaunch | null; loading: boolean } {
  const board = useLaunchBoard()
  return { launch: board.launches.find((l) => l.id === id) ?? null, loading: board.loading }
}

export interface StakeToken {
  symbol: string
  /** `null` when the list does not verify the scale — renderers then show raw units, never a guessed 18. */
  decimals: number | null
  info: TokenInfo | null
}

/** The stake token's identity from the list; an unlisted one renders as its short address. */
export function useStakeToken(address: string): StakeToken {
  const list = useQuery(tokenListQuery())
  const info = findToken(list.data, address)
  return { symbol: info?.symbol ?? shortAddress(address, 6, 3), decimals: info?.decimals ?? null, info }
}
