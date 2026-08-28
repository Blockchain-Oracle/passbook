//
// The live price strip — the top of the Markets surface, and the part of it that is real today.
//
// ── THE NUMBER IS SPRUNG, AND THAT IS INFORMATION RATHER THAN DECORATION ─────────────────
//
// The price travels to its new value rather than snapping, and the spring's own speed drives the
// dot's glow — so "how fast is this moving" is answered by the motion itself. A flat market costs
// zero animation frames, because a settled spring stops scheduling entirely.
//
// ── AND A STALE PRICE LOOKS STALE ────────────────────────────────────────────────────────
//
// Measured rather than assumed: the day-0 checks watched this feed hold one value for eleven
// minutes, and a live read taken while building this surface came back 342 seconds old. A strip
// that always renders a bright number would be claiming an immediacy the oracle does not have, so
// past the threshold the row dims and says so in words.
//
import {
  PRICE_STALE,
  PRICE_STRIP_SOURCE,
} from '@strk20/protocol/markets-copy'
// The PURE module: this component formats a number and decides whether it looks stale, and must
// not pull `starknet` into its chunk to do it. `pragma-pairs.ts`'s header carries the argument.
import { formatPrice, isStale, type PragmaPair } from '@strk20/protocol/pragma-pairs'

import { cn } from '../lib/cn'
import { usePriceFollow } from '../lib/spring'
import { priceOf, type PragmaState } from '../shell/use-pragma'
import { Skeleton } from './ui/skeleton'
import { Sparkline } from './PriceChart'
import { Text } from './Text'

export interface PriceStripProps {
  state: PragmaState
  /** The pair whose chart is on screen, so the strip can say which row it belongs to. */
  selected?: PragmaPair | null
  onSelect?: (pair: PragmaPair) => void
  pairs: readonly PragmaPair[]
}

export function PriceStrip({ state, selected, onSelect, pairs }: PriceStripProps) {
  return (
    <section className="flex flex-col gap-s8">
      <div className="grid gap-s8 sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((pair) => (
          <PriceCell
            key={pair}
            pair={pair}
            state={state}
            selected={selected === pair}
            onSelect={onSelect}
          />
        ))}
      </div>
      <Text variant="body4" className="text-neutral3">
        {PRICE_STRIP_SOURCE}
      </Text>
    </section>
  )
}

function PriceCell({
  pair,
  state,
  selected,
  onSelect,
}: {
  pair: PragmaPair
  state: PragmaState
  selected: boolean
  onSelect?: (pair: PragmaPair) => void
}) {
  const price = priceOf(state, pair)
  const raw = state.series[pair]?.points ?? []
  // One reading still draws the shape — a flat run — instead of an empty corner. Same move the
  // main chart makes, for the same reason: the first paint should already look like the product.
  const series = raw.length === 1 ? [raw[0]!, raw[0]!] : raw

  if (state.loading && price === null) {
    return (
      <div className="rounded-large border border-solid border-surface3 p-s12">
        <Skeleton className="flex flex-col gap-s8">
          <Skeleton className="h-s16 w-[40%]" />
          <Skeleton className="h-s28 w-[70%]" />
        </Skeleton>
      </div>
    )
  }

  if (price === null) {
    const failure = state.readings.find((r) => !r.ok && r.pair === pair)
    return (
      <div className="rounded-large border border-solid border-surface3 p-s12">
        <Text variant="body4" className="text-neutral2">
          {pair}
        </Text>
        {/* An em dash, never a zero: `balances.ts`'s rule, and a "$0.00" beside BTC is the most
            alarming way to render a failed read. */}
        <Text variant="subheading1" className="numeric text-neutral3">
          —
        </Text>
        <Text variant="body4" className="text-exposed">
          {failure && !failure.ok ? 'This pair could not be read.' : 'No price yet.'}
        </Text>
      </div>
    )
  }

  const stale = isStale(price, Date.now())
  const Element = onSelect ? 'button' : 'div'

  return (
    <Element
      {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(pair) } : {})}
      aria-pressed={onSelect ? selected : undefined}
      className={cn(
        'flex flex-col gap-s4 rounded-large border border-solid p-s12 text-left',
        'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
        selected ? 'border-accent1 bg-accent2' : 'border-surface3',
        onSelect ? 'cursor-pointer hover:bg-inset' : '',
      )}
    >
      <span className="flex items-center justify-between gap-s8">
        <Text variant="body4" className="text-neutral2">
          {pair}
        </Text>
        <Sparkline series={series} colour={stale ? '--color-neutral3' : '--color-settled'} />
      </span>

      <SprungPrice pair={pair} price={price.price} stale={stale} sources={price.sources} />
    </Element>
  )
}

