import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Clock } from 'lucide-react'
import { UNITS_PER_EPOCH, currentEpoch, raiseTarget, soldPct, timeLeft, unitPriceAt, type OnChainLaunch } from '@strk20/protocol/app-reads'

import { Amount } from '@/components/money/amount'
import { TokenLogo, accentFor } from '@/components/money/asset-identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { PHASE_CHIP, PHASE_SENTENCE, phaseOf, type Phase } from './phase'
import { useStakeToken } from './queries'

const PHASE_TONE: Record<Phase, string> = {
  selling: 'border-shieldedEdge bg-shieldedTint text-shielded',
  'sold-out': 'border-settled bg-settledTint text-settled',
  graduated: 'border-settled bg-settledTint text-settled',
  failed: 'border-exposed bg-exposedTint text-exposed',
  missed: 'border-exposed bg-exposedTint text-exposed',
}

export function PhaseChip({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <Badge variant="outline" className={cn('uppercase text-navLabel', PHASE_TONE[phase], className)}>
      {PHASE_CHIP[phase]}
    </Badge>
  )
}

/** One launch: the mark, the epoch price, the fill, and the door to its own page. */
export function LaunchCard({ launch, now, onBuy }: { launch: OnChainLaunch; now: number; onBuy?: () => void }) {
  const stake = useStakeToken(launch.stakeToken)
  const phase = phaseOf(launch, now)
  const epoch = currentEpoch(launch)
  const pct = soldPct(launch)
  const target = raiseTarget(launch)
  const accent = accentFor(launch.name || launch.symbol)
  const title = launch.name || `Launch ${launch.id}`

  return (
    <Card
      className="group relative overflow-hidden"
      // The identity glow: the token's own seed colour, whisper-quiet — the declared off-token exception.
      style={{ backgroundImage: `radial-gradient(130% 90% at 0% 0%, ${accent}33, transparent 55%)` }}
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <TokenLogo logoUri={launch.logoUri} symbol={launch.symbol} name={launch.name} size={40} />
        <div className="min-w-0 flex-1">
          <Link to="/launch/$id" params={{ id: String(launch.id) }} preload="intent" className="block truncate text-body2 font-medium group-hover:underline">
            {title}
          </Link>
          <p className="font-mono text-mono text-muted-foreground">
            {launch.symbol} · Epoch {epoch + 1} of {launch.epochs}
          </p>
        </div>
        <PhaseChip phase={phase} className="shrink-0" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Amount wei={unitPriceAt(launch, epoch)} decimals={stake.decimals} symbol={stake.symbol} size="lg" />
          <span className="text-body4 text-muted-foreground">per unit, this epoch</span>
        </div>
        <Progress value={pct} aria-label={`${pct}% of units sold`} />
        <div className="flex flex-wrap justify-between gap-x-3 font-mono text-mono text-muted-foreground">
          <span>
            {launch.sold} of {launch.epochs * UNITS_PER_EPOCH} units · {pct}%
          </span>
          <span className="inline-flex items-center gap-1">
            <Amount wei={target} decimals={stake.decimals} symbol={stake.symbol} size="sm" short /> target
          </span>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        {phase === 'selling' ? (
          <>
            <span className="inline-flex items-center gap-1 text-body4 text-muted-foreground">
              <Clock className="size-3.5" aria-hidden /> Closes in {timeLeft(launch.deadline, now)}
            </span>
            {onBuy ? (
              <Button size="sm" onClick={onBuy}>
                Buy this epoch
              </Button>
            ) : (
              <Button size="sm" variant="outline" render={<Link to="/launch/$id" params={{ id: String(launch.id) }} />}>
                Open <ArrowUpRight data-icon="inline-end" />
              </Button>
            )}
          </>
        ) : (
          <p className={cn('text-body4', phase === 'graduated' ? 'text-settled' : 'text-muted-foreground')}>{PHASE_SENTENCE[phase]}</p>
        )}
      </CardFooter>
    </Card>
  )
}
