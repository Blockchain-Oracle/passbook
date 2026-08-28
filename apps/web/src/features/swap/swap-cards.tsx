import { ArrowDownUp } from 'lucide-react'
import type { Quote } from '@strk20/protocol/quote'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { MoneyField, type ShieldDoor } from '@/components/money/money-field'
import { TokenPicker, type PickableToken } from '@/components/money/token-picker'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { SwapSide } from './sides'

export interface SellCardProps {
  sell: SwapSide
  options: readonly PickableToken[]
  loading: boolean
  onChoose: (address: string) => void
  raw: string
  onRaw: (next: string) => void
  onMax?: () => void
  heldWei: bigint | null
  problem: string | null
  shieldDoor: ShieldDoor | null
}

/** What leaves: a shielded balance, said twice — the chip on the header and the field's own line. */
export function SellCard({ sell, options, loading, onChoose, raw, onRaw, onMax, heldWei, problem, shieldDoor }: SellCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-kicker uppercase text-muted-foreground">You sell</CardTitle>
        <CardAction>
          <AssetIdentity symbol={sell.symbol} name={sell.name} logoUri={sell.logoUri} boundary="shielded" size="sm" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TokenPicker tokens={options} value={sell.address} onChange={onChoose} loading={loading} className="w-full" />
        <MoneyField
          value={raw}
          onChange={onRaw}
          symbol={sell.symbol}
          decimals={sell.decimals}
          available={heldWei}
          boundary="shielded"
          onMax={onMax}
          problem={problem}
          shieldDoor={shieldDoor}
          label="Amount"
          autoFocus
        />
      </CardContent>
    </Card>
  )
}

export interface BuyCardProps {
  buy: SwapSide | null
  options: readonly PickableToken[]
  loading: boolean
  onChoose: (address: string) => void
  quote: Quote | null
  /** True while a fresh price is on its way and the shown one is the previous. */
  refreshing: boolean
  /** True while there is a live ask and no answer yet. */
  pending: boolean
  status: string | null
}

/** What comes back, as a new shielded note. The number is the venue's estimate, never a promise. */
export function BuyCard({ buy, options, loading, onChoose, quote, refreshing, pending, status }: BuyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-kicker uppercase text-muted-foreground">You buy</CardTitle>
        {buy ? (
          <CardAction>
            <AssetIdentity symbol={buy.symbol} name={buy.name} logoUri={buy.logoUri} boundary="shielded" size="sm" />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TokenPicker tokens={options} value={buy?.address ?? null} onChange={onChoose} loading={loading} placeholder="Select a token" className="w-full" />
        <div className="flex min-h-12 flex-col justify-center rounded-lg bg-inset px-3 py-2">
          {pending && !quote ? (
            <Skeleton className="h-6 w-40" />
          ) : (
            <span className={refreshing ? 'opacity-60 transition-opacity' : undefined}>
              <Amount wei={quote?.buyAmount} decimals={buy?.decimals ?? null} symbol={buy?.symbol} size="lg" />
            </span>
          )}
          {quote?.buyAmountUsd !== null && quote?.buyAmountUsd !== undefined ? (
            <span className="text-body4 text-muted-foreground">≈ ${quote.buyAmountUsd.toFixed(2)} · estimated</span>
          ) : null}
        </div>
        {status ? (
          <p className="text-body4 text-muted-foreground" aria-live="polite">
            {status}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The direction button between the two cards. Blocked, it says why, and is never `disabled`. */
export function FlipButton({ onFlip, canFlip }: { onFlip: () => void; canFlip: boolean }) {
  return (
    <div className="-my-5 flex justify-center">
      <Button
        variant="outline"
        size="icon-lg"
        className="relative z-10 rounded-pill bg-raised shadow-short"
        aria-label={canFlip ? 'Swap direction' : 'Select a token to buy before flipping'}
        aria-disabled={!canFlip || undefined}
        onClick={() => {
          if (canFlip) onFlip()
        }}
      >
        <ArrowDownUp />
      </Button>
    </div>
  )
}
