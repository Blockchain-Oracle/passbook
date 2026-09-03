import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { EARN_NO_RISK_SCORE, EARN_RATE_MOVES, EARN_REDEEMABLE_MEANS, EARN_UTILIZATION_MEANS } from '@strk20/protocol/earn-copy'
import { marketById } from '@strk20/protocol/earn-markets'
import { useState } from 'react'

import { Page } from '@/components/layout/page'
import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { ShieldDialog } from '@/components/money/shield-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerAddress, shortAddress } from '@/lib/format'
import { appContracts } from '@/queries/app'
import { EarnReview } from './earn-review'
import { observedAgo, ratePercent } from './market-card'
import { SupplyPanel } from './supply-panel'
import { useEarnConfirm } from './use-earn-confirm'
import { useEarnShieldDoor } from './use-earn-shield-door'
import { useEarnState } from './use-earn-state'

const USDC_DECIMALS = 6

/** A contract, named and linkable. Every address on this page is one somebody can go and check. */
function OnChain({ label, address, note }: { label: string; address: string | undefined; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        {address ? (
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-mono text-accent1"
          >
            {shortAddress(address)}
            <ArrowUpRight className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="font-mono text-mono text-muted-foreground">—</span>
        )}
        {note ? <p className="text-body4 text-muted-foreground">{note}</p> : null}
      </dd>
    </div>
  )
}

/**
 * One market's own page.
 *
 * It exists because the board could not answer "what IS this market" — the card had a button
 * reading "View market" that only changed a selection, and there was nowhere to go and read the
 * addresses, so nothing on the surface could be checked against the chain. Markets and Launch both
 * have a detail route; this is Earn's, built the same way.
 */
export function EarnMarketDetail({ id }: { id: string }) {
  const definition = marketById(id)
  const s = useEarnState(id)
  const confirm = useEarnConfirm()
  const [reviewing, setReviewing] = useState(false)
  const door = useEarnShieldDoor(s)
  const snapshot = s.catalog.find((row) => row.market.marketId === id) ?? null

  if (!definition) {
    return (
      <Page kicker="Money" title="Market" description="">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No such market</EmptyTitle>
            <EmptyDescription>
              This build does not know a lending market by that name. <Link to="/earn" className="text-accent1">Back to Earn</Link>.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  }

  const onConfirm = async () => {
    if (!snapshot || s.parsed.wei === null) return
    const outcome = await confirm.confirm({
      direction: s.tab,
      market: definition,
      amount: s.parsed.wei,
      expectedOutWei: s.quoteWei ?? 0n,
    })
    if (outcome.ok) {
      setReviewing(false)
      s.reset()
    }
  }

  return (
    <Page
      kicker="Lending market"
      title={definition.label}
      description={definition.curatorLabel ? `Curated by ${definition.curatorLabel} on Vesu V2.` : 'A Vesu V2 USDC market.'}
      actions={<BoundaryBadge kind="shieldedRound" />}
    >
      <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/earn" />}>
        <ArrowLeft data-icon="inline-start" aria-hidden />
        All markets
      </Button>

      {/* One flat grid with explicit order, so the form sits SECOND on a phone — right under the
          rate, above the position and the addresses — instead of last. On a wide screen it moves
          into its own sticky column and the reading order goes back to left-then-right. Rendering
          it twice to achieve that would be two forms that drift. */}
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @3xl:items-start">
        <div className="order-1 flex min-w-0 flex-col gap-6 @3xl:col-start-1">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-display4 uppercase">What it is paying</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {s.catalogLoading ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 @lg:grid-cols-3">
                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">Supply rate</p>
                      <p className="font-mono text-display3 tabular-nums">{ratePercent(snapshot?.apy ?? null)}</p>
                      <p className="text-body4 text-muted-foreground">
                        {snapshot ? `read ${observedAgo(snapshot.observedAt, s.now)}` : 'not read'}
                      </p>
                    </div>
                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">Available now</p>
                      <p className="font-mono text-display3 tabular-nums">
                        <Amount wei={snapshot?.reserveWei ?? null} decimals={USDC_DECIMALS} short />
                      </p>
                      <p className="text-body4 text-muted-foreground">USDC unborrowed</p>
                    </div>
                    <div>
                      <p className="text-kicker uppercase text-muted-foreground">Share price</p>
                      <p className="font-mono text-display3 tabular-nums">
                        <Amount wei={snapshot?.sharePriceWei ?? null} decimals={USDC_DECIMALS} />
                      </p>
                      <p className="text-body4 text-muted-foreground">USDC per share</p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-body4">
                      <span className="text-muted-foreground">Utilization</span>
                      <span className="font-mono tabular-nums">{ratePercent(snapshot?.utilization ?? null)}</span>
                    </div>
                    <Progress value={snapshot?.utilization === undefined || snapshot?.utilization === null ? 0 : Math.min(100, snapshot.utilization * 100)} />
                    <p className="mt-2 text-body4 text-muted-foreground">{EARN_UTILIZATION_MEANS}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>

        <aside className="order-2 flex min-w-0 flex-col gap-4 @3xl:order-none @3xl:col-start-2 @3xl:row-span-3 @3xl:sticky @3xl:top-4" aria-label="Supply and redeem">
          <SupplyPanel
            s={s}
            shieldDoor={door.door}
            onShield={door.open}
            onReview={() => { confirm.reset(); setReviewing(true) }}
          />
        </aside>

        <div className="order-3 flex min-w-0 flex-col gap-6 @3xl:col-start-1">
          {s.position ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-display4 uppercase">What you hold here</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-body3">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Value</dt>
                    <dd className="font-mono tabular-nums">
                      <Amount wei={s.position.valueWei} decimals={USDC_DECIMALS} symbol="USDC" />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Shares</dt>
                    <dd className="font-mono tabular-nums">
                      <Amount wei={s.position.sharesWei} decimals={definition.shareDecimals} />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Redeemable now</dt>
                    <dd className="font-mono tabular-nums">
                      <Amount wei={s.position.redeemable?.wei ?? null} decimals={USDC_DECIMALS} symbol="USDC" />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Held as</dt>
                    <dd className="font-mono tabular-nums">
                      {s.position.noteCount} private note{s.position.noteCount === 1 ? '' : 's'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-body4 text-muted-foreground">{EARN_REDEEMABLE_MEANS}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-display4 uppercase">On chain</CardTitle>
            </CardHeader>
            <CardContent>
              {/* The whole point of the page: every address a reader could want to check, linked. */}
              <dl className="flex flex-col gap-3 text-body3">
                <OnChain label="vToken" address={definition.vToken} note="The share token, and the ERC-4626 vault" />
                <OnChain label="Vesu pool" address={definition.pool} note="Where the rate and liquidity are read" />
                <OnChain label="USDC" address={definition.underlying} note="What this market lends" />
                <OnChain label="Our helper" address={appContracts().vesuEarn} note="Pool-only; holds nothing between transactions" />
              </dl>
              <p className="mt-3 text-body4 text-muted-foreground">{EARN_RATE_MOVES}</p>
              <p className="mt-2 text-body4 text-muted-foreground">{EARN_NO_RISK_SCORE}</p>
              <a
                href={definition.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-body4 text-accent1"
              >
                This market on Vesu
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </CardContent>
          </Card>
        </div>
      </div>

      {snapshot && s.parsed.wei !== null ? (
        <EarnReview
          open={reviewing}
          onOpenChange={(open) => { setReviewing(open); if (open) confirm.reset() }}
          tab={s.tab}
          snapshot={snapshot}
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
