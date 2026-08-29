import { Link } from '@tanstack/react-router'
import { Clock, Sunrise } from 'lucide-react'
import { MARKET_STATE, potShare, windowLabel, type OnChainMarket } from '@strk20/protocol/app-reads'
import type { PricePoint } from '@strk20/protocol/chain-feed-wire'
import { payoutMultiple } from '@strk20/protocol/market-math'
import { BET_SIDE_DOWN, BET_SIDE_UP } from '@strk20/protocol/markets-copy'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import { formatPrice } from '@strk20/protocol/pragma-pairs'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { sideLabel, takesBets } from './market-card'
import { PairMark } from './pair-mark'
import { Sparkline } from './sparkline'

export interface WindowTicketProps {
  market: OnChainMarket
  /** Epoch ms, ticking every second: the countdown is the whole point of a window. */
  now: number
  /** Live Pragma median for the pair, 8-dp. Absent = not read yet. */
  spot: number | null
  history: readonly PricePoint[]
  symbol: string
  decimals: number | null
  onBet?: (side: number) => void
  className?: string
}

/** "12:07" under an hour, "3h 12m" above, "closed" past the deadline. */
function countdown(deadline: number, nowMs: number): string {
  const s = deadline - Math.floor(nowMs / 1000)
  if (s <= 0) return 'closed'
  if (s >= 3_600) return `${Math.floor(s / 3_600)}h ${String(Math.floor((s % 3_600) / 60)).padStart(2, '0')}m`
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** One standing window: pair, live price against its line, the countdown, the split, two doors. */
export function WindowTicket({ market, now, spot, history, symbol, decimals, onBet, className }: WindowTicketProps) {
  const unopened = market.state === MARKET_STATE.none
  const open = takesBets(market, now)
  const share = potShare(market)
  const windowStartMs = (market.deadline - market.window) * 1000
  const elapsedPct = Math.max(0, Math.min(100, ((now - windowStartMs) / (market.window * 1000)) * 100))
  const reference = market.strike !== 0n ? Number(market.strike) : null
  const delta = spot !== null && reference !== null ? ((spot - reference) / reference) * 100 : null
  const unit = decimals !== null ? 10n ** BigInt(decimals) : 10n ** 18n
  const paysUp = payoutMultiple(market.up, market.down, market.k, SIDE_UP, unit, market.vigBps)
  const paysDown = payoutMultiple(market.up, market.down, market.k, SIDE_DOWN, unit, market.vigBps)
  const settled = market.state === MARKET_STATE.resolved || market.state === MARKET_STATE.voided

  return (
    <Card className={cn('h-full gap-3 py-4', className)}>
      <CardHeader className="gap-2 px-4">
        <div className="flex items-center justify-between gap-2">
          <Link to="/markets/$id" params={{ id: String(market.id) }} className="flex min-w-0 items-center gap-2 hover:underline">
            <PairMark pair={market.pair} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-display4 uppercase">{market.pair}</span>
              <span className="text-body4 text-muted-foreground">
                {windowLabel(market.window)}
                {market.experimental ? ' · experimental' : ''}
              </span>
            </span>
          </Link>
          <Badge variant="outline" className={cn('shrink-0 gap-1 font-mono text-navLabel uppercase tabular-nums', settled && 'text-muted-foreground')}>
            {settled ? (
              market.state === MARKET_STATE.resolved ? `${sideLabel(market.winner)} won` : 'Voided'
            ) : (
              <>
                <Clock className="size-3" aria-hidden />
                {countdown(market.deadline, now)}
              </>
            )}
          </Badge>
        </div>
        {!settled ? <Progress value={elapsedPct} className="h-1" aria-label="Time elapsed in this window" /> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-display3 tabular-nums">{spot !== null ? `$${formatPrice(spot / 1e8)}` : '—'}</span>
          {delta !== null ? (
            <span className={cn('font-mono text-body4 tabular-nums', delta >= 0 ? 'text-settled' : 'text-irreversible')}>
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(2)}% vs line
            </span>
          ) : unopened ? (
            <span className="inline-flex items-center gap-1 text-body4 text-muted-foreground">
              <Sunrise className="size-3" aria-hidden />
              opens on first bet
            </span>
          ) : null}
        </div>
        <Sparkline points={history} fromMs={windowStartMs} reference={reference} />
        <div className="flex items-center justify-between text-body4">
          <span className="text-muted-foreground">{reference !== null ? `Line $${formatPrice(reference / 1e8)}` : 'Line set by the first bet'}</span>
          <span className="text-muted-foreground">
            {unopened ? 'House seed ' : 'Pot '}
            <Amount wei={unopened ? market.seed : market.up + market.down} decimals={decimals} symbol={symbol} size="sm" />
          </span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="bg-settled" style={{ width: `${share.upPct}%` }} />
          <span className="bg-irreversible" style={{ width: `${share.downPct}%` }} />
        </div>
      </CardContent>

      {onBet && open ? (
        <CardFooter className="grid grid-cols-2 gap-2 px-4">
          <Button variant="outline" className="h-auto flex-col gap-0 border-settled py-1.5 text-settled" onClick={() => onBet(SIDE_UP)}>
            <span>
              {BET_SIDE_UP} {share.upPct}%
            </span>
            <span className="font-mono text-[11px] font-normal tabular-nums opacity-80">1 → {paysUp.toFixed(2)}</span>
          </Button>
          <Button variant="outline" className="h-auto flex-col gap-0 border-irreversible py-1.5 text-irreversible" onClick={() => onBet(SIDE_DOWN)}>
            <span>
              {BET_SIDE_DOWN} {share.downPct}%
            </span>
            <span className="font-mono text-[11px] font-normal tabular-nums opacity-80">1 → {paysDown.toFixed(2)}</span>
          </Button>
        </CardFooter>
      ) : (
        <CardFooter className="px-4 text-body4 text-muted-foreground">
          {settled ? 'Settled — claim from your record below.' : unopened ? 'Too close to the close to open. Next window at the mark.' : 'Closed — awaiting settlement.'}
        </CardFooter>
      )}
    </Card>
  )
}
