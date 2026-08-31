import { disclosureFor } from '@strk20/protocol/disclosure'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'
import type { Quote } from '@strk20/protocol/quote'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import { formatPercent, rateWei, routeLabel, type SwapSide } from './sides'
import { slippageLabel } from './slippage-popover'
import type { SwapPhase } from './use-swap-confirm'
import type { WalkState } from './use-swap-state'

const SWAP_DISCLOSURE = disclosureFor('swap')

export interface SwapReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sell: SwapSide
  buy: SwapSide
  quote: Quote
  minOutWei: bigint
  impact: number | null
  slippageBps: number
  feeWei: bigint | null | undefined
  ready: boolean
  walkState: WalkState
  phase: SwapPhase
  /** The last confirm's failure sentence, shown in the sheet's red row until the sheet reopens. */
  problem: string | null
  onConfirm: (sponsored: boolean) => void
}

// Conditions only. The last confirm's FAILURE used to come back through here, which sent a refusal
// to the muted blocker line and left the button reading "Not available" — the app's quietest
// possible way to say the swap did not happen. It goes to `problem` now, in red, like everywhere.
function reviewBlocker(ready: boolean, walkState: WalkState, phase: SwapPhase): string | null {
  if (!ready) return 'This browser has no account yet'
  if (walkState === 'pending') return 'Reading your balance…'
  if (walkState === 'unreachable') return 'Your balance could not be read'
  if (phase === 'building') return 'Getting the route…'
  if (phase) return STAGE_TITLES[phase]
  return null
}

/** Shielded in, shielded out. The rows are the quote; the panel is what the chain will show. */
export function SwapReview({
  open,
  onOpenChange,
  sell,
  buy,
  quote,
  minOutWei,
  impact,
  slippageBps,
  feeWei,
  ready,
  walkState,
  phase,
  problem,
  onConfirm,
}: SwapReviewProps) {
  const rate = rateWei(quote, sell.decimals)
  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Swap ${sell.symbol} for ${buy.symbol}`}
      description="The sell side leaves the pool to the venue's executor; the bought token comes back to you as a new shielded note in the same transaction."
      boundary="shieldedRound"
      rows={[
        { label: 'You sell', value: <Amount wei={quote.sellAmount} decimals={sell.decimals} symbol={sell.symbol} /> },
        { label: 'You receive, estimated', value: <Amount wei={quote.buyAmount} decimals={buy.decimals} symbol={buy.symbol} /> },
        { label: 'Minimum received', value: <Amount wei={minOutWei} decimals={buy.decimals} symbol={buy.symbol} /> },
        {
          label: 'Rate',
          value: rate !== null ? (
            <>
              1 {sell.symbol} = <Amount wei={rate} decimals={buy.decimals} symbol={buy.symbol} />
            </>
          ) : (
            '—'
          ),
        },
        { label: 'Price impact', value: impact === null ? '—' : formatPercent(impact) },
        { label: 'Slippage', value: slippageLabel(slippageBps) },
        { label: 'Route', value: routeLabel(quote) ?? '—' },
        { label: 'Pool fee', value: <Amount wei={feeWei} decimals={18} symbol="STRK" /> },
        { label: 'Submitted by', value: 'Embedded strk20.run account' },
      ]}
      disclosure={SWAP_DISCLOSURE}
      confirmLabel="Confirm swap"
      sponsor={{ kind: 'eligible' }}
      onConfirm={onConfirm}
      busy={phase !== null}
      blocker={reviewBlocker(ready, walkState, phase)}
      problem={phase === null ? problem : null}
    />
  )
}
