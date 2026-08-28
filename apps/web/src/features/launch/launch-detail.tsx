// The launch page: the staircase and the numbers on the left, the buy panel mounted beside them on
// the right (the action panel lives next to the thing it acts on, never behind a second click).
import { Suspense, lazy } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { UNITS_PER_EPOCH, currentEpoch, raiseTarget, soldPct, timeLeft, unitPriceAt } from '@strk20/protocol/app-reads'
import { launchTalkTag } from '@strk20/protocol/open-room-tags'

import { Page } from '@/components/layout/page'
import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { TokenLogo } from '@/components/money/asset-identity'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNow } from '@/hooks/use-now'
import { explorerAddress } from '@/lib/format'
import { BuyPanel } from './buy-panel'
import { PhaseChip } from './launch-card'
import { LAUNCH_CLOCK_MS, PHASE_SENTENCE, phaseOf } from './phase'
import { PositionsPanel } from './positions-panel'
import { useLaunch, useStakeToken } from './queries'
import { TalkThread } from './talk-thread'

const StaircaseChart = lazy(() => import('./staircase-chart'))

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-kicker uppercase text-muted-foreground">{label}</dt>
      <dd className="font-mono text-body2 tabular-nums">{children}</dd>
    </div>
  )
}

export function LaunchDetail({ id }: { id: number }) {
  const { launch, loading } = useLaunch(id)
  const stake = useStakeToken(launch?.stakeToken ?? '0x0')
  const now = useNow(LAUNCH_CLOCK_MS)

  if (!launch) {
    return (
      <Page kicker="Launch" title={loading ? 'Reading' : 'Not found'}>
        {loading ? (
          <Skeleton className="h-64" />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No launch #{id}</EmptyTitle>
              <EmptyDescription>Nothing on the Launch contract answers to that id.</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" render={<Link to="/launch" />}>
              <ArrowLeft data-icon="inline-start" /> Back to the board
            </Button>
          </Empty>
        )}
      </Page>
    )
  }

  const phase = phaseOf(launch, now)
  const epoch = currentEpoch(launch)
  const pct = soldPct(launch)
  const title = launch.name || `Launch ${launch.id}`
  const graduatedToken = launch.token !== '0x0' && BigInt(launch.token) !== 0n

  return (
    <Page
      kicker="Launch"
      title={title}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <TokenLogo logoUri={launch.logoUri} symbol={launch.symbol} name={launch.name} size={24} />
          <span className="font-mono">{launch.symbol}</span>
          <PhaseChip phase={phase} />
          {phase === 'selling' ? <span>Closes in {timeLeft(launch.deadline, now)}</span> : null}
        </span>
      }
      actions={
        <>
          <BoundaryBadge kind="bearer" />
          <Button variant="ghost" size="sm" render={<Link to="/launch" />}>
            <ArrowLeft data-icon="inline-start" /> Board
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-kicker uppercase text-muted-foreground">The staircase</CardTitle>
              <CardDescription>
                Flat within an epoch, a step between them. Epoch {epoch + 1} of {launch.epochs} is selling at{' '}
                <Amount wei={unitPriceAt(launch, epoch)} decimals={stake.decimals} symbol={stake.symbol} size="sm" /> per unit.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Suspense fallback={<Skeleton className="h-44 w-full" />}>
                <StaircaseChart launch={launch} decimals={stake.decimals} symbol={stake.symbol} at={epoch} />
              </Suspense>
              <Progress value={pct} aria-label={`${pct}% of units sold`} />
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Sold">
                  {launch.sold} / {launch.epochs * UNITS_PER_EPOCH} units
                </Stat>
                <Stat label="Raised">
                  <Amount wei={launch.raised} decimals={stake.decimals} symbol={stake.symbol} size="md" />
                </Stat>
                <Stat label="Target">
                  <Amount wei={raiseTarget(launch)} decimals={stake.decimals} symbol={stake.symbol} size="md" />
                </Stat>
                <Stat label="Per unit">
                  <Amount wei={launch.unitTokens} decimals={18} symbol={launch.symbol} size="md" />
                </Stat>
              </dl>
            </CardContent>
          </Card>

          <Tabs defaultValue="talk">
            <TabsList variant="line">
              <TabsTrigger value="talk">Talk</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>
            <TabsContent value="talk" className="pt-4">
              <TalkThread tag={launchTalkTag(launch.id)} emptyLine="Nobody has said anything about this launch yet." />
            </TabsContent>
            <TabsContent value="about" className="flex flex-col gap-2 pt-4 text-body3 text-muted-foreground">
              <p>
                Stake token: <span className="font-mono">{stake.symbol}</span>. Sixteen units per epoch; each unit is a sixteenth of an epoch’s tokens.
              </p>
              {graduatedToken ? (
                <a href={explorerAddress(launch.token)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent1">
                  The deployed token <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              ) : (
                <p>The token deploys at graduation. Until then, a unit is a claim on its share.</p>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <aside className="flex flex-col gap-6">
          {phase === 'selling' ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-display4 uppercase">Buy this epoch</CardTitle>
              </CardHeader>
              <CardContent>
                <BuyPanel launch={launch} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-body3">{PHASE_SENTENCE[phase]}</CardContent>
            </Card>
          )}
          <PositionsPanel launch={launch} />
        </aside>
      </div>
    </Page>
  )
}
