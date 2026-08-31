import { BRIDGE_USDC_DECIMALS, BRIDGE_USDC_SYMBOL, type BridgeDestination, type ForwardFee } from '@strk20/protocol/bridge'
import { disclosureFor } from '@strk20/protocol/disclosure'
import type { LinkabilityModel } from '@strk20/protocol/linkability'
import type { SelfLinkResult } from '@strk20/protocol/self-link'

import { Amount } from '@/components/money/amount'
import { ReviewSheet, type ReviewRow } from '@/components/money/review-sheet'
import { ChainMark } from './chain-marks'
import { SelfLinkNotice } from './destination-field'
import { DestinationCaveat } from './destination-picker'
import { LinkabilityMeter } from './linkability-meter'

export interface BridgeReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: BridgeDestination
  destination: string
  amountWei: bigint | null
  deliveredWei: bigint | null
  fee: ForwardFee | null
  meter: LinkabilityModel
  crowdPending: boolean
  selfLink: SelfLinkResult
  blocker: string | null
  busy: boolean
  /** The last send's failure, shown in place so the person can retry or back out. */
  problem: string | null
  onConfirm: (sponsored: boolean) => void
}

const DISCLOSURE = disclosureFor('bridge-exit')

/** The last screen before an irreversible burn: the pair "this much, there", in full. */
export function BridgeReview({
  open,
  onOpenChange,
  chain,
  destination,
  amountWei,
  deliveredWei,
  fee,
  meter,
  crowdPending,
  selfLink,
  blocker,
  busy,
  problem,
  onConfirm,
}: BridgeReviewProps) {
  const usdc = (wei: bigint | null) => <Amount wei={wei} decimals={BRIDGE_USDC_DECIMALS} symbol={BRIDGE_USDC_SYMBOL} />
  const rows: ReviewRow[] = [
    { label: 'Leaves the pool', value: usdc(amountWei) },
    {
      label: `Arrives on ${chain.name}`,
      value: (
        <span className="inline-flex items-center gap-2">
          {usdc(deliveredWei)}
          <ChainMark chainKey={chain.key} size={18} />
        </span>
      ),
    },
    // Unabbreviated on purpose: a truncated address here truncates the one thing left to check.
    { label: 'Destination', value: <span className="break-all text-mono">{destination}</span> },
    { label: 'Delivery fee · Circle pays the far-end gas', value: usdc(fee?.forwardFeeWei ?? null) },
    { label: 'Transfer fee · CCTP’s cut', value: usdc(fee?.protocolFeeWei ?? null) },
    { label: 'Speed', value: 'Fast — seconds, not minutes' },
  ]
  // Tier 2 supplies its own label; the CTA keeps the chain's name everywhere else.
  const confirmLabel = meter.state === 'measured' && meter.ctaLabel ? meter.ctaLabel : `Send to ${chain.name}`

  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Send ${BRIDGE_USDC_SYMBOL} to ${chain.name}`}
      description="Shielded USDC leaves the pool for a public address on another chain. Outbound only."
      boundary="publicExit"
      rows={rows}
      disclosure={DISCLOSURE}
      confirmLabel={confirmLabel}
      sponsor={{ kind: 'eligible' }}
      onConfirm={onConfirm}
      busy={busy}
      blocker={blocker}
      problem={problem}
    >
      <DestinationCaveat chain={chain} />
      <SelfLinkNotice selfLink={selfLink} />
      <LinkabilityMeter meter={meter} pending={crowdPending} variant="row" className="rounded-lg border p-3" />
    </ReviewSheet>
  )
}
