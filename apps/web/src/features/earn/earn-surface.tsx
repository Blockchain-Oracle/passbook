import { useState } from 'react'
import {
  EARN_CATALOG_EMPTY,
  EARN_CATALOG_LOADING,
  EARN_DESCRIPTION,
  EARN_KICKER,
  EARN_NOT_DEPLOYED,
  EARN_NO_RISK_SCORE,
  EARN_RATE_MOVES,
  EARN_REDEEMABLE_MEANS,
  EARN_TITLE,
  EARN_UTILIZATION_MEANS,
} from '@strk20/protocol/earn-copy'
import { totalValue } from '@strk20/protocol/earn-position'
import { notify } from '@/lib/notify'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { VisibilityMatrixView } from '@/components/privacy/visibility-matrix'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { appContracts } from '@/queries/app'
import { EarnMarketCard } from './market-card'
import { EarnPortfolio } from './portfolio-card'
import { EarnReview } from './earn-review'
import { SupplyPanel } from './supply-panel'
import { useEarnConfirm } from './use-earn-confirm'
import { useEarnState, type EarnFilter } from './use-earn-state'

const FILTERS: readonly { value: EarnFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'held', label: 'Held' },
]

const AWAY = 'The transaction is away — the pool credits the new note when it accepts it.'

/** The whole Earn surface: portfolio, market rail, one panel, one review. */
export function EarnSurface({ market: seed }: { market?: string }) {
  const s = useEarnState(seed)
  const confirm = useEarnConfirm()
  const [reviewing, setReviewing] = useState(false)
  const deployed = Boolean(appContracts().vesuEarn)

  const openReview = (open: boolean) => {
    setReviewing(open)
    if (open) confirm.reset()
  }

  const onConfirm = async () => {
    if (!s.selected || s.parsed.wei === null) return
    const outcome = await confirm.confirm({
      direction: s.tab,
      market: s.selected.market,
      amount: s.parsed.wei,
      expectedOutWei: s.quoteWei ?? 0n,
    })
    if (!outcome.ok) return
    setReviewing(false)
    s.reset()
    notify.settled(s.tab === 'supply' ? `Supplying ${s.selected.market.label}` : `Redeeming ${s.selected.market.label}`, {
      description: AWAY,
      hash: outcome.transactionHash,
    })
  }

  return (
    <Page kicker={EARN_KICKER} title={EARN_TITLE} description={EARN_DESCRIPTION} actions={<BoundaryBadge kind="shieldedRound" />}>
      {/* Up front, once. The catalog below is genuinely live either way, and saying so here means
          no card has to repeat it. */}
      {!deployed ? (
        <Alert>
          <AlertTitle>Not deployed yet</AlertTitle>
          <AlertDescription>{EARN_NOT_DEPLOYED}</AlertDescription>
        </Alert>
      ) : null}

      <EarnPortfolio
        totalWei={totalValue(s.positions)}
        positions={s.positions}
        // Cost basis needs a complete classified history, which this build does not yet
        // reconstruct — so it is `—` and the card says why, rather than showing a number.
        basisWei={null}
        locked={s.locked}
        loading={s.positionsLoading}
      />

      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] @4xl:items-start">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Lending markets">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={s.filter === f.value ? 'default' : 'outline'}
                onClick={() => s.setFilter(f.value)}
                aria-pressed={s.filter === f.value}
              >
                {f.label}
              </Button>
            ))}
          </div>

          {s.catalogLoading ? (
            // One loading treatment for the rail, not a skeleton per figure.
            <div className="grid gap-4 @2xl:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : s.shown.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{s.catalogFailed ? 'The markets could not be read' : 'Nothing to show'}</EmptyTitle>
                <EmptyDescription>
                  {s.catalogFailed ? EARN_CATALOG_LOADING : s.filter === 'all' ? EARN_CATALOG_EMPTY : 'No market matches this filter.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 @2xl:grid-cols-2">
              {s.shown.map((snapshot) => (
                <EarnMarketCard
                  key={snapshot.market.marketId}
                  snapshot={snapshot}
                  position={s.positions.find((p) => p.market.marketId === snapshot.market.marketId)}
                  selected={s.selected?.market.marketId === snapshot.market.marketId}
                  now={s.now}
                  onSelect={() => s.select(snapshot.market.marketId)}
                />
              ))}
            </div>
          )}

          <p className="text-body4 text-muted-foreground">{EARN_UTILIZATION_MEANS}</p>
        </section>

        <aside className="flex min-w-0 flex-col gap-4 @4xl:sticky @4xl:top-4" aria-label="Supply and redeem">
          <SupplyPanel s={s} onReview={() => openReview(true)} />

          <Card>
            <CardHeader>
              <CardTitle className="text-kicker uppercase text-muted-foreground">What this shows</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-body4 text-muted-foreground">
              <p>{EARN_RATE_MOVES}</p>
              <p>{EARN_REDEEMABLE_MEANS}</p>
              <p>{EARN_NO_RISK_SCORE}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-kicker uppercase text-muted-foreground">Who sees what</CardTitle>
            </CardHeader>
            <CardContent>
              <VisibilityMatrixView context="earn" />
            </CardContent>
          </Card>
        </aside>
      </div>

      {s.selected && s.parsed.wei !== null ? (
        <EarnReview
          open={reviewing}
          onOpenChange={openReview}
          tab={s.tab}
          snapshot={s.selected}
          amountWei={s.parsed.wei}
          quoteWei={s.quoteWei}
          feeWei={s.feeWei}
          breakEven={s.breakEven}
          phase={confirm.phase}
          problem={confirm.problem}
          onConfirm={() => void onConfirm()}
        />
      ) : null}
    </Page>
  )
}
