import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  MARKETS_NOT_DEPLOYED,
  MARKETS_STANDING_LINE,
  MARKETS_TITLE,
  MARKETS_NONE_OPEN,
  CHART_REFERENCE_IS_WINDOW_OPEN,
  PRICE_SERIES_PROVENANCE,
} from '@strk20/protocol/markets-copy'
import { PRAGMA_PAIR_LIST, type PragmaPair } from '@strk20/protocol/pragma-pairs'
import { MARKET_STATE, marketQuestion, type OnChainMarket } from '@strk20/protocol/app-reads'
import { SIDE_UP } from '@strk20/protocol/market-calldata'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { ActivityTape } from '../components/launch/ActivityTape'
import { BetTicket } from '../components/markets/BetTicket'
import { CreateMarket } from '../components/markets/CreateMarket'
import { MarketCard } from '../components/markets/MarketCard'
import { MarketRoom } from '../components/markets/MarketRoom'
import { MarketsTour } from '../components/MarketsTour'
import { PriceChart } from '../components/PriceChart'
import { PriceStrip } from '../components/PriceStrip'
import { Button } from '../components/LegacyButton'
import { Text } from '../components/Text'
import { MARKETS_DEPLOYED } from '../shell/app-contracts'
import { useChainFeed } from '../shell/chain-feed'
import { useMarkets } from '../shell/use-app-reads'
import { usePositions } from '../shell/use-positions'
import { usePragma } from '../shell/use-pragma'
import { shortenFelt } from '../shell/session'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/markets')({
  component: Markets,
})

/** A market someone can still bet into: active, and its clock still running. */
function isOpen(market: OnChainMarket, nowMs: number): boolean {
  return market.state === MARKET_STATE.active && market.deadline * 1000 > nowMs
}

