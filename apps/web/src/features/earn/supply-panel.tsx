import { EARN_MARKET_PAUSED, EARN_MARKET_UNREADABLE, EARN_MARKET_UNVALIDATED } from '@strk20/protocol/earn-copy'
import { AlertTriangle } from 'lucide-react'

import { toPlainText } from '@strk20/protocol/amount-format'

import { Amount } from '@/components/money/amount'
import { MoneyField, type ShieldDoor } from '@/components/money/money-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ratePercent } from './market-card'
import { quickAmounts, type EarnState } from './use-earn-state'

const USDC_DECIMALS = 6

/**
 * The standing reason this market cannot take new money, rendered ABOVE the form.
 *
 * Placement is the whole point. A control you are not allowed to use should not look usable, and a
 * reason that only appears after the click has let the user do the work first. The pause message
 * also carries both halves — new money refused, existing money untouched — because a lender
 * reading "paused" without the second half reasonably assumes their deposit is stuck.
 */
function StandingBanner({ s }: { s: EarnState }) {
  const snapshot = s.selected
  if (!snapshot) return null
  const line =
    !snapshot.validated
      ? EARN_MARKET_UNVALIDATED
      : s.helperProblem
        ? s.helperProblem
        : snapshot.paused
          ? EARN_MARKET_PAUSED
          : snapshot.blocker?.kind === 'unreadable'
            ? EARN_MARKET_UNREADABLE
            : null
  if (!line) return null
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-body4',
        snapshot.validated ? 'border-exposed/40 bg-exposedTint text-exposed' : 'border-irreversible/40 bg-irreversibleTint text-irreversible',
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>{line}</p>
    </div>
  )
}

export interface SupplyFormProps {
  s: EarnState
  onReview: () => void
  /** The route from public USDC into the shielded side. `null` when there is nothing to offer. */
  shieldDoor?: ShieldDoor | null
  onShield?: () => void
}

/**
 * The form itself, with no chrome of its own.
 *
 * It renders in two places — a dialog opened from a market card, and the market's own page — and
 * it is one component because the alternative is two that drift. The board used to put it in a
 * second column instead, which on anything narrower than a wide desktop collapsed BELOW seven
 * market cards: you picked a market at the top and then scrolled past everything to find the
 * amount field. That is the bug this split exists to remove.
 */
export function SupplyForm({ s, onReview, shieldDoor, onShield }: SupplyFormProps) {
  const snapshot = s.selected
  if (!snapshot) return null
  const { market } = snapshot
  const chips = quickAmounts(s.available, s.decimals)
  const canRedeem = (s.position?.sharesWei ?? 0n) > 0n

  return (
    <div className="flex flex-col gap-4">
      {/* Redeem only exists once there is something to redeem — an empty tab is a dead door. */}
      {canRedeem ? (
        <Tabs value={s.tab} onValueChange={(next) => s.setTab(next as 'supply' | 'redeem')}>
          <TabsList variant="line">
            <TabsTrigger value="supply">Supply</TabsTrigger>
            <TabsTrigger value="redeem">Redeem</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      <StandingBanner s={s} />

        <MoneyField
          value={s.raw}
          onChange={s.setRaw}
          symbol={s.symbol}
          decimals={s.decimals}
          available={s.available}
          boundary="shielded"
          label={s.tab === 'supply' ? 'Amount to supply' : 'Shares to redeem'}
          problem={s.parsed.problem ?? (s.short ? (s.tab === 'supply' ? 'More than your shielded USDC' : 'More than you hold') : null)}
          // Max belongs IN the field, where every other surface in this app puts it. Leaving it to
          // the chips below meant a balance that does not divide cleanly could never be spent whole.
          onMax={s.available !== null && s.available > 0n ? () => s.setRaw(toPlainText(s.available!, s.decimals)) : undefined}
          shieldDoor={shieldDoor ?? null}
        />

        {/* The standing route from public USDC, shown BEFORE anything is typed.
            The in-field door only appears once an amount exceeds the shielded balance, which is no
            use to the ordinary new account: it holds USDC publicly, holds nothing shielded, and
            every control here is dead until it does. This row is the answer to "I have USDC". */}
        {s.tab === 'supply' && s.publicUsdcWei !== null && s.publicUsdcWei > 0n ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-public bg-publicTint px-3 py-2 text-body4">
            <span>
              <Amount wei={s.publicUsdcWei} decimals={USDC_DECIMALS} symbol="USDC" /> sitting public
            </span>
            {onShield ? (
              <Button size="sm" variant="outline" onClick={onShield}>
                Shield it
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* Scaled to the real balance: fixed 50/100/250 chips are dead buttons for someone
            holding 4.90, and this is the field where that person most needs a working one. */}
        {chips.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {chips.map((chip) => (
              <Button
                key={chip.label}
                variant={s.raw === chip.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => s.setRaw(chip.value)}
              >
                {chip.label}
              </Button>
            ))}
          </div>
        ) : null}

        <dl className="flex flex-col gap-2 border-t pt-3 text-body4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">You receive, estimated</dt>
            <dd className="font-mono tabular-nums">
              {s.quoteWei === undefined ? (
                s.quoteLoading ? 'reading…' : '—'
              ) : (
                <Amount
                  wei={s.quoteWei}
                  decimals={s.tab === 'supply' ? market.shareDecimals : USDC_DECIMALS}
                  symbol={s.tab === 'supply' ? 'shares' : 'USDC'}
                />
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Supply rate</dt>
            <dd className="font-mono tabular-nums">{ratePercent(snapshot.apy)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Pool fee, each way</dt>
            <dd className="font-mono tabular-nums">
              <Amount wei={s.feeWei} decimals={18} symbol="STRK" />
            </dd>
          </div>
          {s.tab === 'supply' ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Break-even</dt>
              <dd className="font-mono tabular-nums">
                {s.breakEven.state === 'known' ? `${Math.max(1, Math.ceil(s.breakEven.days))} days` : '—'}
              </dd>
            </div>
          ) : null}
          {s.position ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Redeemable now</dt>
              <dd className="font-mono tabular-nums">
                <Amount wei={s.position.redeemable?.wei ?? null} decimals={USDC_DECIMALS} symbol="USDC" />
              </dd>
            </div>
          ) : null}
        </dl>

        <Button
          size="lg"
          className="w-full"
          aria-disabled={s.blocker !== null || undefined}
          onClick={() => {
            if (s.blocker === null) onReview()
          }}
        >
        {s.blocker ?? (s.tab === 'supply' ? 'Review supply' : 'Review redeem')}
      </Button>
    </div>
  )
}

/** The form in a card, for the market's own page. */
export function SupplyPanel({ s, onReview, shieldDoor, onShield }: SupplyFormProps) {
  if (!s.selected) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-display4 uppercase">
          {s.tab === 'supply' ? 'Supply this market' : 'Redeem from this market'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SupplyForm s={s} onReview={onReview} shieldDoor={shieldDoor} onShield={onShield} />
      </CardContent>
    </Card>
  )
}
