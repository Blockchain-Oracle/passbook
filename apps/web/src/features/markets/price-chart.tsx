// Recharts lives here and only here: the board imports `price-chart-lazy.tsx`, so this file is its
// own chunk and the venue page paints before the charting library arrives.
import { useId } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import type { PricePoint } from '@strk20/protocol/chain-feed-wire'
import { formatPrice } from '@strk20/protocol/pragma-pairs'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

export interface PriceChartProps {
  series: readonly PricePoint[]
  /** The level to colour against: a market's strike, or the window's first price. 8-dp fixed point. */
  reference: number | null
  height?: number
}

const CONFIG = { p: { label: 'Price' } } satisfies ChartConfig

const SCALE = 1e8

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Green above the reference, red below — a market answers "who is winning" with no legend. */
export default function PriceChart({ series, reference, height = 220 }: PriceChartProps) {
  const gradientId = useId().replace(/:/g, '')
  // Points are decimals already; only the strike arrives in the oracle's 8-dp fixed point.
  const data = series.map((point) => ({ t: point.t, p: point.p }))
  const level = reference !== null ? reference / SCALE : (data[0]?.p ?? null)

  const values = data.map((d) => d.p).concat(level !== null ? [level] : [])
  const max = Math.max(...values)
  const min = Math.min(...values)
  // Where the level sits inside the drawn range, top-down — the gradient flips colour there.
  const split = level === null || max === min ? 0 : Math.min(1, Math.max(0, (max - level) / (max - min)))

  return (
    <ChartContainer config={CONFIG} className="w-full" style={{ height }}>
      <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset={split} stopColor="var(--color-settled)" />
            <stop offset={split} stopColor="var(--color-irreversible)" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="t" tickFormatter={timeLabel} tickLine={false} axisLine={false} minTickGap={48} />
        <YAxis
          domain={[min, max]}
          tickFormatter={(v: number) => formatPrice(v)}
          tickLine={false}
          axisLine={false}
          width={72}
          className="font-mono"
        />
        {level !== null ? <ReferenceLine y={level} stroke="var(--color-neutral3)" strokeDasharray="4 4" /> : null}
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t
                return typeof t === 'number' ? new Date(t).toLocaleString() : ''
              }}
              formatter={(value) => `$${formatPrice(Number(value))}`}
            />
          }
        />
        <Line type="monotone" dataKey="p" stroke={`url(#${gradientId})`} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  )
}
