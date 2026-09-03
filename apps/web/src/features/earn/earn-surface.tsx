import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  EARN_CATALOG_EMPTY,
  EARN_CATALOG_LOADING,
  EARN_DESCRIPTION,
  EARN_KICKER,
  EARN_NOT_DEPLOYED,
  EARN_TITLE,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShieldDialog } from '@/components/money/shield-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { appContracts } from '@/queries/app'
import { EarnMarketCard } from './market-card'
import { EarnPortfolio } from './portfolio-card'
import { EarnReview } from './earn-review'
import { SupplyForm } from './supply-panel'
import { useEarnShieldDoor } from './use-earn-shield-door'
import { useEarnConfirm } from './use-earn-confirm'
import { useEarnState, type EarnFilter } from './use-earn-state'

const FILTERS: readonly { value: EarnFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'held', label: 'Held' },
]

const AWAY = 'The transaction is away — the pool credits the new note when it accepts it.'

/** The whole Earn surface: portfolio, market rail, one panel, one review. */
export function EarnSurface() {
  const s = useEarnState()
  const confirm = useEarnConfirm()
  const [reviewing, setReviewing] = useState(false)
  const [ticket, setTicket] = useState(false)
  const door = useEarnShieldDoor(s)
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
                  now={s.now}
                  onSupply={() => {
                    s.select(snapshot.market.marketId)
                    confirm.reset()
                    setTicket(true)
                  }}
                />
              ))}
            </div>
          )}

      </section>

      {/* The three-paragraph "what this shows" card is gone: on a board its job is done by the
          cards themselves, and each of those facts is stated where it actually bites — the rate's
          observation time on every card, the redeemable-vs-worth split on the market page beside
          the two numbers, and the no-risk-score line next to the addresses it is about. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-kicker uppercase text-muted-foreground">Who sees what</CardTitle>
        </CardHeader>
        <CardContent>
          <VisibilityMatrixView context="earn" />
        </CardContent>
      </Card>

      {/* The form opens where the click happened, instead of in a column that fell below seven
          cards on every width narrower than a wide desktop. */}
      <Dialog open={ticket} onOpenChange={setTicket}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-display3 uppercase">{s.selected?.market.label ?? 'Market'}</DialogTitle>
            <DialogDescription>{s.selected?.market.curatorLabel ?? 'Vesu V2'}</DialogDescription>
          </DialogHeader>
          <SupplyForm
            s={s}
            shieldDoor={door.door}
            onShield={() => { setTicket(false); door.open() }}
            onReview={() => { setTicket(false); openReview(true) }}
          />
          <Button variant="ghost" size="sm" render={<Link to="/earn/$id" params={{ id: s.selected?.market.marketId ?? '' }} />}>
            See this market’s addresses and full detail
          </Button>
        </DialogContent>
      </Dialog>

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
      <ShieldDialog {...door.dialogProps} />
    </Page>
  )
}
