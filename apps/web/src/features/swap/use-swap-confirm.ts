import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { SendStage } from '@strk20/protocol/pipeline-stage'
import { buildSwap, type Quote } from '@strk20/protocol/quote'

import { sendProblem, useSend } from '@/mutations'
import { failureTransactionHash } from '@/mutations/describe'
import type { SwapSide } from './sides'

export type SwapPhase = 'building' | SendStage | null

export interface SwapConfirmAsk {
  sell: SwapSide
  buy: SwapSide
  quote: Quote
  slippageBps: number
  minOutWei: bigint
  /** Whether the review sheet's sponsorship toggle was on AND a unit was there. */
  sponsored?: boolean
}

export type SwapOutcome =
  | { ok: true; transactionHash: string }
  | { ok: false; problem: string; transactionHash: string | null }

/**
 * Confirm = build the venue's calls for this quote, then one `useSend` of kind `swap`. The
 * executor comes from the build, never from a constant; a build without one is refused there.
 */
export function useSwapConfirm() {
  const send = useSend()
  const [phase, setPhase] = useState<SwapPhase>(null)

  const mutation = useMutation({
    mutationKey: ['swap', 'confirm'],
    mutationFn: async (ask: SwapConfirmAsk): Promise<SwapOutcome> => {
      setPhase('building')
      const built = await buildSwap(ask.quote.quoteId, ask.slippageBps)
      if (built.state !== 'built') return { ok: false, problem: built.because, transactionHash: null }

      const result = await send.mutateAsync({
        kind: 'swap',
        recipient: built.plan.executorAddress,
        token: ask.sell.address,
        symbol: ask.sell.symbol,
        amount: ask.quote.sellAmount,
        ...(ask.sponsored ? { sponsored: true } : {}),
        swap: {
          executor: built.plan.executorAddress,
          buyToken: ask.buy.address,
          buySymbol: ask.buy.symbol,
          calls: built.plan.calls,
          minOutWei: ask.minOutWei,
        },
        onStage: setPhase,
      })
      if (result.ok) return { ok: true, transactionHash: result.transactionHash }
      return {
        ok: false,
        problem: sendProblem(result) ?? 'The swap stopped before anything was sent.',
        transactionHash: failureTransactionHash(result.failure),
      }
    },
    onSettled: () => setPhase(null),
  })

  const problem =
    mutation.data && !mutation.data.ok ? mutation.data.problem : mutation.error ? mutation.error.message : null

  return {
    confirm: mutation.mutateAsync,
    phase,
    busy: mutation.isPending,
    outcome: mutation.data,
    problem,
    reset: mutation.reset,
  }
}
