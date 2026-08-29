import { useState } from 'react'
import type { OnChainMarket } from '@strk20/protocol/app-reads'
import type { PricePoint, WirePrice } from '@strk20/protocol/chain-feed-wire'

import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNow } from '@/hooks/use-now'
import { WindowTicket } from './window-ticket'

/** The three standing window lengths, as the tabs name them. */
const WINDOWS = [
  { key: '900', label: '15 min' },
  { key: '3600', label: '1 hour' },
  { key: '86400', label: '24 hours' },
] as const

export interface WindowRailProps {
  /** Series windows only — every row here has `window > 0`. */
  windows: readonly OnChainMarket[]
  loading: boolean
  prices: Readonly<Record<string, WirePrice>>
  history: Readonly<Record<string, readonly PricePoint[]>>
  symbol: string
  decimals: number | null
  onBet: (market: OnChainMarket, side: number) => void
}

/** The standing windows, one tab per length, as a rail of tickets that scrolls sideways. */
export function WindowRail({ windows, loading, prices, history, symbol, decimals, onBet }: WindowRailProps) {
  const [tab, setTab] = useState<string>(WINDOWS[1].key)
  const now = useNow(1000)
  const rows = windows.filter((m) => String(m.window) === tab).sort((a, b) => a.deadline - b.deadline || a.pair.localeCompare(b.pair))

  return (
    <Tabs value={tab} onValueChange={(next) => setTab(String(next))} className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          {WINDOWS.map((w) => (
            <TabsTrigger key={w.key} value={w.key}>
              {w.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <Carousel opts={{ align: 'start', dragFree: true }} className="w-full">
        <CarouselContent className="-ml-3">
          {loading
            ? [0, 1, 2].map((i) => (
                <CarouselItem key={i} className="basis-[300px] pl-3">
                  <Skeleton className="h-72 w-full" />
                </CarouselItem>
              ))
            : rows.map((market) => (
                <CarouselItem key={market.id} className="basis-[300px] pl-3">
                  <WindowTicket
                    market={market}
                    now={now}
                    spot={prices[market.pair]?.price ?? null}
                    history={history[market.pair] ?? []}
                    symbol={symbol}
                    decimals={decimals}
                    onBet={(side) => onBet(market, side)}
                  />
                </CarouselItem>
              ))}
        </CarouselContent>
        {rows.length > 3 ? (
          <>
            <CarouselPrevious className="-left-3 hidden md:inline-flex" />
            <CarouselNext className="-right-3 hidden md:inline-flex" />
          </>
        ) : null}
      </Carousel>
    </Tabs>
  )
}
