import { disclosureFor } from '@strk20/protocol/disclosure'
import { EARN_ROUND_TRIP, EARN_SELF_SUBMITTED } from '@strk20/protocol/earn-copy'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'
import type { BreakEven } from '@strk20/protocol/earn-rate'
import type { EarnMarketSnapshot } from '@strk20/protocol/earn-reads'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import type { Refusal } from '@/components/money/refusal'
import { ratePercent } from './market-card'
import type { EarnPhase } from './use-earn-confirm'
import type { EarnTab } from './use-earn-state'

const EARN_DISCLOSURE = disclosureFor('earn')
const USDC_DECIMALS = 6

export interface EarnReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: EarnTab
  snapshot: EarnMarketSnapshot
  amountWei: bigint
  /** The market's own preview of what comes back. `undefined` while it is being read. */
  quoteWei: bigint | undefined
  feeWei: bigint | null
  breakEven: BreakEven
  phase: EarnPhase
  problem: Refusal | null
  onConfirm: () => void
}

function breakEvenRow(state: BreakEven): string {
  if (state.state === 'unknown') return '—'
  if (state.days < 1) return 'under a day'
  if (state.days < 400) return `${Math.ceil(state.days)} days`
  return `${(state.days / 365).toFixed(1)} years`
}

/**
 * The last screen before a proof.
 *
 * ── NO SPONSOR ROW, AND THAT IS NOT AN OVERSIGHT ──────────────────────────────────────────
 *
 * Earn is structurally sponsorable — it is a swap-shaped send out of the user's own notes — and it
 * is self-submitted by product choice instead. So it must NOT reuse the shield dialog's
 * `{ kind: 'unsupported' }` copy, which says sponsored transactions "don't work here": for Earn
 * that sentence is simply false. Passing no offer renders nothing, and the two rows below say the
 * true thing instead — your own account submits this, and it pays from public STRK.
 */
export function EarnReview({
  open,
  onOpenChange,
  tab,
  snapshot,
  amountWei,
  quoteWei,
  feeWei,
  breakEven: evenAt,
  phase,
  problem,
  onConfirm,
}: EarnReviewProps) {
  const { market } = snapshot
  const supplying = tab === 'supply'
  const inDecimals = supplying ? USDC_DECIMALS : market.shareDecimals
  const outDecimals = supplying ? market.shareDecimals : USDC_DECIMALS

  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={supplying ? `Supply ${market.label}` : `Redeem ${market.label}`}
      description={
        supplying
          ? 'Shielded USDC leaves the pool to our helper, which supplies the market; the shares come back as a private note in the same transaction.'
          : 'The shares leave the pool to our helper, which redeems them; the USDC comes back as a private note in the same transaction.'
      }
      boundary="shieldedRound"
      rows={[
        {
          label: 'You send',
          value: <Amount wei={amountWei} decimals={inDecimals} symbol={supplying ? 'USDC' : 'shares'} />,
        },
        { label: 'Market', value: market.label },
        { label: 'Route', value: 'Pool → our helper → Vesu' },
        {
          label: 'You receive, estimated',
          value:
            quoteWei === undefined ? (
              '—'
            ) : (
              <Amount wei={quoteWei} decimals={outDecimals} symbol={supplying ? 'shares' : 'USDC'} />
            ),
        },
        { label: 'Supply rate', value: ratePercent(snapshot.apy) },
        { label: 'Liquidity now', value: <Amount wei={snapshot.reserveWei} decimals={USDC_DECIMALS} symbol="USDC" short /> },
        { label: 'Pool fee', value: <Amount wei={feeWei} decimals={18} symbol="STRK" /> },
        // Shown on both directions: on a supply it is the cost still to come, and on a redeem it
        // is the one being paid now. Either way the round trip is the honest unit.
        { label: 'Round trip', value: EARN_ROUND_TRIP },
        ...(supplying ? [{ label: 'Break-even', value: breakEvenRow(evenAt) }] : []),
        { label: 'Submitted by', value: 'Your own account' },
      ]}
      disclosure={EARN_DISCLOSURE}
      confirmLabel={supplying ? 'Confirm supply' : 'Confirm redeem'}
      onConfirm={onConfirm}
      busy={phase !== null}
      blocker={phase !== null && phase !== 'idle' ? STAGE_TITLES[phase] : null}
      problem={phase === null ? problem : null}
    >
      <p className="text-body4 text-muted-foreground">{EARN_SELF_SUBMITTED}</p>
    </ReviewSheet>
  )
}
