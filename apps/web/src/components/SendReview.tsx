//
// The review step for a private transfer (Uniswap `TransactionAmountsReview` is the model).
//
// ── WHAT IS ON IT THAT UNISWAP'S IS NOT ───────────────────────────────────────────────────
//
// The amount and the destination are the industry's rows and they are here. Under them are the
// disclosure panel, the visibility matrix and the crowd — what leaves, to whom, and how many other
// people this amount could have belonged to. A send review that shows a figure and an address and
// says nothing about who can see the transaction is the blind spot this product exists to fill.
//
// ── THE ADDRESS IS SHOWN IN FULL, AND THE AMOUNT IS FROZEN ────────────────────────────────
//
// A truncated address on the last screen before an irreversible send is a truncation of the one
// thing left to check. And every figure here is passed in already formatted by the caller, which
// owns the token's decimals — this component never does arithmetic on money.
//
// ── THE PANEL'S WAY OUT IS DELIBERATELY NOT WIRED ─────────────────────────────────────────
//
// `self-submit`'s authored recovery is "Submit through the relayer instead", and this app has one
// submission path: the account signs for itself. `Disclosure` renders that button only when a
// caller supplies the action behind it, so passing nothing is what keeps a stated recovery from
// becoming a control that does nothing.
//
import { useMemo } from 'react'

import { disclosureFor } from '@strk20/protocol/disclosure'
import type { LinkabilityModel } from '@strk20/protocol/linkability'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { PrivacyRow } from './PrivacyRow'
import { TokenLogo } from './TokenLogo'
import { Button } from './LegacyButton'
import { Text } from './Text'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'

export interface SendReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: TokenInfo
  /** Already formatted by the caller, which owns the token's decimals. */
  amountDisplay: string
  recipient: string
  /** Human context from a payment request. It is not included in the chain transaction. */
  requestNote?: string
  meter: LinkabilityModel
  /** Absent while the action cannot be performed; the CTA says why instead of vanishing. */
  onConfirm?: () => void
  /** What stops the confirm, as a sentence. */
  blocker?: string | null
  dismissible?: boolean
}

export function SendReview({
  open,
  onOpenChange,
  token,
  amountDisplay,
  recipient,
  requestNote,
  meter,
  onConfirm,
  blocker = null,
  dismissible = true,
}: SendReviewProps) {
  //
  // `self-submit`, NOT `pool-send`, and the difference is the whole reason the context exists.
  //
  // `pool-send` is the relayed path, where the relayer's address is the visible submitter. This
  // browser signs and broadcasts for itself, so the user's own address IS on the transaction as the
  // sender — which is the louder of the two panels and the true one here.
  //
  const disclosure = useMemo(() => disclosureFor('self-submit'), [])

  return (
    // MODAL, because this is a decision. The scrim dims the form behind it and catches the click
    // that dismisses — the first thing anyone tries.
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Review send" modal dismissible={dismissible}>
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-s16">
        <div className="flex items-start justify-between gap-s12">
          <Text variant="body2" as="h2" className="text-neutral2">
            You&rsquo;re sending
          </Text>
          {dismissible ? <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="focus-ring -m-s4 rounded-control p-s4 text-neutral3 hover:bg-inset hover:text-neutral1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button> : null}
        </div>

        {/* A tall modal scrolls its MIDDLE. The header and the button stay put, so the one control
            that must never be hard to reach cannot end up below the fold on a phone. */}
        <div className="-mx-s4 flex min-h-0 flex-1 flex-col gap-s16 overflow-y-auto px-s4">
          <div className="flex items-center justify-between gap-s16">
            <Text variant="heading3" className="numeric truncate text-neutral1">
              {amountDisplay} {token.symbol}
            </Text>
            <TokenLogo url={token.logoUri} symbol={token.symbol} name={token.name} size={40} />
          </div>

          <div className="flex flex-col gap-s4 rounded-card bg-inset p-s12">
            <Text variant="body4" className="text-neutral2">
              Recipient
            </Text>
            <Text variant="body4" className="numeric break-all text-neutral1">
              {recipient}
            </Text>
          </div>

          {requestNote ? (
            <div className="flex flex-col gap-s4 rounded-card border border-solid border-surface3 p-s12">
              <Text variant="body4" className="text-neutral2">
                Request note · not written on chain
              </Text>
              <Text variant="body3" className="break-words text-neutral1">
                {requestNote}
              </Text>
            </div>
          ) : null}

          <div className="h-px w-full bg-surface3" />

          <PrivacyRow disclosure={disclosure} meter={meter} />
        </div>

        <Button
          variant={blocker ? 'secondary' : 'primary'}
          size="lg"
          fill
          onClick={() => onConfirm?.()}
          // NOT `disabled`. The app's rule everywhere: a primary action stays pressable and states
          // its reason, because a greyed button explains nothing and a pressed one can.
          aria-disabled={blocker !== null || !onConfirm}
        >
          {blocker ?? `Send ${token.symbol}`}
        </Button>
      </div>
    </ResponsiveDialog>
  )
}
