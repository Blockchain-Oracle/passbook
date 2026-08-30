import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { MARKET_STATE, type OnChainMarket } from '@strk20/protocol/app-reads'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { MARKETS_LOADING, MARKETS_NONE_OPEN, MARKETS_NOT_DEPLOYED, MARKETS_STANDING_LINE, RAIL_LINE } from '@strk20/protocol/markets-copy'

import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Page } from '@/components/layout/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useNow } from '@/hooks/use-now'
import { houseFloatQuery } from '@/queries/app'
import { BetTicket } from './bet-ticket'
import { CreateMarketDialog } from './create-market-dialog'
import { MarketCard } from './market-card'
import { PositionsStrip } from '@/features/positions'
import { Tape } from './tape'
import { useMarketFeed } from './use-market-feed'
import { useStrkStake } from './use-stake'
import { WindowRail } from './window-rail'

/** The board's slow clock; the rail runs its own one-second clock for countdowns. */
const TICK_MS = 30_000

interface Ticket {
  market: OnChainMarket
  side: number
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2">
      <span className="text-kicker uppercase text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-body3 tabular-nums">{children}</span>
    </div>
  )
}

export function MarketsBoard() {
  const feed = useMarketFeed()
  const stake = useStrkStake()
  const houseFloat = useQuery(houseFloatQuery(STRK_TOKEN))
  const now = useNow(TICK_MS)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [creating, setCreating] = useState(false)

  const windows = feed.open.filter((m) => m.house)
  const custom = feed.open.filter((m) => !m.house)
  const active = feed.series.filter((s) => s.active)
  const vigBps = active[0]?.vigBps ?? null

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

      {!feed.deployed ? (
        <Alert>
          <AlertDescription>{MARKETS_NOT_DEPLOYED}</AlertDescription>
        </Alert>
      ) : (
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-kicker uppercase text-muted-foreground">Standing windows</h2>
              <p className="text-body4 text-muted-foreground">{RAIL_LINE}</p>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
              <Stat label="Series">{feed.loading ? '—' : active.length}</Stat>
              <Stat label="House float">
                <Amount wei={houseFloat.data ?? (houseFloat.isError ? null : undefined)} decimals={stake.decimals} symbol={stake.symbol} size="sm" />
              </Stat>
              <Stat label="Vig">{vigBps === null ? '—' : `${(vigBps / 100).toFixed(vigBps % 100 === 0 ? 0 : 2)}%`}</Stat>
            </div>
          </div>
          {!feed.loading && windows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No standing windows</EmptyTitle>
                <EmptyDescription>{MARKETS_NONE_OPEN}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <WindowRail
              windows={windows}
              loading={feed.loading}
              prices={feed.prices}
              history={feed.history}
              symbol={stake.symbol}
              decimals={stake.decimals}
              onBet={(market, side) => setTicket({ market, side })}
            />
          )}
        </section>
      )}

      {custom.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-kicker uppercase text-muted-foreground">Open markets</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {custom.map((market) => (
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
        </section>
      ) : null}

      {/* Claims live on /positions now; the board points at them rather than hosting a second list. */}
      <PositionsStrip venue="market" />

      <div className="grid gap-6">
        {/* No heading: the tape is self-evidently the activity feed, and "Live" beside "Your
            positions" read as a label for the wrong thing. Abu's call, 2026-08-30. */}
        <section className="flex flex-col gap-3">
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
            {feed.settled
              .filter((m) => m.state !== MARKET_STATE.none)
              .map((market) => (
                <MarketCard key={market.id} market={market} now={now} spot={null} symbol={stake.symbol} decimals={stake.decimals} />
              ))}
          </div>
        </section>
      ) : null}

      {ticket ? (
        <BetTicket
          key={`${ticket.market.id}:${ticket.side}`}
          market={ticket.market}
          spot={feed.prices[ticket.market.pair]?.price ?? null}
          initialSide={ticket.side}
          open
          onOpenChange={(open) => !open && setTicket(null)}
        />
      ) : null}
      <CreateMarketDialog open={creating} onOpenChange={setCreating} prices={feed.prices} />
    </Page>
  )
}
