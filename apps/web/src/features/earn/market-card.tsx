import { Link } from '@tanstack/react-router'
import { AlertTriangle, PauseCircle, Wallet } from 'lucide-react'
import type { EarnMarketSnapshot } from '@strk20/protocol/earn-reads'
import type { EarnPosition } from '@strk20/protocol/earn-position'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

/** A rate as a percentage, or an em dash. Never `0%` for a read that did not happen. */
export function ratePercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`
}

/** How long ago, in words a card can carry. Rates move, so every one of them says when. */
export function observedAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

/** The one badge that says whether this market can be used, in its own words. */
function StatusBadge({ snapshot }: { snapshot: EarnMarketSnapshot }) {
  if (!snapshot.validated) {
    return (
      <Badge variant="outline" className="border-irreversible/40 text-irreversible">
        <AlertTriangle className="size-3" aria-hidden /> Unverified
      </Badge>
    )
  }
  if (snapshot.paused) {
    return (
      <Badge variant="outline" className="border-exposed/40 text-exposed">
        <PauseCircle className="size-3" aria-hidden /> Paused
      </Badge>
    )
  }
  if (snapshot.blocker?.kind === 'unreadable') {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Figures unavailable
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-settled/40 text-settled">
      Available
    </Badge>
  )
}

export interface EarnMarketCardProps {
  snapshot: EarnMarketSnapshot
  position: EarnPosition | undefined
  now: number
  /** Opens the supply form for this market, right here, without leaving the list. */
  onSupply: () => void
}

/**
 * One market, always visible whatever state it is in.
 *
 * A market that cannot be transacted with is shown with its real status rather than hidden: a
 * catalog that quietly drops the paused one teaches the reader that everything they can see is
 * fine, which is the opposite of what this surface is for.
 */
export function EarnMarketCard({ snapshot, position, now, onSupply }: EarnMarketCardProps) {
  const { market } = snapshot
  const used = snapshot.utilization
  // A paused or unverified market can still be REDEEMED from, so a held position keeps its door.
  const canSupply = (snapshot.validated && !snapshot.paused && snapshot.blocker === null) || position !== undefined
  return (
    <Card className={cn('flex flex-col gap-0 transition-colors hover:border-accent1/40', !snapshot.validated && 'opacity-90')}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="wrap-break-word font-display text-display4 uppercase">{market.label}</CardTitle>
            <p className="text-body4 text-muted-foreground">{market.curatorLabel ?? 'Vesu V2'}</p>
          </div>
          <StatusBadge snapshot={snapshot} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-kicker uppercase text-muted-foreground">Supply rate</p>
            <p className="font-mono text-display4 tabular-nums">{ratePercent(snapshot.apy)}</p>
            <p className="text-body4 text-muted-foreground">
              {snapshot.apy === null ? 'not readable' : `read ${observedAgo(snapshot.observedAt, now)}`}
            </p>
          </div>
          <div>
            <p className="text-kicker uppercase text-muted-foreground">Available now</p>
            <p className="font-mono text-display4 tabular-nums">
              <Amount wei={snapshot.reserveWei} decimals={market.underlyingDecimals} short />
            </p>
            <p className="text-body4 text-muted-foreground">USDC unborrowed</p>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-body4">
            <span className="text-muted-foreground">Utilization</span>
            <span className="font-mono tabular-nums">{ratePercent(used)}</span>
          </div>
          {/* `null` renders an empty track rather than a full or zero bar: a meter is a claim. */}
          <Progress value={used === null ? 0 : Math.min(100, used * 100)} className={cn(used === null && 'opacity-40')} />
        </div>

        {position ? (
          <div className="flex items-center gap-2 rounded-lg border border-shieldedEdge bg-shieldedTint px-3 py-2 text-body4">
            <Wallet className="size-3.5 shrink-0 text-shielded" aria-hidden />
            <span className="min-w-0">
              You hold <Amount wei={position.valueWei} decimals={market.underlyingDecimals} symbol="USDC" />
            </span>
          </div>
        ) : null}

        {/* Two doors, and each one goes where its label says. "View market" used to only change a
            selection somewhere else on the page, which is the kind of button that teaches people
            the app is broken. */}
        <div className="mt-auto grid grid-cols-2 gap-2">
          <Button variant="outline" render={<Link to="/earn/$id" params={{ id: market.marketId }} />}>
            Details
          </Button>
          <Button onClick={onSupply} aria-disabled={!canSupply || undefined}>
            {position ? 'Manage' : 'Supply'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
