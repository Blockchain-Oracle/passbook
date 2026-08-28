//
// The review step (Uniswap `SwapReviewScreen` + `TransactionAmountsReview` are the model).
//
// ── THIS IS WHERE THE PICTURE BELONGS ─────────────────────────────────────────────────────
//
// The form shows the crowd as one line, because on a form nothing has been committed to. Here the
// user is one press from an irreversible action, and `C08:229` is explicit that the anonymity set
// drawing itself is what the moment of action should show — "thirty seconds of a spinner is
// nothing; thirty seconds of the anonymity set drawing itself teaches the user what they bought."
//
// ── AND THE TWO ROWS UNISWAP CANNOT SHOW ──────────────────────────────────────────────────
//
// Rate, impact, minimum received and route are Uniswap's rows and they are here. Underneath them
// are the disclosure panel and the visibility matrix — what leaks, to whom — which is the whole
// reason this product exists. A swap review that lists slippage and says nothing about who can see
// the transaction is the industry's blind spot, not a design constraint.
//
import type { Disclosure as DisclosureModel } from '@strk20/protocol/disclosure'
import type { LinkabilityModel } from '@strk20/protocol/linkability'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { PrivacyRow } from './PrivacyRow'
import { TokenLogo } from './TokenLogo'
import { Button } from './LegacyButton'
import { Text } from './Text'

export interface SwapReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sellToken: TokenInfo
  buyToken: TokenInfo
  /** Already formatted by the caller, which owns the token's decimals. */
  sellDisplay: string
  buyDisplay: string
  rate: string
  impactPercent: number | null
  minimumReceived: string | null
  route: string | null
  meter: LinkabilityModel
  /**
   * What this swap leaks and to whom.
   *
   * NEW IN WAVE 4, AND IT WAS A GAP: DESIGN §7.5 requires every review to render a disclosure or
   * explicitly assert none, and this one did neither — it showed the anonymity set and said nothing
   * about the venue seeing the trade. `disclosureFor('swap')` has existed the whole time.
   */
  disclosure: DisclosureModel
  /** Absent while the action cannot be performed; the CTA says why instead of vanishing. */
  onConfirm?: () => void
  /** What stops the confirm, as a sentence. */
  blocker?: string | null
  dismissible?: boolean
}

export function SwapReview({
  open,
  onOpenChange,
  sellToken,
  buyToken,
  sellDisplay,
  buyDisplay,
  rate,
  impactPercent,
  minimumReceived,
  route,
  meter,
  disclosure,
  onConfirm,
  blocker = null,
  dismissible = true,
}: SwapReviewProps) {
  return (
    // MODAL, because this is a decision. The scrim dims the form behind it and catches the click
    // that dismisses — the first thing anyone tries.
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Review swap" modal dismissible={dismissible}>
      {/*
        `w-full`, NOT a fixed width. `.pb-dialog` is already `max-width: 420px` with 24px of padding
        on each side, so a 420px child inside it overflows by 48px — which is exactly what this
        looked like. The dialog owns the width; the content fills what it is given.
      */}
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-s16">
        <div className="flex items-start justify-between gap-s12">
          <Text variant="body2" as="h2" className="text-neutral2">
            You&rsquo;re swapping
          </Text>
          {/* Every dialog needs a visible way out. Escape and the scrim both work, and neither is
              discoverable. */}
          {dismissible ? <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="focus-ring -m-s4 rounded-control p-s4 text-neutral3 hover:bg-inset hover:text-neutral1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button> : null}
        </div>

        {/*
          A TALL MODAL SCROLLS ITS MIDDLE, not its whole self. The header and the button stay put;
          the amounts, the rows and the picture are what move. Without this the confirm button ends
          up below the fold on a phone, which is the one control that must never be hard to reach.
        */}
        <div className="-mx-s4 flex min-h-0 flex-1 flex-col gap-s16 overflow-y-auto px-s4">
          {/* The two amounts at heading size with 40px marks — the only thing on this screen that
              should be readable across a room, because it is the thing being agreed to. */}
          <div className="flex flex-col gap-s12">
            <AmountRow token={sellToken} display={sellDisplay} />
            <ArrowDown />
            <AmountRow token={buyToken} display={buyDisplay} />
          </div>

          <div className="h-px w-full bg-surface3" />

          <dl className="flex flex-col gap-s8">
            <ReviewRow label="Rate" value={rate} />
            {impactPercent !== null ? (
              <ReviewRow
                label="Price impact"
                value={`${impactPercent >= 0 ? '' : '+'}${Math.abs(impactPercent).toFixed(2)}%`}
                tone={impactPercent >= 1 ? 'exposed' : 'plain'}
              />
            ) : null}
            {minimumReceived ? <ReviewRow label="Minimum received" value={minimumReceived} /> : null}
            {route ? <ReviewRow label="Route" value={route} /> : null}
          </dl>

          {/* ONE ROW, not four stacked panels. The headline claim stays visible at rest; the
              matrix, the meter and the dot-scatter are one press away. See `PrivacyRow`. */}
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
          {blocker ?? 'Confirm swap'}
        </Button>
      </div>
    </ResponsiveDialog>
  )
}

function AmountRow({ token, display }: { token: TokenInfo; display: string }) {
  return (
    <div className="flex items-center justify-between gap-s16">
      <div className="flex min-w-0 flex-col">
        <Text variant="heading3" className="numeric truncate text-neutral1">
          {display} {token.symbol}
        </Text>
      </div>
      <TokenLogo url={token.logoUri} symbol={token.symbol} name={token.name} size={40} />
    </div>
  )
}

/** A bare arrow between the amounts — direction, with no chrome around it. */
function ArrowDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-neutral3">
      <path
        d="M12 5V19M12 19L19 12M12 19L5 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ReviewRow({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'exposed'
}) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <Text as="dt" variant="body3" className="text-neutral2">
        {label}
      </Text>
      <Text
        as="dd"
        variant="body3"
        className={cn('numeric', tone === 'exposed' ? 'text-exposed' : 'text-neutral1')}
      >
        {value}
      </Text>
    </div>
  )
}
