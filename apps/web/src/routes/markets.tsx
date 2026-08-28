import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import {
  MARKETS_NONE_OPEN,
  MARKETS_NOT_DEPLOYED,
  MARKETS_STANDING_LINE,
  MARKETS_TITLE,
  CHART_REFERENCE_IS_SESSION_OPEN,
  PRICE_SERIES_IS_SESSION,
} from '@strk20/protocol/markets-copy'
import { PRAGMA_PAIR_LIST, type PragmaPair } from '@strk20/protocol/pragma-pairs'

import { MarketsTour } from '../components/MarketsTour'
import { PriceChart } from '../components/PriceChart'
import { PriceStrip } from '../components/PriceStrip'
import { Text } from '../components/ui/Text'
import { cn } from '../lib/cn'
import { MARKETS_DEPLOYED } from '../shell/app-contracts'
import { usePragma } from '../shell/use-pragma'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/markets')({
  component: Markets,
})

//
// MARKETS — the surface, built around what is true today.
//
// ── WHAT IS REAL RIGHT NOW, AND WHAT IS HONESTLY EMPTY ───────────────────────────────────
//
// The contracts are written, tested (109 snforge tests) and committed. They are NOT deployed. So
// this surface has two halves and they are treated completely differently:
//
//   THE PRICES ARE LIVE. Pragma's `get_data_median` is a free view call on a contract that has
//   been on mainnet for years, and it is the same oracle a market will resolve against. The strip,
//   the chart and the freshness state are all real reads, from the first paint, with no deployment.
//
//   THE MARKETS ARE ABSENT, and the surface says so in those words. No fixture, no greyed-out row
//   with plausible odds in it. A screenshot of invented markets is indistinguishable from a
//   working product, which is exactly the fixture-as-truth the anti-demo gate exists to stop —
//   and it is the one thing that would make everything else here untrustworthy.
//
// ── THE 480px COLUMN IS GONE ON THIS ROUTE ───────────────────────────────────────────────
//
// Same argument the wallet made: a table and a chart need width, and the people judging this open
// it on a desktop. From 1024 up the surface is a wide grid; below that it stacks.
//
function Markets() {
  const state = usePragma(PRAGMA_PAIR_LIST)
  const [pair, setPair] = useState<PragmaPair>('BTC/USD')
  const series = state.series[pair]?.points ?? []
  const observed = state.series[pair]?.observed ?? 0

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <header className="flex flex-col gap-s8 border-b border-solid border-surface3 pb-s12">
          <Text variant="kicker">05 — positions</Text>
          <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
            {MARKETS_TITLE}
          </Text>
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            {MARKETS_STANDING_LINE}
          </Text>
        </header>

        {/*
          THE STRIP IS A CONTROL, not a ticker: pressing a pair moves the chart below it. That is
          why it is the one part of this surface with something to do while the contracts are
          absent — a reader can watch a real price and see the shape a market will be drawn on.
        */}
        <PriceStrip state={state} pairs={PRAGMA_PAIR_LIST} selected={pair} onSelect={setPair} />

        {state.problem ? (
          <Text variant="body3" className="text-exposed" role="status">
            {state.problem}
          </Text>
        ) : null}

        <div className="grid gap-s16 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-s24">
          <section className="flex min-w-0 flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
            <div className="flex items-baseline justify-between gap-s8">
              <Text variant="subheading1" as="h2">
                {pair}
              </Text>
              <Text variant="body4" className="numeric text-neutral3">
                {observed === 0
                  ? 'waiting for the first reading'
                  : observed === 1
                    ? '1 reading this session'
                    : `${observed} readings this session`}
              </Text>
            </div>

            {series.length < 2 ? (
              //
              // TWO POINTS ARE THE MINIMUM FOR A LINE, and until the second reading lands there is
              // genuinely nothing to draw. Reserved at the chart's own height so the panel does not
              // jump when it arrives.
              //
              <div
                className="flex items-center justify-center rounded-card bg-inset"
                style={{ height: 220 }}
              >
                <Text variant="body4" className="text-neutral3">
                  Watching for a second reading — the line starts once the price moves.
                </Text>
              </div>
            ) : (
              //
              // THE REFERENCE LINE IS WHAT MAKES VERDICT MODE REAL TODAY.
              //
              // The chart's two-clipped-pass drawing — green above a level, red below — is the one
              // thing it does that a charting library will not, and it is the shape a market's
              // strike will take. With no market there is no strike, and inventing one would be
              // the fake data this surface exists to refuse. The first price this page OBSERVED is
              // a true reference: the reader watched it arrive, and it exercises exactly the path
              // a real strike will use. `CHART_REFERENCE_IS_SESSION_OPEN` says which it is.
              //
              <PriceChart
                series={series}
                target={series[0] ?? null}
                height={220}
                label={`${pair} since this page opened`}
              />
            )}

            <Text variant="body4" className="text-neutral3">
              {PRICE_SERIES_IS_SESSION} {CHART_REFERENCE_IS_SESSION_OPEN}
            </Text>
          </section>

          {/*
            THE TICKET SLOT. Once the contracts land this is where the bet ticket docks — the
            `lg:static` responsive panel that is a slide-over on a phone and a docked column here.
            Until then it holds the honest absence rather than a disabled form: a form that cannot
            submit is a promise, and this surface has nothing to promise yet.
          */}
          <aside
            className={cn(
              'flex min-w-0 flex-col gap-s12 rounded-large border border-solid border-surface3 p-s16',
              'lg:sticky lg:top-[88px]',
            )}
          >
            <Text variant="subheading2" as="h2">
              {MARKETS_DEPLOYED ? 'Open a position' : 'Not open yet'}
            </Text>
            <Text variant="body3" className="text-neutral2">
              {MARKETS_DEPLOYED ? MARKETS_NONE_OPEN : MARKETS_NOT_DEPLOYED}
            </Text>
            <MarketsTour />
          </aside>
        </div>
      </div>
    </Surface>
  )
}
