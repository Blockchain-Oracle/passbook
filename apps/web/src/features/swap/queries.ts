import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
// `quote.ts` is a fetch-only leaf (no SDK, no `starknet`), so it may load eagerly with the form.
import { fetchQuote, type QuoteResult } from '@strk20/protocol/quote'

import { relayerPost } from '@/lib/relayer'

/** A quote ages fast; stale == refetch so a focus never shows a dead price. */
const QUOTE_MS = 15_000

export interface QuoteAsk {
  sellToken: string | null
  buyToken: string | null
  /** Smallest units of the sell token. `null` or `0n` asks nothing. */
  sellAmount: bigint | null
}

/**
 * The venue reached through the relayer's allowlisted proxy (`POST /api/quote`, target
 * `avnuQuotes`): the aggregator sees the relay's address and a bare path, never the visitor's IP
 * beside the pair and size. `quoteUrl` builds the identical URL; only the caller changes.
 */
async function proxiedJson(url: string): Promise<unknown> {
  const upstream = new URL(url)
  return relayerPost('/api/quote', {
    target: 'avnuQuotes',
    path: upstream.pathname,
    query: Object.fromEntries(upstream.searchParams),
  })
}

export function quoteIsLive(ask: QuoteAsk): boolean {
  return ask.sellToken !== null && ask.buyToken !== null && ask.sellAmount !== null && ask.sellAmount > 0n
}

/** One AVNU quote per (sell, buy, amount). The previous quote stays on screen while the next loads. */
export function swapQuoteQuery(ask: QuoteAsk) {
  const { sellToken, buyToken, sellAmount } = ask
  return queryOptions({
    // bigint stringified: `hashKey` is JSON.stringify and would throw on the raw value.
    queryKey: ['swap', 'quote', sellToken, buyToken, sellAmount?.toString() ?? null],
    queryFn:
      sellToken && buyToken && sellAmount !== null && sellAmount > 0n
        ? (): Promise<QuoteResult> => fetchQuote({ sellToken, buyToken, sellAmount }, { fetchJson: proxiedJson })
        : skipToken,
    placeholderData: keepPreviousData,
    staleTime: QUOTE_MS,
    refetchInterval: QUOTE_MS,
  })
}
