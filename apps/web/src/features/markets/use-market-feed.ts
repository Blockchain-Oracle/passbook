import { useQuery } from '@tanstack/react-query'
import { MARKET_STATE, type OnChainMarket } from '@strk20/protocol/app-reads'
import type { PricePoint, TapeItem, WirePrice } from '@strk20/protocol/chain-feed-wire'
import type { PragmaReading } from '@strk20/protocol/pragma-pairs'

import { appContracts, marketsQuery, pricesQuery, useChainFeed, type ChainFeedState } from '@/queries'
import { FEED_FALLBACK_POLL_MS } from '@/queries/chain-feed'

export interface MarketFeed {
  deployed: boolean
  state: ChainFeedState
  loading: boolean
  markets: readonly OnChainMarket[]
  open: readonly OnChainMarket[]
  settled: readonly OnChainMarket[]
  prices: Readonly<Record<string, WirePrice>>
  history: Readonly<Record<string, readonly PricePoint[]>>
  tape: readonly TapeItem[]
  problem: string | null
}

/**
 * The board's one source of rows: `marketsQuery`. The live stream writes into that same cache;
 * while it is not live, TanStack polls the registry read instead.
 */
export function useMarketFeed(): MarketFeed {
  const feed = useChainFeed()
  const live = feed.state === 'live'
  const registry = useQuery({
    ...marketsQuery(),
    refetchInterval: live ? false : FEED_FALLBACK_POLL_MS,
    staleTime: FEED_FALLBACK_POLL_MS,
  })
  // Prices while the stream is down: the Pragma read, dated by when it was fetched — not "live".
  const polled = useQuery({ ...pricesQuery(), enabled: !live })
  const deployed = Boolean(appContracts().markets)

  const markets = registry.data?.markets ?? []
  const loading = registry.isPending && deployed
  const problem = feed.problem ?? registry.data?.problem ?? (registry.error ? String(registry.error) : null)
  const prices = live || !polled.data ? feed.prices : polledPrices(polled.data, polled.dataUpdatedAt, feed.prices)

  return {
    deployed,
    state: feed.state,
    loading,
    markets,
    open: markets.filter((m) => m.state === MARKET_STATE.active),
    settled: markets.filter((m) => m.state !== MARKET_STATE.active),
    prices,
    history: feed.history,
    tape: feed.tape,
    problem,
  }
}

function polledPrices(readings: readonly PragmaReading[], at: number, held: Readonly<Record<string, WirePrice>>): Readonly<Record<string, WirePrice>> {
  const next: Record<string, WirePrice> = { ...held }
  for (const reading of readings) {
    if (reading.ok) next[reading.price.pair] = { ...reading.price, at }
  }
  return next
}

export function findMarket(markets: readonly OnChainMarket[], id: number): OnChainMarket | undefined {
  return markets.find((m) => m.id === id)
}
