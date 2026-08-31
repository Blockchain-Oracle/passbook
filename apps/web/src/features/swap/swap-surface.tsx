import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '@/lib/notify'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { ShieldDialog } from '@/components/money/shield-dialog'
import { VisibilityMatrixView } from '@/components/privacy/visibility-matrix'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatWei } from '@/lib/format'
import { poolConstantsQuery } from '@/queries/pool'
import { QuoteDetails } from './quote-details'
import { useShieldDoor } from './shield-door'
import { routeLabel } from './sides'
import { BuyCard, FlipButton, SellCard } from './swap-cards'
import { SwapOutcome, type SwapReceiptData } from './swap-outcome'
import { SwapReview } from './swap-review'
import { useSwapConfirm } from './use-swap-confirm'
import { useSwapState, type SwapSeed } from './use-swap-state'

const SWAP_DESCRIPTION =
  'Trade one shielded balance for another. The bought token comes back to you as a new shielded note in the same transaction.'
const SWAP_AWAY = 'The batch is away — the pool credits the bought token when it accepts it.'

/** The whole swap surface: two cards, a quote, one review, one pipeline, one receipt. */
export function SwapSurface({ seed }: { seed?: SwapSeed }) {
  const s = useSwapState(seed)
  const confirm = useSwapConfirm()
  const [reviewing, setReviewing] = useState(false)
  const [receipt, setReceipt] = useState<SwapReceiptData | null>(null)
  // Live fee, read at call time — never a constant. Only asked for once a price is on screen.
  const fee = useQuery({ ...poolConstantsQuery(), enabled: s.quoted !== null })
  const door = useShieldDoor({ sell: s.sell, shortfallWei: s.shortfallWei, address: s.address })

  const openReview = (open: boolean) => {
    setReviewing(open)
    if (open) confirm.reset()
  }

  const onConfirm = async (sponsored: boolean) => {
    const { sell, buy, quoted, minOutWei, slippageBps } = s
    if (!buy || !quoted || minOutWei === null) return
    let outcome
    try {
      outcome = await confirm.confirm({ sell, buy, quote: quoted, slippageBps, minOutWei, sponsored })
    } catch {
      return // The mutation keeps the error; the sheet shows it in the CTA's place.
    }
    if (!outcome.ok) return
    setReviewing(false)
    s.reset()
    setReceipt({
      transactionHash: outcome.transactionHash,
      sold: `${formatWei(quoted.sellAmount, sell.decimals)} ${sell.symbol}`,
      quoted: `${formatWei(quoted.buyAmount, buy.decimals)} ${buy.symbol}`,
      minimum: `${formatWei(minOutWei, buy.decimals)} ${buy.symbol}`,
      route: routeLabel(quoted) ?? '—',
    })
    notify.settled(`Swapping ${sell.symbol} for ${buy.symbol}`, { description: SWAP_AWAY, hash: outcome.transactionHash })
  }

  const pending = s.buy !== null && s.parsed.wei !== null && s.parsed.wei > 0n && s.quoted === null && !s.parsed.problem

  return (
    <Page kicker="Money" title="Swap" description={SWAP_DESCRIPTION} actions={<BoundaryBadge kind="shieldedRound" />}>
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] @4xl:items-start">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Swap form">
          <SellCard
            sell={s.sell}
            options={s.sellOptions}
            loading={s.tokensLoading}
            onChoose={s.chooseSell}
            raw={s.raw}
            onRaw={s.setRaw}
            onMax={s.setMax}
            heldWei={s.heldWei}
            problem={s.parsed.problem ?? (s.short ? `Not enough shielded ${s.sell.symbol}` : null)}
            shieldDoor={door.door}
          />
          <FlipButton onFlip={s.flip} canFlip={s.buy !== null} />
          <BuyCard
            buy={s.buy}
            options={s.buyOptions}
            loading={s.tokensLoading}
            onChoose={s.chooseBuy}
            quote={s.quoted}
            refreshing={s.refreshing}
            pending={pending}
            status={s.status}
          />
          <Button
            size="lg"
            className="w-full"
            aria-disabled={s.blocker !== null || undefined}
            onClick={() => {
              if (s.blocker === null) openReview(true)
            }}
          >
            {s.blocker ?? 'Review swap'}
          </Button>
        </section>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Quote and outcome">
          <SwapOutcome receipt={receipt} problem={confirm.problem} onDismissReceipt={() => setReceipt(null)} />
          <QuoteDetails
            sell={s.sell}
            buy={s.buy}
            quote={s.quoted}
            minOutWei={s.minOutWei}
            impact={s.impact}
            slippageBps={s.slippageBps}
            onSlippage={s.setSlippageBps}
            feeWei={s.quoted ? (fee.data?.feeWei ?? (fee.isError ? null : undefined)) : undefined}
            refreshing={s.refreshing}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-kicker uppercase text-muted-foreground">Who sees what</CardTitle>
            </CardHeader>
            <CardContent>
              <VisibilityMatrixView context="swap" />
            </CardContent>
          </Card>
        </aside>
      </div>

      {s.buy && s.quoted && s.minOutWei !== null ? (
        <SwapReview
          open={reviewing}
          onOpenChange={openReview}
          sell={s.sell}
          buy={s.buy}
          quote={s.quoted}
          minOutWei={s.minOutWei}
          impact={s.impact}
          slippageBps={s.slippageBps}
          feeWei={fee.data?.feeWei ?? (fee.isError ? null : undefined)}
          ready={s.ready}
          walkState={s.walkState}
          phase={confirm.phase}
          problem={confirm.problem}
          onConfirm={(sponsored) => void onConfirm(sponsored)}
        />
      ) : null}
      <ShieldDialog {...door.dialogProps} />
    </Page>
  )
}
