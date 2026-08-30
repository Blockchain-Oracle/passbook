//
// What a venue page says about your claims now: one line, and a door to the place that holds them.
//
// Markets, Launch and Houses each used to host a full claims panel, so the same nine rows appeared
// on the venue page AND in the directory, and neither was the answer to "where do I collect". The
// venue's job is the venue. This points at the position and stops.
//
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

import { Amount } from '@/components/money/amount'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'

import type { PositionVenue } from './types'
import { usePositionGroups } from './use-position-groups'

const TICK_MS = 30_000

export interface PositionsStripProps {
  venue: PositionVenue
  /** The market, launch or House this page is about. Omit for a venue index: every group counts. */
  id?: number
  className?: string
}

function keyFor(venue: PositionVenue, id: number): string {
  return venue === 'market' ? `market:${id}` : venue === 'launch' ? `launch:${id}` : `house:${id}`
}

export function PositionsStrip({ venue, id, className }: PositionsStripProps) {
  const now = useNow(TICK_MS)
  const read = usePositionGroups(now)
  const groups = id === undefined ? read.groups.filter((g) => g.venue === venue) : read.groups.filter((g) => g.key === keyFor(venue, id))

  // Nothing held here is not a state worth a card. The venue page simply does not mention it.
  if (read.status !== 'ok' || groups.length === 0) return null

  const claims = groups.reduce((n, g) => n + g.claims.length, 0)
  const ready = groups.reduce((n, g) => n + g.ready, 0)
  const claimable = groups.flatMap((g) => g.claimable)
  const open = groups.length === 1 ? groups[0]!.key : undefined

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-3',
        ready > 0 ? 'border-accent1/40 bg-accent2' : 'bg-card',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body3">
          You hold {claims} claim{claims === 1 ? '' : 's'} here
        </p>
        <p className="text-body4 text-muted-foreground">
          {ready > 0 ? (
            <>
              {ready} ready to settle
              {claimable.length > 0 ? (
                <>
                  {' · '}
                  {claimable.map((c, i) => (
                    <span key={c.symbol}>
                      {i > 0 ? ' + ' : ''}
                      <Amount wei={c.wei} decimals={c.decimals} symbol={c.symbol} size="sm" />
                    </span>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            'None ready to settle yet'
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant={ready > 0 ? 'default' : 'outline'}
        render={<Link to="/positions" search={open ? { open } : {}} />}
        className="shrink-0"
      >
        View positions
        <ArrowRight data-icon="inline-end" aria-hidden />
      </Button>
    </div>
  )
}