/**
 * The number, sprung — and it only exists once there IS a number.
 *
 * ── THE SEED IS THE BUG THIS COMPONENT EXISTS TO FIX ─────────────────────────────────────
 *
 * `useSpring` seeds its state from the target on its FIRST render, which is what makes a price
 * appear at its real value instead of animating up from nothing. Calling it in the parent meant
 * seeding it with the `0` that stood in before the first reading landed — so every cold load
 * rendered `$0.00000` and swept up to eighty thousand, which is both theatre and, for a couple of
 * hundred milliseconds, a wrong price on screen. It is also exactly what the parent's own
 * `—`-never-a-zero rule forbids.
 *
 * Splitting the sprung part into its own component is the fix: it mounts for the first time when a
 * real price exists, so the seed is that price and the first paint is correct. It also means a
 * pair whose read FAILED runs no spring at all, rather than animating an invisible number to zero.
 */
function SprungPrice({
  pair,
  price,
  stale,
  sources,
}: {
  pair: PragmaPair
  price: number
  stale: boolean
  sources: number
}) {
  //
  // THE SCALE IS THE PAIR'S OWN MAGNITUDE, as a fraction of the price rather than a constant: 40
  // units-per-second is a hard move for BTC at $80,000 and physically impossible for STRK at
  // $0.027, so one constant would pin two of the three rows at full glow forever. No floor, for
  // the same reason — a floor of 0.001 is larger than STRK's entire plausible velocity range and
  // reintroduces the saturation it was meant to prevent.
  //
  const follow = usePriceFollow(price, Math.abs(price) * 0.0004)

  return (
    <>
      <span className="flex items-baseline gap-s6">
        <span aria-hidden="true" className={cn('text-body4', stale ? 'text-neutral3' : 'text-neutral2')}>
          $
        </span>
        {/*
          `numeric` is the tabular-figures class. Without it the digits change width as the price
          moves and the row jitters on every tick — which on a sprung number is constant.

          The SPRING value is rendered, not the raw reading: that is what makes the number travel
          to its new value instead of snapping, and the spring's own clamp guarantees it lands
          exactly on the real price rather than ringing past it.
        */}
        <span
          className={cn(
            // The machine voice [STUDIO]: money is Space Mono, always.
            'numeric font-mono text-heading3 tabular-nums',
            stale ? 'text-neutral3' : 'text-neutral1',
          )}
          // The accessible value is the REAL reading, never the in-flight spring value: a screen
          // reader must not be handed a number that was true for 16 milliseconds.
          aria-label={`${pair} ${formatPrice(price)}`}
        >
          {/*
            Formatted against the REAL price, not the sprung one: `formatPrice` picks its decimal
            count from the magnitude, so formatting the in-flight value changes the digit count
            mid-travel (5 → 3 → 2) and defeats the tabular figures it is paired with.
          */}
          {follow.value.toLocaleString('en-US', {
            minimumFractionDigits: decimalsFor(price),
            maximumFractionDigits: decimalsFor(price),
          })}
        </span>
      </span>

      <span className="flex items-center gap-s6">
        <span
          aria-hidden="true"
          className={cn('size-s6 rounded-pill', stale ? 'bg-exposed' : 'bg-settled')}
          // The glow tracks the spring's own speed, so a fast move brightens the dot and a quiet
          // market leaves it flat. Purely additive: the colour already carries the state.
          style={stale ? undefined : { opacity: 0.55 + follow.intensity * 0.45 }}
        />
        <Text variant="body4" className={stale ? 'text-exposed' : 'text-neutral3'}>
          {stale ? PRICE_STALE : `${sources} sources`}
        </Text>
      </span>
    </>
  )
}

/** The same thresholds `formatPrice` uses, pinned to the settled value so the width cannot shift. */
function decimalsFor(price: number): number {
  return price >= 1000 ? 2 : price >= 1 ? 3 : 5
}