//
// MARKETS — the board, full width, every market wearing its face.
//
// ── THE LIST IS THE SURFACE NOW, NOT A RAIL ──────────────────────────────────────────────
//
// The 360px sidebar the list used to live in was the prototype's shape: a chart with a ticket
// slot. A market product's centre of gravity is the MARKETS — so the cards take the grid, each
// one carrying its pair mark, its clock, the live spot, and the verdict chart drawn against its
// OWN strike (the one thing this canvas does that a chart library will not). The hero chart
// stays above them as the price context every question is asked against; creating a market is a
// header action — present, never the headline.
//
// ── AND THE BOARD SAYS WHAT JUST HAPPENED ────────────────────────────────────────────────
//
// The Recently strip is the contracts' own events off the live feed — opened, bet into, settled,
// claimed — each row with its transaction. A market page where nothing visibly happens reads as
// abandoned even when it is not; the tape is the difference, and it is all real.
//
function Markets() {
  const state = usePragma(PRAGMA_PAIR_LIST)
  const feed = useChainFeed()
  const read = useMarkets()
  const [pair, setPair] = useState<PragmaPair>('BTC/USD')
  const [ticket, setTicket] = useState<{ market: OnChainMarket; side: number } | null>(null)
  const [room, setRoom] = useState<OnChainMarket | null>(null)
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const series = state.series[pair]?.points ?? []
  const observed = state.series[pair]?.observed ?? 0
  const open = read.markets.filter((m) => isOpen(m, now))
  const settled = read.markets.filter((m) => !isOpen(m, now))

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <header className="flex flex-col gap-s8 border-b border-solid border-surface3 pb-s12">
          <Text variant="kicker">05 — positions</Text>
          <div className="flex flex-wrap items-end justify-between gap-s12">
            <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
              {MARKETS_TITLE}
            </Text>
            {MARKETS_DEPLOYED ? (
              <Button variant="secondary" size="md" onClick={() => setCreating(true)}>
                Create a market
              </Button>
            ) : null}
          </div>
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            {MARKETS_STANDING_LINE}
          </Text>
        </header>

        <PriceStrip state={state} pairs={PRAGMA_PAIR_LIST} selected={pair} onSelect={setPair} />

        {state.problem ? (
          <Text variant="body3" className="text-exposed" role="status">
            {state.problem}
          </Text>
        ) : null}

        <section className="flex min-w-0 flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
          <div className="flex items-baseline justify-between gap-s8">
            <Text variant="subheading1" as="h2">
              {pair}
            </Text>
            <Text variant="body4" className="numeric text-neutral3">
              {observed === 0
                ? 'waiting for the first reading'
                : observed === 1
                  ? '1 reading on the line'
                  : `${observed} readings on the line`}
            </Text>
          </div>

          {series.length === 0 ? (
            <div className="flex items-center justify-center rounded-card bg-inset" style={{ height: 220 }}>
              <Text variant="body4" className="text-neutral3">
                Reading the oracle…
              </Text>
            </div>
          ) : (
            <PriceChart
              series={series.length === 1 ? [series[0]!, series[0]!] : series}
              target={series[0] ?? null}
              height={220}
              label={`${pair} over the drawn window`}
            />
          )}

          <Text variant="body4" className="text-neutral3">
            {PRICE_SERIES_PROVENANCE} {CHART_REFERENCE_IS_WINDOW_OPEN}
          </Text>
        </section>

        {MARKETS_DEPLOYED ? (
          <>
            {read.problem ? (
              <Text variant="body4" className="text-exposed" role="status">
                {read.problem}
              </Text>
            ) : null}

            {open.length === 0 ? (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                <Text variant="body3" className="text-neutral2">
                  {read.loading ? 'Reading the markets contract…' : MARKETS_NONE_OPEN}
                </Text>
                {/* Secondary on purpose: visitors come to bet. The board fills itself. */}
                <Button variant="secondary" size="md" className="self-start" onClick={() => setCreating(true)}>
                  Open your own
                </Button>
              </section>
            ) : (
              <div className="grid gap-s12 md:grid-cols-2 xl:grid-cols-3">
                {open.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    now={now}
                    spot={
                      feed.prices[market.pair] ? feed.prices[market.pair]!.price : null
                    }
                    history={feed.history[market.pair] ?? []}
                    onBet={(side) => setTicket({ market, side })}
                    onRoom={() => setRoom(market)}
                  />
                ))}
              </div>
            )}

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Recently — opened · bet into · settled</Text>
              <ActivityTape
                items={feed.tape}
                markets={read.markets}
                launches={feed.launches}
                scope={{ family: 'markets' }}
                limit={12}
                emptyLine={
                  feed.stream === 'live'
                    ? 'Quiet right now — the next bet or settlement lands here as it happens.'
                    : 'The live feed is reconnecting. Activity resumes with it; nothing is lost.'
                }
              />
            </section>

            {settled.length > 0 ? (
              <section className="flex flex-col gap-s4 rounded-large border border-solid border-surface3 p-s16">
                <Text variant="kicker">Settled</Text>
                {settled.map((market) => {
                  // The settlement's own receipt, off the tape — "YES won" with no transaction
                  // hash was the review's exact complaint about this list.
                  const settle = feed.tape.find(
                    (item) =>
                      (item.kind === 'market-resolved' || item.kind === 'market-voided') &&
                      item.marketId === market.id,
                  )
                  const href = settle ? voyagerTxUrl(settle.txHash) : null
                  return (
                    <div key={market.id} className="flex items-baseline justify-between gap-s8">
                      <Link
                        to="/markets/$id"
                        params={{ id: String(market.id) }}
                        preload="intent"
                        className="focus-ring min-w-0 no-underline"
                      >
                        <Text variant="body4" className="truncate text-neutral2 hover:text-neutral1 hover:underline">
                          {marketQuestion(market)}
                        </Text>
                      </Link>
                      <span className="flex shrink-0 items-baseline gap-s8">
                        <Text variant="mono" className="text-neutral3">
                          {market.state === MARKET_STATE.voided
                            ? 'voided'
                            : market.state === MARKET_STATE.resolved
                              ? market.winner === SIDE_UP
                                ? 'YES won'
                                : 'NO won'
                              : 'closing'}
                        </Text>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-ring font-mono text-mono text-neutral3 underline hover:text-neutral1"
                          >
                            tx ↗
                          </a>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </section>
            ) : null}

            <MarketPositions />
          </>
        ) : (
          <section className="rounded-large border border-solid border-surface3 p-s16">
            <Text variant="subheading2" as="h2">
              Not open yet
            </Text>
            <Text variant="body3" className="mt-s4 max-w-[70ch] text-neutral2">
              {MARKETS_NOT_DEPLOYED}
            </Text>
          </section>
        )}

        <MarketsTour />

        {ticket ? (
          <BetTicket
            market={ticket.market}
            now={now}
            open={ticket !== null}
            initialSide={ticket.side}
            onClose={() => setTicket(null)}
          />
        ) : null}
        {room ? <MarketRoom market={room} open={room !== null} onClose={() => setRoom(null)} /> : null}
        <CreateMarket open={creating} onClose={() => setCreating(false)} />
      </div>
    </Surface>
  )
}

/** The market-venue positions this browser holds, in the launch section's grammar. */
function MarketPositions() {
  const positions = usePositions()
  const held = positions.filter((p) => p.venue === 'market')
  if (held.length === 0) return null
  return (
    <section className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions</Text>
      {held.map((p) => {
        const href = p.txHash ? voyagerTxUrl(p.txHash) : null
        return (
          <div key={p.commitment} className="flex flex-col">
            <Text variant="body4" className="text-neutral1">
              {p.label ?? `Market ${p.id}`}
            </Text>
            <span className="flex items-baseline gap-s8">
              <Text variant="mono" className="truncate text-neutral3">
                {shortenFelt(p.commitment, 10, 8)}
              </Text>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring shrink-0 font-mono text-mono text-accent1"
                >
                  tx ↗
                </a>
              ) : null}
            </span>
          </div>
        )
      })}
      <Text variant="body4" className="text-neutral3">
        Bet sizes and transaction submitters are public; Markets records bearer commitments
        instead of bettor addresses.
      </Text>
    </section>
  )
}
