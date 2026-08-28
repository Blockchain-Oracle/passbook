//
// The crossing review — the last screen before something that cannot be undone.
//
// ── IT SHOWS WHAT LANDS, NOT WHAT LEAVES ──────────────────────────────────────────────────
//
// The headline pair is `amount → delivered`, not `amount → amount`. Circle deducts `max_fee` from
// the burn and `feeExecuted == max_fee` on every observed message, so the arriving number is known
// exactly at signing rather than discovered at the far end. Almost every bridge shows the amount
// you typed and lists fees underneath; the number a person actually wants is the second one, and
// this is one of the rare cases where it can be stated as a fact instead of an estimate.
//
// ── AND IT CARRIES THE ROWS UNISWAP CANNOT ────────────────────────────────────────────────
//
// Under the fee rows sit the disclosure panel, the visibility matrix and the anonymity-set drawing.
// Every sentence in them is authored in the protocol package — `BRIDGE_SCOPE`, `BRIDGE_IRREVERSIBLE`
// and `BRIDGE_DESTINATION_GAS` are verbatim from the research and the requirements — so this file
// makes no privacy claim of its own. That is the rule the whole disclosure system exists to keep:
// there is no fourth place a claim can be typed.
//
import { disclosureFor } from '@strk20/protocol/disclosure'
import type { BridgeDestination } from '@strk20/protocol/bridge'
import type { LinkabilityModel } from '@strk20/protocol/linkability'

import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { PrivacyRow } from './PrivacyRow'
import { ChainLogo, isKnownChain } from './ChainLogo'
import { TokenLogo } from './TokenLogo'
import { Button } from './LegacyButton'
import { Text } from './Text'

export interface BridgeReviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chain: BridgeDestination
  destination: string
  /** Already formatted by the caller, which owns the token's decimals. */
  sendDisplay: string
  /** `amount − max_fee`. `null` only when the fee has not been quoted. */
  deliveredDisplay: string | null
  forwardFeeDisplay: string | null
  protocolFeeDisplay: string | null
  meter: LinkabilityModel
  /** Absent while the action cannot be performed; the CTA says why instead of vanishing. */
  onConfirm?: () => void
  blocker?: string | null
  dismissible?: boolean
}

export function BridgeReview({
  open,
  onOpenChange,
  chain,
  destination,
  sendDisplay,
  deliveredDisplay,
  forwardFeeDisplay,
  protocolFeeDisplay,
  meter,
  onConfirm,
  blocker = null,
  dismissible = true,
}: BridgeReviewProps) {
  //
  // THE PANEL'S SEVERITY DOES NOT ROUTE TO THIS BUTTON, and that is deliberate rather than an
  // omission. `.cta[data-severity]` is the `BlockedButton`'s channel and this is a `Button` — it
  // carries no `.cta` class, so the attribute would be inert markup asserting a colour nothing
  // paints. The severity lives where it can be seen: on the form's CTA, and on the panel's own
  // headline inside this dialog.
  //
  const disclosure = disclosureFor('bridge-exit')

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Review crossing" modal dismissible={dismissible}>
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-s16">
        <div className="flex items-start justify-between gap-s12">
          <Text variant="body2" as="h2" className="text-neutral2">
            You&rsquo;re sending USDC to {chain.name}
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

        <div className="-mx-s4 flex min-h-0 flex-1 flex-col gap-s16 overflow-y-auto px-s4">
          <div className="flex flex-col gap-s12">
            <AmountRow label="Leaves the pool" display={`${sendDisplay} USDC`} chain={null} />
            <ArrowDown />
            {/* THE NUMBER THAT MATTERS. Deliberately the one carrying the chain mark, because the
                pair a person is agreeing to is "this much, there". */}
            <AmountRow
              label={`Arrives on ${chain.name}`}
              display={deliveredDisplay === null ? '—' : `${deliveredDisplay} USDC`}
              chain={chain}
            />
          </div>

          {/* The destination, in full and unabbreviated. A truncated address on the last screen
              before an irreversible burn is a truncation of the one thing left to check. */}
          <div className="flex flex-col gap-s4 rounded-card bg-inset p-s12">
            <Text variant="body4" className="text-neutral2">
              Destination address
            </Text>
            <Text variant="body4" className="numeric break-all text-neutral1">
              {destination}
            </Text>
          </div>

          <div className="h-px w-full bg-surface3" />

          <dl className="flex flex-col gap-s8">
            {/* Two fee rows rather than one total, because they are charged by two different
                parties for two different things and only one of them moves with the amount. */}
            <ReviewRow
              label="Delivery fee"
              value={forwardFeeDisplay === null ? '—' : `${forwardFeeDisplay} USDC`}
              hint="Circle submits the transfer and pays the gas at the far end"
            />
            <ReviewRow
              label="Transfer fee"
              value={protocolFeeDisplay === null ? '—' : `${protocolFeeDisplay} USDC`}
              hint="CCTP's own cut, 0.12% of the amount"
            />
            <ReviewRow label="Speed" value="Fast — seconds, not minutes" />
          </dl>

          {/* The authored panel. No `onWayOut`: the model's way out is "use a fresh address
              instead", and this app cannot create an address on another chain — a stated recovery
              wired to nothing is the overclaim the component's own contract refuses. */}
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
          {blocker ?? `Send to ${chain.name}`}
        </Button>
      </div>
    </ResponsiveDialog>
  )
}

function AmountRow({
  label,
  display,
  chain,
}: {
  label: string
  display: string
  chain: BridgeDestination | null
}) {
  return (
    <div className="flex items-center justify-between gap-s16">
      <div className="flex min-w-0 flex-col gap-s2">
        <Text variant="body4" className="text-neutral2">
          {label}
        </Text>
        <Text variant="heading3" className="numeric truncate text-neutral1">
          {display}
        </Text>
      </div>
      {chain ? (
        isKnownChain(chain.key) ? (
          <ChainLogo chainKey={chain.key} size={40} />
        ) : (
          <TokenLogo url={null} symbol={chain.name} name={chain.name} size={40} />
        )
      ) : (
        <TokenLogo url={null} symbol="USDC" name="USD Coin" size={40} />
      )}
    </div>
  )
}

/** A bare arrow between the amounts — direction, with no chrome around it. */
function ArrowDown() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-neutral3"
    >
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
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <div className="flex min-w-0 flex-col">
        <Text as="dt" variant="body3" className="text-neutral2">
          {label}
        </Text>
        {hint ? (
          <Text variant="body4" className="text-neutral3">
            {hint}
          </Text>
        ) : null}
      </div>
      <Text as="dd" variant="body3" className={cn('numeric shrink-0 text-neutral1')}>
        {value}
      </Text>
    </div>
  )
}
