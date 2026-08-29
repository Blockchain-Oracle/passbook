import { Link } from '@tanstack/react-router'
import { Clock, Flag } from 'lucide-react'
import { MARKET_STATE, marketQuestion, openableUntil, potShare, timeLeft, windowLabel, type OnChainMarket } from '@strk20/protocol/app-reads'
import { BET_SIDE_DOWN, BET_SIDE_UP, WINDOW_OPENS_ON_FIRST_BET } from '@strk20/protocol/markets-copy'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import { compactPrice, formatPrice } from '@strk20/protocol/pragma-pairs'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export interface MarketCardProps {
  market: OnChainMarket
  now: number
  /** The live Pragma median for the market's pair, as a decimal. Absent = not read. */
  spot: number | null
  symbol: string
  decimals: number | null
  onBet?: (side: number) => void
  className?: string
}

export function sideLabel(side: number): string {
  return side === SIDE_UP ? BET_SIDE_UP : BET_SIDE_DOWN
}

/** The market's line as a decimal, or `null` before its first bet sets it. */
export function lineOf(market: OnChainMarket): number | null {
  return market.strike === 0n ? null : Number(market.strike) / 1e8
}

/** What a side is taken against, for a button: the line, or the live price a first bet will lock. */
export function sideAgainst(market: OnChainMarket, spot: number | null): string {
  const line = lineOf(market)
  if (line !== null) return compactPrice(line)
  return spot !== null ? `~${compactPrice(spot)}` : '…'
}

/** Whether a bet placed now would be taken: an open market until its deadline, an unopened window until its last quarter. */
export function takesBets(market: OnChainMarket, now: number): boolean {
  if (market.state === MARKET_STATE.active) return market.deadline * 1000 > now
  if (market.state === MARKET_STATE.none && market.house) return openableUntil(market) * 1000 > now
  return false
}

/** Past the deadline and not yet settled: the red state. */
export function isClosing(market: OnChainMarket, now: number): boolean {
  return market.state === MARKET_STATE.active && market.deadline * 1000 <= now
}

function stateBadge(market: OnChainMarket, now: number) {
  if (market.state === MARKET_STATE.resolved) return { label: `${sideLabel(market.winner)} won`, tone: 'text-settled border-settled', icon: Flag }
  if (market.state === MARKET_STATE.voided) return { label: 'Voided', tone: 'text-muted-foreground', icon: Flag }
  if (isClosing(market, now)) return { label: 'Closed · settling', tone: 'text-irreversible border-irreversible', icon: Flag }
  const left = timeLeft(market.deadline, now)
  if (market.state === MARKET_STATE.none) {
    return takesBets(market, now) ? { label: `Opens on first bet · ${left}`, tone: '', icon: Clock } : { label: 'Next window soon', tone: 'text-muted-foreground', icon: Clock }
  }
  return { label: left, tone: '', icon: Clock }
}

/** One market: the question, the pot split, where the price sits now, and the two doors. */
export function MarketCard({ market, now, spot, symbol, decimals, onBet, className }: MarketCardProps) {
  const share = potShare(market)
  const badge = stateBadge(market, now)
  const open = takesBets(market, now)
  const closing = isClosing(market, now)
  const unopened = market.state === MARKET_STATE.none
  const line = lineOf(market)
  const above = spot !== null && line !== null ? spot >= line : null
  const against = sideAgainst(market, spot)

  return (
    <Card className={cn('gap-4', closing && 'border-irreversible/60', className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-display text-display4 uppercase">
            <Link to="/markets/$id" params={{ id: String(market.id) }} className="hover:underline">
              {marketQuestion(market)}
            </Link>
          </CardTitle>
          <Badge variant="outline" className={cn('shrink-0 gap-1 uppercase text-navLabel', badge.tone)}>
            <badge.icon className="size-3" aria-hidden />
            {badge.label}
          </Badge>
        </div>
        {market.window > 0 || market.experimental ? (
          <p className="text-body4 text-muted-foreground">
            {market.window > 0 ? `${windowLabel(market.window)} window` : null}
            {market.window > 0 && market.experimental ? ' · ' : null}
            {market.experimental ? 'Experimental' : null}
          </p>
        ) : null}
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
          <dt className="text-muted-foreground">{unopened ? 'House seed' : 'Pot'}</dt>
          <dd className="text-right">
            <Amount wei={unopened ? market.seed : market.up + market.down} decimals={decimals} symbol={symbol} size="sm" />
          </dd>
          <dt className="text-muted-foreground">Now</dt>
          <dd className={cn('text-right font-mono tabular-nums', above === true && 'text-settled', above === false && 'text-irreversible')}>
            {spot !== null ? `$${formatPrice(spot)}` : '—'}
          </dd>
        </dl>
        {unopened ? <p className="text-body4 text-muted-foreground">{WINDOW_OPENS_ON_FIRST_BET}</p> : null}
      </CardContent>
      {onBet && open ? (
        <CardFooter className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="border-settled text-settled" onClick={() => onBet(SIDE_UP)}>
            {BET_SIDE_UP} {against}
          </Button>
          <Button variant="outline" className="border-irreversible text-irreversible" onClick={() => onBet(SIDE_DOWN)}>
            {BET_SIDE_DOWN} {against}
          </Button>
        </CardFooter>
      ) : closing ? (
        <CardFooter>
          <p className="flex w-full items-center gap-2 rounded-lg bg-irreversibleTint px-3 py-2 text-body4 text-irreversible">
            <Flag className="size-4" aria-hidden />
            Closed at {new Date(market.deadline * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — settling on the oracle’s next read.
          </p>
        </CardFooter>
      ) : null}
    </Card>
  )
}
