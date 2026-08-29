// The staircase: flat treads, hard risers. Inside an epoch the price does not move at all, so there
// is nothing to win by racing in. Loaded lazily — recharts is not a first-paint dependency.
import { Line, LineChart, ReferenceDot, XAxis, YAxis } from 'recharts'
import { UNITS_PER_EPOCH, unitPriceAt, type OnChainLaunch } from '@strk20/protocol/app-reads'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatWei } from '@/lib/format'
import { cn } from '@/lib/utils'

const config = {
  price: { label: 'Unit price', color: 'var(--color-chart-1)' },
} satisfies ChartConfig

interface Tread {
  unit: number
  epoch: number
  price: number
}

/** One point per epoch boundary plus a closing point, so `stepAfter` draws every tread's full width. */
function treads(launch: OnChainLaunch, decimals: number | null): Tread[] {
  // An unverified scale plots raw units rather than a guessed 18.
  const scale = decimals === null ? 1 : 10 ** decimals
  const rows: Tread[] = []
  for (let e = 0; e < launch.epochs; e += 1) {
    rows.push({ unit: e * UNITS_PER_EPOCH, epoch: e, price: Number(unitPriceAt(launch, e)) / scale })
  }
  const last = Math.max(0, launch.epochs - 1)
  rows.push({ unit: launch.epochs * UNITS_PER_EPOCH, epoch: last, price: Number(unitPriceAt(launch, last)) / scale })
  return rows
}

export interface StaircaseChartProps {
  launch: OnChainLaunch
  decimals: number | null
  symbol: string
  /** The epoch to light: the one the next unit sells in. */
  at: number
  className?: string
}

export default function StaircaseChart({ launch, decimals, symbol, at, className }: StaircaseChartProps) {
  const data = treads(launch, decimals)
  const lit = data[Math.min(at, launch.epochs - 1)]
  const soldX = Math.min(launch.sold, launch.epochs * UNITS_PER_EPOCH)
  const unit = decimals === null ? `${symbol} units` : symbol
  return (
    <div className="flex flex-col">
      <span className="sr-only">
        Price is flat within each of {launch.epochs} epochs and steps up between them. This epoch:{' '}
        {decimals === null ? `${unitPriceAt(launch, at)} ${unit}` : `${formatWei(unitPriceAt(launch, at), decimals)} ${symbol}`} per unit.
      </span>
    <ChartContainer config={config} className={cn('min-w-0 overflow-hidden', className ?? 'h-44 w-full')}>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="unit"
          type="number"
          domain={[0, launch.epochs * UNITS_PER_EPOCH]}
          ticks={data.map((d) => d.unit)}
          tickFormatter={(v: number) => (v === launch.epochs * UNITS_PER_EPOCH ? 'end' : `e${Math.floor(v / UNITS_PER_EPOCH) + 1}`)}
          tickLine={false}
          axisLine={false}
          fontSize={11}
        />
        <YAxis
          dataKey="price"
          width={56}
          tickLine={false}
          axisLine={false}
          fontSize={11}
          tickFormatter={(v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 })}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => {
                const row = payload?.[0]?.payload as Tread | undefined
                return row ? `Epoch ${row.epoch + 1} · from unit ${row.unit}` : ''
              }}
              formatter={(value) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${unit}`}
            />
          }
        />
        <Line type="stepAfter" dataKey="price" stroke="var(--color-price)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {lit ? <ReferenceDot x={soldX} y={lit.price} r={5} fill="var(--color-price)" stroke="var(--color-background)" strokeWidth={2} /> : null}
      </LineChart>
    </ChartContainer>
    </div>
  )
}
