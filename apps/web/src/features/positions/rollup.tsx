//
// The answer to "what can I collect", above the list rather than inside it.
//
// THERE IS NO TOTAL, and that is deliberate. Payouts land in STRK, in a launched token, in a
// House's token; one number over all of them would not be a quantity of anything. So the headline
// counts CLAIMS — which is a real count — and the money is listed per token beside it.
//
import { Amount } from '@/components/money/amount'
import { cn } from '@/lib/utils'

import type { PositionsRead } from './types'

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-kicker uppercase text-neutral3">{label}</span>
      <span className={cn('font-mono text-body1 tabular-nums', muted ? 'text-neutral2' : 'text-neutral1')}>{value}</span>
    </div>
  )
}

export function PositionsRollup({ read }: { read: PositionsRead }) {
  const nothing = read.ready + read.running + read.finished === 0
  return (
    <section
      data-surface="inverted"
      className="flex flex-col gap-5 rounded-xl bg-ground px-5 py-4 text-neutral1 shadow-medium"
      aria-label="Positions summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="text-kicker uppercase text-neutral3">Ready to settle</span>
          <span className="font-display text-display2 tabular-nums leading-none">{read.ready}</span>
          <span className="text-body4 text-neutral2">
            {nothing ? 'Nothing held in this browser' : read.ready === 1 ? 'one claim can be collected now' : `claims can be collected now`}
          </span>
        </div>

        {/* Per token, never added together. An empty list renders nothing rather than a zero. */}
        {read.claimable.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-kicker uppercase text-neutral3">Waiting for you</span>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {read.claimable.map((c) => (
                <span key={c.symbol} className="font-mono text-body1 tabular-nums">
                  <Amount wei={c.wei} decimals={c.decimals} symbol={c.symbol} />
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-surface3 pt-3">
        <Stat label="Still running" value={String(read.running)} muted />
        <Stat label="Finished" value={String(read.finished)} muted />
        <Stat label="Positions" value={String(read.groups.length)} muted />
      </div>
    </section>
  )
}
