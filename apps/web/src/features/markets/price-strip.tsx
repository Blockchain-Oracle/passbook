import type { WirePrice } from '@strk20/protocol/chain-feed-wire'
import { PRICE_STALE, PRICE_STRIP_SOURCE } from '@strk20/protocol/markets-copy'
import { PRAGMA_PAIR_LIST, formatPrice, isStale, type PragmaPair } from '@strk20/protocol/pragma-pairs'

import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export interface PriceStripProps {
  prices: Readonly<Record<string, WirePrice>>
  selected: PragmaPair
  onSelect: (pair: PragmaPair) => void
  now: number
  className?: string
}

/** The three Pragma medians, one selectable. A pair the feed has not read yet renders an em dash. */
export function PriceStrip({ prices, selected, onSelect, now, className }: PriceStripProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ToggleGroup
        value={[selected]}
        onValueChange={(value) => {
          const next = value[0]
          if (typeof next === 'string' && PRAGMA_PAIR_LIST.includes(next as PragmaPair)) onSelect(next as PragmaPair)
        }}
        variant="outline"
        className="grid w-full grid-cols-3"
      >
        {PRAGMA_PAIR_LIST.map((pair) => {
          const price = prices[pair]
          // The wire carries `pair` as a plain string; inside this loop it is the typed one.
          const stale = price ? isStale({ ...price, pair }, now) : false
          return (
            <ToggleGroupItem key={pair} value={pair} aria-label={pair} className="h-auto flex-col items-start gap-0.5 px-3 py-2">
              <span className="text-kicker uppercase text-muted-foreground">{pair}</span>
              <span className={cn('font-mono text-display4 tabular-nums', stale && 'text-muted-foreground')}>
                {price ? `$${formatPrice(price.price)}` : '—'}
              </span>
              {stale ? (
                <Badge variant="outline" className="text-navLabel uppercase">
                  {PRICE_STALE}
                </Badge>
              ) : price ? (
                <span className="text-body4 text-muted-foreground">{price.sources} sources</span>
              ) : null}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
      <p className="text-body4 text-muted-foreground">{PRICE_STRIP_SOURCE}</p>
    </div>
  )
}
