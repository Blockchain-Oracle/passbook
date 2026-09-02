// Market Pulse: three short lists over the board's own read — nothing fetched twice. Each list
// says when it was read and whether all of it came back; a list with nothing in it says so
// instead of disappearing.
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Clock3, Landmark, Scale } from 'lucide-react'
import { marketQuestion, potShare, timeLeft } from '@strk20/protocol/app-reads'
import { PULSE_BODY, PULSE_METRICS, PULSE_TITLE, pulseReading, type PulseMetric, type PulseReading } from '@strk20/protocol/market-pulse'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { marketsQuery } from '@/queries'

const ICON: Record<PulseMetric, typeof Clock3> = { 'closing-soon': Clock3, 'largest-open-pot': Landmark, 'closest-market': Scale }

const STATE_WORD = { live: null, stale: 'Stale', partial: 'Partial read', empty: null } as const

/** The observation, as time since — the block is not on this read, so the clock is what there is. */
function readAgo(now: number, observedAt: number): string {
  const seconds = Math.max(0, Math.round((now - observedAt) / 1000))
  if (seconds < 60) return `Read ${seconds}s ago`
  return `Read ${Math.round(seconds / 60)}m ago`
}

function Figure({ reading, market, now, symbol, decimals }: { reading: PulseReading; market: PulseReading['rows'][number]['market']; now: number; symbol: string; decimals: number | null }) {
  if (reading.metric === 'closing-soon') return <span className="font-mono tabular-nums text-body4">{timeLeft(market.deadline, now)}</span>
  if (reading.metric === 'largest-open-pot') return <Amount wei={market.collateral} decimals={decimals} symbol={symbol} size="sm" />
  const split = potShare(market)
  return <span className="font-mono tabular-nums text-body4">{`${split.upPct.toFixed(0)} / ${split.downPct.toFixed(0)}`}</span>
}

export interface PulseProps {
  now: number
  symbol: string
  decimals: number | null
}

export function Pulse({ now, symbol, decimals }: PulseProps) {
  const markets = useQuery(marketsQuery())
  const readings = PULSE_METRICS.map((metric) =>
    pulseReading(
      metric,
      { markets: markets.data?.markets ?? [], problem: markets.data?.problem ?? (markets.isError ? 'unread' : null), observedAt: markets.dataUpdatedAt, stale: markets.isStale },
      Math.floor(now / 1000),
    ),
  )
  if (markets.isPending) return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-kicker uppercase text-muted-foreground">Pulse</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {readings.map((reading) => {
          const Icon = ICON[reading.metric]
          const word = STATE_WORD[reading.state]
          return (
            <Card key={reading.metric} className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-body2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {PULSE_TITLE[reading.metric]}
                  {word ? (
                    <Badge variant="outline" className="ml-auto text-muted-foreground">
                      {word}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>{PULSE_BODY[reading.metric]}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {reading.rows.length === 0 ? (
                  <p className="text-body4 text-muted-foreground">Nothing qualifies right now.</p>
                ) : (
                  reading.rows.map(({ market }) => (
                    <Link
                      key={market.id}
                      to="/markets/$id"
                      params={{ id: String(market.id) }}
                      className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5 hover:bg-raisedHovered"
                    >
                      <span className="truncate text-body4">{marketQuestion(market)}</span>
                      <Figure reading={reading} market={market} now={now} symbol={symbol} decimals={decimals} />
                    </Link>
                  ))
                )}
                {reading.observedAt > 0 ? <p className="text-body4 text-muted-foreground">{readAgo(now, reading.observedAt)}</p> : null}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
