import { Suspense, lazy } from 'react'
import { CHART_REFERENCE_IS_WINDOW_OPEN, PRICE_SERIES_PROVENANCE } from '@strk20/protocol/markets-copy'

import { Skeleton } from '@/components/ui/skeleton'
import type { PriceChartProps } from './price-chart'

// `React.lazy` so Recharts is its own chunk; the Suspense fallback holds the chart's height.
const PriceChart = lazy(() => import('./price-chart'))

export function LazyPriceChart(props: PriceChartProps & { pair: string; caption?: 'window' | 'strike' }) {
  const height = props.height ?? 220
  const { pair, caption = 'window', ...chart } = props
  if (chart.series.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="w-full" style={{ height }} />
        <p className="text-body4 text-muted-foreground">No {pair} readings yet — the line starts with the relay’s first one.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Suspense fallback={<Skeleton className="w-full" style={{ height }} />}>
        <PriceChart {...chart} />
      </Suspense>
      <p className="text-body4 text-muted-foreground">
        {caption === 'window' ? CHART_REFERENCE_IS_WINDOW_OPEN : 'The dashed line is this market’s strike — green above it, red below.'}{' '}
        {PRICE_SERIES_PROVENANCE}
      </p>
    </div>
  )
}
