import { EARN_HISTORY_INCOMPLETE, EARN_LOCKED, EARN_NO_POSITION, EARN_POSITION_LOADING } from '@strk20/protocol/earn-copy'
import type { EarnPosition } from '@strk20/protocol/earn-position'

import { Amount } from '@/components/money/amount'
import { cn } from '@/lib/utils'

const USDC_DECIMALS = 6

export interface EarnPortfolioProps {
  /** `null` while unresolved, which is not the same as zero. */
  totalWei: bigint | null
  positions: readonly EarnPosition[]
  /** What the positions cost, or `null` when the history is not complete enough to say. */
  basisWei: bigint | null
  locked: boolean
  loading: boolean
}

/** One market's slice of the total, for the allocation ribbon. */
function share(position: EarnPosition, totalWei: bigint): number {
  if (totalWei <= 0n || position.valueWei === null) return 0
  return Number((position.valueWei * 10_000n) / totalWei) / 100
}

/**
 * The dominant card: what is held, what it cost, and how much of that is knowable.
 *
 * ── THE THREE EMPTY STATES ARE THREE DIFFERENT SENTENCES ──────────────────────────────────
 *
 * "Locked", "nothing here yet" and "still reading" mean completely different things to somebody
 * looking for their money, and collapsing them into one line is how a surface tells a user their
 * position is gone when it is merely not loaded. So each gets its own words and none of them is a
 * zero.
 *
 * There is no sparkline. A defensible one needs a time series of this position's value and no such
 * series exists — drawing a shape from two points would be decoration standing where evidence
 * should be.
 */
export function EarnPortfolio({ totalWei, positions, basisWei, locked, loading }: EarnPortfolioProps) {
  const unrealizedWei = totalWei !== null && basisWei !== null ? totalWei - basisWei : null
  const held = positions.length

  return (
    <section
      data-surface="inverted"
      className="flex flex-col gap-4 rounded-xl bg-ground px-5 py-5 text-neutral1 shadow-medium md:px-6 md:py-6"
      aria-label="Private Earn portfolio"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-kicker uppercase text-neutral2">Private Earn value</p>
        <p className="text-body4 text-neutral2">
          {held === 0 ? '' : held === 1 ? '1 market' : `${held} markets`}
        </p>
      </div>

      {locked ? (
        <p className="text-body2 text-neutral2">{EARN_LOCKED}</p>
      ) : loading ? (
        <p className="text-body2 text-neutral2">{EARN_POSITION_LOADING}</p>
      ) : held === 0 ? (
        <p className="text-body2 text-neutral2">{EARN_NO_POSITION}</p>
      ) : (
        <>
          <p className="font-mono text-display2 tabular-nums md:text-display1">
            <Amount wei={totalWei} decimals={USDC_DECIMALS} symbol="USDC" />
          </p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-surface3 pt-4">
            <div>
              <dt className="text-kicker uppercase text-neutral2">Supplied</dt>
              <dd className="font-mono text-body1 tabular-nums">
                <Amount wei={basisWei} decimals={USDC_DECIMALS} symbol="USDC" />
              </dd>
            </div>
            <div>
              <dt className="text-kicker uppercase text-neutral2">Return</dt>
              <dd
                className={cn(
                  'font-mono text-body1 tabular-nums',
                  unrealizedWei !== null && unrealizedWei > 0n && 'text-settled',
                  unrealizedWei !== null && unrealizedWei < 0n && 'text-irreversible',
                )}
              >
                {unrealizedWei === null ? (
                  '—'
                ) : (
                  <>
                    {unrealizedWei > 0n ? '+' : ''}
                    <Amount wei={unrealizedWei} decimals={USDC_DECIMALS} symbol="USDC" />
                  </>
                )}
              </dd>
            </div>
          </dl>

          {/* The ribbon is only drawn when a total exists to take a proportion OF. */}
          {totalWei !== null && totalWei > 0n ? (
            <div className="flex h-1.5 overflow-hidden rounded-pill bg-inset" role="presentation">
              {positions.map((position, index) => (
                <span
                  key={position.market.marketId}
                  className={cn('h-full', index % 2 === 0 ? 'bg-accent1' : 'bg-accent3')}
                  style={{ width: `${share(position, totalWei)}%` }}
                />
              ))}
            </div>
          ) : null}

          {basisWei === null ? <p className="text-body4 text-neutral2">{EARN_HISTORY_INCOMPLETE}</p> : null}
        </>
      )}
    </section>
  )
}
