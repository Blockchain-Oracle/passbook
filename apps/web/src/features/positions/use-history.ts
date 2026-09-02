// The finished bets, reconciled: one query for the store, one per receipt against the chain, and
// one effect that writes back what the chain said. The queries stay pure; this is the one writer.
import { useEffect, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { OnChainMarket } from '@strk20/protocol/app-reads'
import type { MarketReceipt } from '@strk20/protocol/position-history'

import { findToken, marketsQuery, tokenListQuery } from '@/queries'
import { applyFacts, historyQuery, patchReceipt, receiptIsFinal, receiptReconcileQuery } from '@/queries/position-history'
import { removeStoredPosition } from '@/queries/positions'

export interface HistoryRead {
  status: 'pending' | 'corrupt' | 'ok'
  because: string | null
  /** Receipts whose story has an ending, newest first. */
  finished: MarketReceipt[]
  markets: readonly OnChainMarket[]
  tokens: Parameters<typeof findToken>[0] | undefined
}

const NONE: readonly MarketReceipt[] = []

export function useMarketHistory(now: number, enabled: boolean): HistoryRead {
  const history = useQuery({ ...historyQuery(), enabled })
  const markets = useQuery(marketsQuery())
  const tokens = useQuery(tokenListQuery())
  const receipts = useMemo(() => (history.data?.state === 'ok' ? history.data.receipts : NONE), [history.data])
  const marketList = useMemo(() => markets.data?.markets ?? [], [markets.data])
  const marketFor = (r: MarketReceipt) => marketList.find((m) => m.id === r.marketId) ?? null

  const reads = useQueries({ queries: receipts.map((r) => receiptReconcileQuery(r, marketFor(r), now)) })

  // Fold the chain's answers back into the store. A receipt the chain called reverted also retires
  // the secret that named it: nothing is on chain for that secret to claim.
  useEffect(() => {
    reads.forEach((read, i) => {
      const receipt = receipts[i]
      if (!read.data || !receipt) return
      const next = applyFacts(receipt, read.data)
      if (next === receipt) return
      void patchReceipt(receipt.commitment, () => next)
        .then(() => {
          if (next.opening.state === 'reverted' && receipt.opening.state !== 'reverted') return removeStoredPosition(receipt.commitment)
          return undefined
        })
        .catch((e: unknown) => console.warn('position history: the chain answered but the receipt could not be written', e))
    })
    // The reads' data identities are what change when the chain answers; `receipts` re-keys them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads.map((r) => r.dataUpdatedAt).join(','), receipts])

  const finished = useMemo(() => receipts.filter(receiptIsFinal).sort((a, b) => b.updatedAt - a.updatedAt), [receipts])

  if (!enabled) return { status: 'ok', because: null, finished: [], markets: marketList, tokens: tokens.data }
  if (history.isPending) return { status: 'pending', because: null, finished: [], markets: marketList, tokens: tokens.data }
  if (history.data?.state === 'corrupt') return { status: 'corrupt', because: history.data.because, finished: [], markets: marketList, tokens: tokens.data }
  return { status: 'ok', because: null, finished, markets: marketList, tokens: tokens.data }
}
