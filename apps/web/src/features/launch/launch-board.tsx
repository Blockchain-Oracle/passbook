import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Plus, Radio, Rocket } from 'lucide-react'
import { currentEpoch, type OnChainLaunch } from '@strk20/protocol/app-reads'
import { LAUNCH_BUYER_HIDDEN, LAUNCH_EPOCH_FACT, LAUNCH_GRADUATION, LAUNCH_NONE_OPEN, LAUNCH_NOT_DEPLOYED, LAUNCH_REFUND, LAUNCH_STANDING_LINE } from '@strk20/protocol/markets-copy'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Page } from '@/components/layout/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { appContracts } from '@/queries'
import { storedPositionsQuery } from '@/queries/positions'
import { BuyPanel } from './buy-panel'
import { CreateLaunchDialog } from './create-launch-dialog'
import { LaunchCard } from './launch-card'
import { LAUNCH_CLOCK_MS, phaseOf } from './phase'
import { useLaunchBoard } from './queries'

function HeldPositions({ launches }: { launches: readonly OnChainLaunch[] }) {
  const stored = useQuery(storedPositionsQuery())
  if (stored.data?.state === 'corrupt') {
    return (
      <Alert>
        <AlertDescription>{stored.data.because}</AlertDescription>
      </Alert>
    )
  }
  const positions = stored.data?.state === 'ok' ? stored.data.positions.filter((p) => p.venue === 'launch') : []
  if (positions.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-kicker uppercase text-muted-foreground">Your positions</CardTitle>
        <CardDescription>Each is a bearer secret this browser keeps — it rides the recovery backup with your notes.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-1">
          {positions.map((p) => {
            const launch = launches.find((l) => l.id === p.id)
            return (
              <Item key={p.commitment} size="sm" render={launch ? <Link to="/launch/$id" params={{ id: String(launch.id) }} /> : <div />}>
                <ItemContent>
                  <ItemTitle>{p.label ?? `Launch ${p.id}`}</ItemTitle>
                  <ItemDescription className="font-mono text-mono">{launch ? `${launch.name || launch.symbol} · open the launch to settle` : p.id === -1 ? 'Creator claim' : `Launch ${p.id}`}</ItemDescription>
                </ItemContent>
                {launch ? <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden /> : null}
              </Item>
            )
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

export function LaunchBoard() {
  const board = useLaunchBoard()
  const now = useNow(LAUNCH_CLOCK_MS)
  const deployed = Boolean(appContracts().launch)
  const [creating, setCreating] = useState(false)
  const [buying, setBuying] = useState<OnChainLaunch | null>(null)

  const open = board.launches.filter((l) => phaseOf(l, now) === 'selling')
  const settled = board.launches.filter((l) => phaseOf(l, now) !== 'selling')

  return (
    <Page
      kicker="Venues"
      title="Launch"
      description={LAUNCH_STANDING_LINE}
      actions={
        <>
          {board.live ? (
            <Badge variant="outline" className="gap-1 text-navLabel uppercase text-settled">
              <Radio className="size-3" aria-hidden /> Live
            </Badge>
          ) : null}
          <BoundaryBadge kind="bearer" />
          <Button onClick={() => (deployed ? setCreating(true) : undefined)} aria-disabled={!deployed || undefined}>
            <Plus data-icon="inline-start" /> Create
          </Button>
        </>
      }
    >
      {!deployed ? (
        <Alert>
          <AlertDescription>{LAUNCH_NOT_DEPLOYED}</AlertDescription>
        </Alert>
      ) : null}
      {board.problem ? (
        <Alert>
          <AlertDescription>{board.problem}</AlertDescription>
        </Alert>
      ) : null}

      {board.loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : board.launches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Rocket />
            </EmptyMedia>
            <EmptyTitle>No launches yet</EmptyTitle>
            <EmptyDescription>{LAUNCH_NONE_OPEN}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {open.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-kicker uppercase text-muted-foreground">Selling now</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {open.map((launch) => (
                  <LaunchCard key={launch.id} launch={launch} now={now} onBuy={() => setBuying(launch)} />
                ))}
              </div>
            </section>
          ) : (
            <p className="text-body3 text-muted-foreground">{LAUNCH_NONE_OPEN}</p>
          )}
          {settled.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-kicker uppercase text-muted-foreground">Graduated and closed</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {settled.map((launch) => (
                  <LaunchCard key={launch.id} launch={launch} now={now} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <HeldPositions launches={board.launches} />

      <footer className="grid gap-2 text-body4 text-muted-foreground md:grid-cols-3">
        <p>{LAUNCH_EPOCH_FACT}</p>
        <p>{LAUNCH_BUYER_HIDDEN}</p>
        <p>
          {LAUNCH_GRADUATION} {LAUNCH_REFUND}
        </p>
      </footer>

      <CreateLaunchDialog open={creating} onOpenChange={setCreating} />
      <Dialog open={buying !== null} onOpenChange={(next) => (next ? undefined : setBuying(null))}>
        <DialogContent className="sm:max-w-md">
          {buying ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-display3 uppercase">Buy {buying.name || buying.symbol}</DialogTitle>
                <DialogDescription>
                  Epoch {currentEpoch(buying) + 1} of {buying.epochs} — same price for everyone inside it.
                </DialogDescription>
              </DialogHeader>
              <BuyPanel launch={buying} onDone={() => setBuying(null)} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  )
}
