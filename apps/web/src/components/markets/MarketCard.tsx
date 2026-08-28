//
// One market, as a card with a face — the anatomy yosuku proved, drawn in STUDIO's grammar.
//
// Top to bottom: the pair's mark and the clock; the QUESTION, pinned (it never rewrites itself
// mid-read — the strike is chain state); the live spot with its move over the drawn window; the
// verdict chart — the series painted against THIS market's own strike, green above, red below,
// so the card answers "who is winning right now" before a single number is read; the pot as a
// fact (never a probability claim); and the two doors in, each carrying its side into the ticket.
//
// The Room is the market's open thread — the same rail as every Talk tab, one press away.
//
import { Link } from '@tanstack/react-router'

import type { PricePoint } from '@strk20/protocol/chain-feed-wire'
import {
  MARKET_STATE,
  marketQuestion,
  potShare,
  timeLeft,
  type OnChainMarket,
} from '@strk20/protocol/app-reads'
import { SIDE_DOWN, SIDE_UP } from '@strk20/protocol/market-calldata'
import { toPlainText } from '@strk20/protocol/amount'
import { formatPrice } from '@strk20/protocol/pragma-pairs'

import { cn } from '../../lib/cn'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { PriceChart } from '../PriceChart'
import { Text } from '../ui/Text'
import { PairMark } from './PairMark'

const URGENT_MS = 5 * 60 * 1000

/** The move across the drawn window, as a chip: sign, percent, and how long a window that is. */
function windowDelta(history: readonly PricePoint[]): { pct: number; label: string } | null {
  if (history.length < 2) return null
  const first = history[0]!
  const last = history[history.length - 1]!
  if (first.p === 0) return null
  const pct = ((last.p - first.p) / first.p) * 100
  const hours = (last.t - first.t) / 3_600_000
  const label = hours >= 1.5 ? `${Math.round(hours)}h` : `${Math.max(1, Math.round(hours * 60))}m`
  return { pct, label }
}

export function MarketCard({
  market,
  now,
  spot,
  history,
  onBet,
  onRoom,
}: {
  market: OnChainMarket
  now: number
  /** The pair's latest reading off the feed, or null when it has not arrived. */
  spot: number | null
  history: readonly PricePoint[]
  onBet: (side: number) => void
  onRoom: () => void
}) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, market.token)
  const share = potShare(market)
  const pot =
    stake?.decimals != null
      ? `${toPlainText(market.up + market.down, stake.decimals)} ${stake.symbol}`
      : null
  const open = market.state === MARKET_STATE.active && market.deadline * 1000 > now
  const urgent = open && market.deadline * 1000 - now < URGENT_MS
  const delta = windowDelta(history)
  const series = history.map((point) => point.p)
  const strike = Number(market.strike) / 1e8

  return (
    <section className="flex flex-col gap-s10 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <div className="flex items-center gap-s8">
        <PairMark pair={market.pair} size={28} />
        <Text variant="mono" className="flex-1 text-neutral3">
          {market.pair}
        </Text>
        <span
          className={cn(
            'flex items-center gap-s6 rounded-pill border border-solid px-s8 py-s2 font-mono text-mono',
            urgent ? 'border-irreversible text-irreversible' : 'border-surface3 text-neutral2',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-s6 rounded-pill', open ? (urgent ? 'bg-irreversible' : 'bg-accent1') : 'bg-neutral3')}
          />
          {open ? timeLeft(market.deadline, now) : 'closed'}
        </span>
      </div>

      {/* The question is the door into the market's record page — the card keeps its two
          price buttons working in place, but the market itself is now somewhere you can GO. */}
      <Link
        to="/markets/$id"
        params={{ id: String(market.id) }}
        preload="intent"
        className="focus-ring no-underline"
      >
        <Text variant="body2" className="font-medium text-neutral1 hover:underline">
          {marketQuestion(market)}
        </Text>
      </Link>

      <div className="flex items-baseline gap-s8">
        <Text variant="heading3" as="p" className="numeric text-neutral1">
          {spot !== null ? `$${formatPrice(spot)}` : '—'}
        </Text>
        {delta ? (
          <Text
            variant="mono"
            className={delta.pct >= 0 ? 'text-settled' : 'text-irreversible'}
          >
            {delta.pct >= 0 ? '+' : ''}
            {delta.pct.toFixed(2)}% · {delta.label}
          </Text>
        ) : null}
      </div>

      {series.length >= 2 ? (
        <PriceChart
          series={series}
          target={strike}
          height={72}
          label={`${market.pair} against this market's $${formatPrice(strike)} line`}
        />
      ) : (
        <div className="flex items-center justify-center rounded-card bg-inset" style={{ height: 72 }}>
          <Text variant="body4" className="text-neutral3">
            Waiting for readings…
          </Text>
        </div>
      )}

      <div className="flex flex-col gap-s4">
        <div className="h-s4 overflow-hidden rounded-pill bg-insetHovered">
          <span
            aria-hidden="true"
            className="block h-full rounded-pill bg-accent1"
            style={{ width: `${share.upPct}%` }}
          />
        </div>
        <div className="flex items-center gap-s8">
          <Text variant="mono" className="text-accent1">
            YES {share.upPct}%
          </Text>
          <Text variant="mono" className="text-neutral3">
            NO {share.downPct}%
          </Text>
          {pot ? (
            <Text variant="mono" className="flex-1 text-right text-neutral3">
              {pot} pot
            </Text>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="flex gap-s6">
          <button
            type="button"
            onClick={() => onBet(SIDE_UP)}
            className="focus-ring flex-1 cursor-pointer rounded-control bg-settledTint py-s8 text-buttonLabel4 text-settled"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onBet(SIDE_DOWN)}
            className="focus-ring flex-1 cursor-pointer rounded-control bg-irreversibleTint py-s8 text-buttonLabel4 text-irreversible"
          >
            No
          </button>
        </div>
      ) : (
        <Text variant="body4" className="text-neutral2">
          {market.state === MARKET_STATE.voided
            ? 'Voided — every bet reclaims in full.'
            : market.state === MARKET_STATE.resolved
              ? market.winner === SIDE_UP
                ? 'Settled — YES won.'
                : 'Settled — NO won.'
              : 'Closed — waiting for the oracle’s settling print.'}
        </Text>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onRoom}
          className="focus-ring cursor-pointer rounded-pill border border-solid border-surface3 bg-transparent px-s8 py-s2 font-mono text-mono text-neutral3 hover:text-neutral1"
        >
          The Room — open thread
        </button>
        {market.experimental ? (
          <Text variant="mono" className="text-neutral3">
            15-min tier · experimental
          </Text>
        ) : null}
      </div>
    </section>
  )
}
