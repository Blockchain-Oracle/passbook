import { Link } from '@tanstack/react-router'
import { Clock } from 'lucide-react'
import { MARKET_STATE, marketQuestion, potShare, timeLeft, type OnChainMarket } from '@strk20/protocol/app-reads'
import { BET_SIDE_DOWN, BET_SIDE_UP } from '@strk20/protocol/markets-copy'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import { formatPrice } from '@strk20/protocol/pragma-pairs'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface MarketCardProps {
  market: OnChainMarket
  now: number
  /** The live Pragma median for the market's pair, 8-dp fixed point. Absent = not read. */
  spot: number | null
  symbol: string
  decimals: number | null
  onBet?: (side: number) => void
  className?: string
}

export function sideLabel(side: number): string {
  return side === SIDE_UP ? BET_SIDE_UP : BET_SIDE_DOWN
}

function stateBadge(market: OnChainMarket, now: number) {
  if (market.state === MARKET_STATE.resolved) return { label: `${sideLabel(market.winner)} won`, tone: 'text-settled border-settled' }
  if (market.state === MARKET_STATE.voided) return { label: 'Voided', tone: 'text-muted-foreground' }
  const left = timeLeft(market.deadline, now)
  return { label: left === 'closed' ? 'Awaiting settlement' : left, tone: '' }
}

/** One market: the question, the pot split, where the price sits now, and the two doors. */
export function MarketCard({ market, now, spot, symbol, decimals, onBet, className }: MarketCardProps) {
  const share = potShare(market)
  const badge = stateBadge(market, now)
  const open = market.state === MARKET_STATE.active && market.deadline * 1000 > now
  const above = spot !== null ? spot >= Number(market.strike) : null

  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-display text-display4 uppercase">
            <Link to="/markets/$id" params={{ id: String(market.id) }} className="hover:underline">
              {marketQuestion(market)}
            </Link>
          </CardTitle>
          <Badge variant="outline" className={cn('shrink-0 gap-1 uppercase text-navLabel', badge.tone)}>
            {open ? <Clock className="size-3" aria-hidden /> : null}
            {badge.label}
          </Badge>
        </div>
        {market.experimental ? <p className="text-body4 text-muted-foreground">Experimental window</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between text-body4">
          <span className="text-settled">
            {BET_SIDE_UP} {share.upPct}%
          </span>
          <span className="text-irreversible">
            {BET_SIDE_DOWN} {share.downPct}%
          </span>
        </div>
        <Progress value={share.upPct} aria-label={`${BET_SIDE_UP} share of the pot`} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body4">
          <dt className="text-muted-foreground">Pot</dt>
          <dd className="text-right">
            <Amount wei={market.up + market.down} decimals={decimals} symbol={symbol} size="sm" />
          </dd>
          <dt className="text-muted-foreground">Now</dt>
          <dd className={cn('text-right font-mono tabular-nums', above === true && 'text-settled', above === false && 'text-irreversible')}>
            {spot !== null ? `$${formatPrice(spot / 1e8)}` : '—'}
          </dd>
        </dl>
      </CardContent>
      {onBet && open ? (
        <CardFooter className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="border-settled text-settled" onClick={() => onBet(SIDE_UP)}>
            {BET_SIDE_UP}
          </Button>
          <Button variant="outline" className="border-irreversible text-irreversible" onClick={() => onBet(SIDE_DOWN)}>
            {BET_SIDE_DOWN}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
