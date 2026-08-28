import { useState } from 'react'
import { Plus, Sprout } from 'lucide-react'
import type { OnChainMarket } from '@strk20/protocol/app-reads'
import { MARKETS_LOADING, MARKETS_NONE_OPEN, MARKETS_NOT_DEPLOYED, MARKETS_STANDING_LINE } from '@strk20/protocol/markets-copy'
import type { PragmaPair } from '@strk20/protocol/pragma-pairs'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Page } from '@/components/layout/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { BetTicket } from './bet-ticket'
import { CreateMarketDialog } from './create-market-dialog'
import { MarketCard } from './market-card'
import { PositionsPanel } from './positions-panel'
import { LazyPriceChart } from './price-chart-lazy'
import { PriceStrip } from './price-strip'
import { Tape } from './tape'
import { useMarketFeed } from './use-market-feed'
import { useStrkStake } from './use-stake'

/** A clock the cards share, so "3h 12m" moves without every card owning a timer. */
export const TICK_MS = 30_000

interface Ticket {
  market: OnChainMarket
  side: number
}

export function MarketsBoard({ pair, onPair }: { pair: PragmaPair; onPair: (pair: PragmaPair) => void }) {
  const feed = useMarketFeed()
  const stake = useStrkStake()
  const now = useNow(TICK_MS)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <Page
      kicker="Venues"
      title="Markets"
      description={MARKETS_STANDING_LINE}
      actions={
        <>
          <BoundaryBadge kind="bearer" />
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            Open a market
          </Button>
        </>
      }
    >
      {feed.problem ? (
        <Alert>
          <AlertDescription>{feed.problem}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <PriceStrip prices={feed.prices} selected={pair} onSelect={onPair} now={now} />
        <LazyPriceChart pair={pair} series={feed.history[pair] ?? []} reference={null} height={220} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-kicker uppercase text-muted-foreground">Open markets</h2>
        {!feed.deployed ? (
          <Alert>
            <AlertDescription>{MARKETS_NOT_DEPLOYED}</AlertDescription>
          </Alert>
        ) : feed.loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-52" />
            <Skeleton className="h-52" />
          </div>
        ) : feed.open.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sprout />
              </EmptyMedia>
              <EmptyTitle>Between windows</EmptyTitle>
              <EmptyDescription>{MARKETS_NONE_OPEN}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={() => setCreating(true)}>
              Open your own
            </Button>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {feed.open.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                now={now}
                spot={feed.prices[market.pair]?.price ?? null}
                symbol={stake.symbol}
                decimals={stake.decimals}
                onBet={(side) => setTicket({ market, side })}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-kicker uppercase text-muted-foreground">Your positions</h2>
          <PositionsPanel markets={feed.markets} stake={stake} now={now} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-kicker uppercase text-muted-foreground">Tape</h2>
          <Tape
            items={feed.tape}
            markets={feed.markets}
            symbol={stake.symbol}
            decimals={stake.decimals}
            emptyLine={feed.state === 'live' ? 'Nothing has happened on the markets yet.' : MARKETS_LOADING}
          />
        </section>
      </div>

      {feed.settled.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-kicker uppercase text-muted-foreground">Settled</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {feed.settled.map((market) => (
              <MarketCard key={market.id} market={market} now={now} spot={null} symbol={stake.symbol} decimals={stake.decimals} />
            ))}
          </div>
        </section>
      ) : null}

      {ticket ? (
        <BetTicket key={`${ticket.market.id}:${ticket.side}`} market={ticket.market} initialSide={ticket.side} open onOpenChange={(open) => !open && setTicket(null)} />
      ) : null}
      <CreateMarketDialog open={creating} onOpenChange={setCreating} prices={feed.prices} />
    </Page>
  )
}
