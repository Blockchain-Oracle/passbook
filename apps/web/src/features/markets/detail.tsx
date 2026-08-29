import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Flag } from 'lucide-react'
import { MARKET_STATE, marketQuestion, potShare, strikeDisplay, timeLeft } from '@strk20/protocol/app-reads'
import { BET_SIDE_DOWN, BET_SIDE_UP, MARKETS_LOADING, MARKETS_NOT_DEPLOYED } from '@strk20/protocol/markets-copy'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import type { PragmaPair } from '@strk20/protocol/pragma-pairs'

import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Page } from '@/components/layout/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { BetTicket } from './bet-ticket'
import { isClosing, sideAgainst, sideLabel, takesBets } from './market-card'
import { PositionsPanel } from './positions-panel'
import { LazyPriceChart } from './price-chart-lazy'
import { Tape } from './tape'
import { findMarket, useMarketFeed } from './use-market-feed'
import { useStrkStake } from './use-stake'

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-kicker uppercase text-muted-foreground">{label}</dt>
      <dd className="font-mono text-body3 tabular-nums">{children}</dd>
    </div>
  )
}

export function MarketDetail({ id }: { id: number }) {
  const feed = useMarketFeed()
  const stake = useStrkStake()
  // One second: the close is a moment, and the doors must shut on it, not thirty seconds after.
  const now = useNow(1000)
  const [side, setSide] = useState<number | null>(null)
  const market = findMarket(feed.markets, id)

  const back = (
    <Button variant="ghost" size="sm" render={<Link to="/markets" />}>
      <ArrowLeft data-icon="inline-start" />
      All markets
    </Button>
  )

  if (!feed.deployed) {
    return (
      <Page kicker="Markets" title={`Market #${id}`} actions={back}>
        <Alert>
          <AlertDescription>{MARKETS_NOT_DEPLOYED}</AlertDescription>
        </Alert>
      </Page>
    )
  }
  if (!market) {
    return (
      <Page kicker="Markets" title={`Market #${id}`} actions={back}>
        {feed.loading ? (
          <Skeleton className="h-40" />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Not in the registry</EmptyTitle>
              <EmptyDescription>{feed.markets.length === 0 ? MARKETS_LOADING : `No market #${id} has been opened on this contract.`}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Page>
    )
  }

  const share = potShare(market)
  const open = takesBets(market, now)
  const closing = isClosing(market, now)
  const closes = timeLeft(market.deadline, now)
  const pair = market.pair as PragmaPair
  const spot = feed.prices[market.pair]?.price ?? null
  const against = sideAgainst(market, spot)

  return (
    <Page
      kicker="Markets"
      title={marketQuestion(market)}
      actions={
        <>
          <BoundaryBadge kind="bearer" />
          {back}
        </>
      }
    >
      {/* `minmax(0, …)` and `min-w-0`: the chart measures its column, so the column must not grow to the chart. */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <LazyPriceChart pair={pair} series={feed.history[pair] ?? []} reference={market.strike === 0n ? null : Number(market.strike)} height={260} caption="strike" />
          <Card>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Pot">
                  <Amount wei={market.up + market.down} decimals={stake.decimals} symbol={stake.symbol} size="sm" />
                </Stat>
                <Stat label={BET_SIDE_UP}>
                  <Amount wei={market.up} decimals={stake.decimals} symbol={stake.symbol} size="sm" /> · {share.upPct}%
                </Stat>
                <Stat label={BET_SIDE_DOWN}>
                  <Amount wei={market.down} decimals={stake.decimals} symbol={stake.symbol} size="sm" /> · {share.downPct}%
                </Stat>
                <Stat label="Seed">
                  <Amount wei={market.seed} decimals={stake.decimals} symbol={stake.symbol} size="sm" />
                </Stat>
                <Stat label="Strike">{market.strike === 0n ? 'Set at first bet' : `$${strikeDisplay(market.strike)}`}</Stat>
                <Stat label={market.state === MARKET_STATE.active || market.state === MARKET_STATE.none ? 'Closes' : 'Outcome'}>
                  {market.state === MARKET_STATE.resolved ? (
                    `${sideLabel(market.winner)} won`
                  ) : market.state === MARKET_STATE.voided ? (
                    'Voided'
                  ) : closing ? (
                    <span className="text-irreversible">Closed · settling</span>
                  ) : (
                    closes
                  )}
                </Stat>
              </dl>
            </CardContent>
          </Card>
          <section className="flex flex-col gap-3">
            <h2 className="text-kicker uppercase text-muted-foreground">Tape</h2>
            <Tape
              items={feed.tape}
              markets={feed.markets}
              marketId={market.id}
              symbol={stake.symbol}
              decimals={stake.decimals}
              emptyLine="Nothing has happened in this market yet."
              limit={40}
            />
          </section>
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-kicker uppercase text-muted-foreground">Take a side</h2>
            {open ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" className="border-settled text-settled" onClick={() => setSide(SIDE_UP)}>
                  {BET_SIDE_UP} {against}
                </Button>
                <Button variant="outline" size="lg" className="border-irreversible text-irreversible" onClick={() => setSide(SIDE_DOWN)}>
                  {BET_SIDE_DOWN} {against}
                </Button>
              </div>
            ) : (
              // The doors stay visible, struck and dimmed, under a red rule: closed is a state to
              // see, not a sentence to read.
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2 opacity-40" aria-hidden>
                  <Button variant="outline" size="lg" className="border-settled text-settled line-through" tabIndex={-1}>
                    {BET_SIDE_UP} {against}
                  </Button>
                  <Button variant="outline" size="lg" className="border-irreversible text-irreversible line-through" tabIndex={-1}>
                    {BET_SIDE_DOWN} {against}
                  </Button>
                </div>
                <p
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-body4',
                    closing ? 'bg-irreversibleTint text-irreversible' : 'bg-muted/50 text-muted-foreground',
                  )}
                >
                  <Flag className="size-4 shrink-0" aria-hidden />
                  {market.state === MARKET_STATE.resolved
                    ? `Settled — ${sideLabel(market.winner)} won.`
                    : market.state === MARKET_STATE.voided
                      ? 'Voided — every position refunds at cost.'
                      : closing
                        ? `Closed at ${new Date(market.deadline * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · settling on the oracle’s next read`
                        : 'Too late to open this window.'}
                </p>
              </div>
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-kicker uppercase text-muted-foreground">Your record</h2>
            <PositionsPanel markets={feed.markets} marketId={market.id} stake={stake} now={now} />
          </section>
        </aside>
      </div>
      {side !== null ? <BetTicket key={side} market={market} spot={spot} initialSide={side} open onOpenChange={(next) => !next && setSide(null)} /> : null}
    </Page>
  )
}
