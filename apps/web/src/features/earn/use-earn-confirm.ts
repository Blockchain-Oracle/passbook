import { useMutation } from '@tanstack/react-query'
import { earnTokens } from '@strk20/protocol/earn-calldata'
import type { EarnMarketDefinition } from '@strk20/protocol/earn-markets'
import type { SendResult } from '@strk20/protocol/send'
import type { SendStage } from '@strk20/protocol/pipeline-stage'

import { appContracts } from '@/queries/app'
import { sendProblem, useSend } from '@/mutations/use-send'
import { useRefusal } from '@/components/money/refusal'
import { useState } from 'react'

export type EarnPhase = SendStage | 'idle' | null

export interface EarnConfirmAsk {
  direction: 'supply' | 'redeem'
  market: EarnMarketDefinition
  /** Underlying on a supply; an EXACT share count on a redeem. */
  amount: bigint
  /** What the review said would come back, for the receipt's wording. */
  expectedOutWei: bigint
}

/**
 * One supply or one redeem, through the shared pipeline.
 *
 * Deliberately thin: everything that decides whether this is safe lives below it — the free
 * pre-flight, the span guard, the lock, the fee re-read. This assembles the leg and hands it over.
 *
 * No `sponsored` argument. Earn is submitted by the user's own account, so the review sheet is
 * given no sponsor offer and the flag would have nowhere honest to come from.
 */
export function useEarnConfirm() {
  const send = useSend()
  const refusal = useRefusal()
  const [phase, setPhase] = useState<EarnPhase>(null)

  const mutation = useMutation({
    mutationKey: ['earn', 'confirm'],
    mutationFn: async (ask: EarnConfirmAsk): Promise<SendResult> => {
      const helper = appContracts().vesuEarn
      if (!helper) {
        return { ok: false, stages: [], failure: { kind: 'bad-input', reason: 'The Earn helper is not deployed in this build.' } }
      }
      const { inToken, outToken } = earnTokens({ direction: ask.direction, market: ask.market })
      return send.mutateAsync({
        kind: ask.direction === 'supply' ? 'earn-supply' : 'earn-redeem',
        // The withdrawal's destination and the invoke's target must be the same contract, and the
        // leg refuses them if they are not. Naming it once here is what makes that true.
        recipient: helper,
        token: inToken,
        symbol: ask.direction === 'supply' ? 'USDC' : `${ask.market.label} shares`,
        amount: ask.amount,
        surface: 'earn',
        label: ask.direction === 'supply' ? `Supply ${ask.market.label}` : `Redeem ${ask.market.label}`,
        earn: {
          direction: ask.direction,
          marketId: ask.market.marketId,
          helper,
          outToken,
          outSymbol: ask.direction === 'supply' ? `${ask.market.label} shares` : 'USDC',
          expectedOutWei: ask.expectedOutWei,
        },
        onStage: setPhase,
      })
    },
  })

  return {
    phase,
    problem: refusal.refusal,
    reset: () => {
      refusal.clear()
      setPhase(null)
    },
    async confirm(ask: EarnConfirmAsk): Promise<SendResult> {
      refusal.clear()
      setPhase('build')
      try {
        const outcome = await mutation.mutateAsync(ask)
        if (!outcome.ok) {
          // A `confirmation-unknown` carries its hash so the row can be looked up; that is the
          // whole reason `RefusalRow` takes one.
          const hash = 'transactionHash' in outcome.failure ? (outcome.failure.transactionHash ?? null) : null
          refusal.refuse(sendProblem(outcome), hash)
        }
        return outcome
      } finally {
        setPhase(null)
      }
    },
  }
}
