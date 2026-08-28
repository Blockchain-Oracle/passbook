import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { toPlainText } from '@strk20/protocol/amount'
import {
  MARKET_STATE,
  marketQuestion,
  potShare,
  strikeDisplay,
  timeLeft,
  type OnChainMarket,
} from '@strk20/protocol/app-reads'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import { formatPrice } from '@strk20/protocol/pragma-pairs'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { ActivityTape } from '../components/launch/ActivityTape'
import { BetTicket } from '../components/markets/BetTicket'
import { MarketRoom } from '../components/markets/MarketRoom'
import { PairMark } from '../components/markets/PairMark'
import { PriceChart } from '../components/PriceChart'
import { Button } from '../components/ui/Button'
import { Text } from '../components/ui/Text'
import { cn } from '../lib/cn'
import { useChainFeed } from '../shell/chain-feed'
import { useMarkets } from '../shell/use-app-reads'
import { usePositions } from '../shell/use-positions'
import { findToken, useTokenList } from '../shell/use-token-list'
import { shortenFelt } from '../shell/session'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/markets_/$id')({
  component: MarketRecord,
})

//
// ONE MARKET, WHOLE — the record page. The card is the door; this is the room: the question at
// full size against its own strike line, the numbers the contract holds, every bet and the
// settlement with their transactions, the market's open thread, and the two doors in — never
// behind a second click. `launch_.$id.tsx`'s grammar on the markets surface.
//
function MarketRecord() {
  const { id } = Route.useParams()
  const marketId = /^\d+$/.test(id) ? Number(id) : null
  const read = useMarkets()
  const feed = useChainFeed()
  const { tokens } = useTokenList()
  const [now, setNow] = useState(() => Date.now())
  const [ticket, setTicket] = useState<{ side: number } | null>(null)
  const [room, setRoom] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const market = marketId === null ? undefined : read.markets.find((m) => m.id === marketId)

  if (!market) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s12">
          <Crumb />
          <Text variant="body3" className="text-neutral2">
            {marketId === null
              ? 'That is not a market id.'
              : read.loading
                ? 'Reading the markets contract…'
                : `Market ${marketId} is not in the read window — the board carries the newest markets, and this one is either older than that or not created yet.`}
          </Text>
        </div>
      </Surface>
    )
  }

  const stake = findToken(tokens, market.token)
  const symbol = stake?.symbol ?? shortenFelt(market.token, 4, 3)
  const decimals = stake?.decimals ?? 18
  const open = market.state === MARKET_STATE.active && market.deadline * 1000 > now
  const share = potShare(market)
  const strike = Number(market.strike) / 1e8
  const spot = feed.prices[market.pair]?.price ?? null
  const history = feed.history[market.pair] ?? []
  const series = history.map((point) => point.p)
  const settle = feed.tape.find(
    (item) =>
      (item.kind === 'market-resolved' || item.kind === 'market-voided') && item.marketId === market.id,
  )
  const settleHref = settle ? voyagerTxUrl(settle.txHash) : null

  const stats: Array<[string, string]> = [
    ['Pot', `${toPlainText(market.up + market.down, decimals)} ${symbol}`],
    ['YES side', `${toPlainText(market.up, decimals)} ${symbol} · ${share.upPct}%`],
    ['NO side', `${toPlainText(market.down, decimals)} ${symbol} · ${share.downPct}%`],
    ['Seed', `${toPlainText(market.seed, decimals)} ${symbol}`],
    ['Strike', `$${strikeDisplay(market.strike)}`],
    [
      open ? 'Closes' : 'Closed',
      open ? timeLeft(market.deadline, now) : new Date(market.deadline * 1000).toLocaleString(),
    ],
  ]

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <Crumb name={marketQuestion(market)} />

        <header className="flex flex-wrap items-center gap-s12 rounded-large border border-solid border-surface3 p-s16">
          <PairMark pair={market.pair} size={44} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-s8">
              <Text variant="display3" as="h1" className="min-w-0 text-neutral1">
                {marketQuestion(market)}
              </Text>
              <span
                className={cn(
                  'shrink-0 rounded-pill border border-solid px-s8 py-s2 font-mono text-mono',
                  open ? 'border-accent1 text-accent1' : 'border-surface3 text-neutral2',
                )}
              >
                {open
                  ? `closes in ${timeLeft(market.deadline, now)}`
                  : market.state === MARKET_STATE.voided
                    ? 'voided'
                    : market.state === MARKET_STATE.resolved
                      ? market.winner === SIDE_UP
                        ? 'YES won'
                        : 'NO won'
                      : 'closing'}
              </span>
            </div>
            <Text variant="mono" className="text-neutral3">
              market #{market.id} · stakes {symbol}
              {market.experimental ? ' · 15-min tier, experimental' : ''}
            </Text>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <Text variant="display3" as="p" className="numeric text-neutral1">
              {spot !== null ? `$${formatPrice(spot)}` : '—'}
            </Text>
            <Text variant="body4" className="text-neutral3">
              live {market.pair} against the ${formatPrice(strike)} line
            </Text>
          </div>
        </header>

        <div className="grid gap-s16 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-s16">
            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The line</Text>
              {series.length >= 2 ? (
                <PriceChart
                  series={series}
                  target={strike}
                  height={220}
                  label={`${market.pair} against this market's $${formatPrice(strike)} line`}
                />
              ) : (
                <div className="flex items-center justify-center rounded-card bg-inset" style={{ height: 220 }}>
                  <Text variant="body4" className="text-neutral3">
                    Waiting for readings…
                  </Text>
                </div>
              )}
              <Text variant="body4" className="text-neutral3">
                Green above the strike, red below — the card answers who is winning before a
                number is read. Settlement is the oracle&rsquo;s print, not this line.
              </Text>
            </section>

            <section className="rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The numbers</Text>
              <dl className="mt-s8 grid grid-cols-2 gap-s12 md:grid-cols-3">
                {stats.map(([label, value]) => (
                  <div key={label} className="flex flex-col">
                    <dt className="text-body4 text-neutral3">{label}</dt>
                    <dd className="numeric m-s0 font-mono text-body3 text-neutral1">{value}</dd>
                  </div>
                ))}
              </dl>
              {settleHref ? (
                <a
                  href={settleHref}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring mt-s8 inline-block font-mono text-mono text-accent1 underline"
                >
                  the settling transaction ↗
                </a>
              ) : null}
            </section>

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Activity</Text>
              <ActivityTape
                items={feed.tape}
                markets={read.markets}
                launches={feed.launches}
                scope={{ marketId: market.id }}
                emptyLine="No bets are in the feed's window yet — the next one appears here as it happens, with its transaction."
              />
            </section>
          </div>

          <aside className="flex flex-col gap-s12 self-start lg:sticky lg:top-[88px]">
            {open ? (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
                <Text variant="subheading2" as="h2" className="text-neutral1">
                  Take a side
                </Text>
                <div className="flex gap-s6">
                  <button
                    type="button"
                    onClick={() => setTicket({ side: SIDE_UP })}
                    className="focus-ring flex-1 cursor-pointer rounded-control bg-settledTint py-s10 text-buttonLabel3 text-settled"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setTicket({ side: SIDE_DOWN })}
                    className="focus-ring flex-1 cursor-pointer rounded-control bg-irreversibleTint py-s10 text-buttonLabel3 text-irreversible"
                  >
                    No
                  </button>
                </div>
                <Text variant="body4" className="text-neutral3">
                  The bet size is public. The bettor is not — your stake arrives through the pool
                  as a bearer commitment.
                </Text>
              </section>
            ) : (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
                <Text variant="subheading2" as="h2" className="text-neutral1">
                  {market.state === MARKET_STATE.voided
                    ? 'Voided'
                    : market.state === MARKET_STATE.resolved
                      ? 'Settled'
                      : 'Closing'}
                </Text>
                <Text variant="body4" className="text-neutral2">
                  {market.state === MARKET_STATE.voided
                    ? 'Every bet reclaims in full — a market nobody settles strands nobody.'
                    : market.state === MARKET_STATE.resolved
                      ? `${market.winner === SIDE_UP ? 'YES' : 'NO'} won on the oracle's settling print. Winning tickets claim from the pot.`
                      : 'The clock ran out. The keeper settles on the oracle’s print within its window.'}
                </Text>
              </section>
            )}

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The Room</Text>
              <Text variant="body4" className="text-neutral2">
                This market&rsquo;s open thread — the same rail as every Talk tab.
              </Text>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setRoom(true)}>
                Open the thread
              </Button>
            </section>

            <RecordPositions marketId={market.id} />
          </aside>
        </div>

        {ticket ? (
          <BetTicket
            market={market}
            now={now}
            open
            initialSide={ticket.side}
            onClose={() => setTicket(null)}
          />
        ) : null}
        {room ? <MarketRoom market={market} open onClose={() => setRoom(false)} /> : null}
      </div>
    </Surface>
  )
}

/** The browser's own claims on THIS market, each pointing at its transaction. */
function RecordPositions({ marketId }: { marketId: number }) {
  const positions = usePositions()
  const held = positions.filter((p) => p.venue === 'market' && p.id === marketId)
  if (held.length === 0) return null
  return (
    <section className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions here</Text>
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
        The bet size is public. The bettor is not.
      </Text>
    </section>
  )
}

function Crumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-s6 font-mono text-mono text-neutral3">
      <Link to="/markets" className="focus-ring no-underline hover:text-neutral1">
        Markets
      </Link>
      <span aria-hidden="true">›</span>
      <span className="max-w-[48ch] truncate text-neutral2">{name ?? '…'}</span>
    </nav>
  )
}
