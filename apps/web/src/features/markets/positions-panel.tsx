import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MARKET_STATE, marketQuestion, type OnChainMarket } from '@strk20/protocol/app-reads'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { MARKET_OP, cashoutPayload, claimPayload } from '@strk20/protocol/market-calldata'
import { POSITION_SECRETS_ARE_MONEY } from '@strk20/protocol/markets-copy'
import { marketPositionAction, type MarketPositionAction } from '@strk20/protocol/position-actions'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { formatWei } from '@/lib/format'
import { sendProblem, useSend } from '@/mutations'
import { appContracts, marketPositionQuery } from '@/queries'
import { removeStoredPosition, storedPositionsQuery } from '@/queries/positions'
import type { Stake } from './use-stake'

export interface PositionsPanelProps {
  markets: readonly OnChainMarket[]
  /** Narrow to one market's record. */
  marketId?: number
  stake: Stake
  now: number
}

type Door = Extract<MarketPositionAction, { kind: 'claim' | 'cashout' }>
interface Review {
  position: StoredPosition
  market: OnChainMarket
  door: Door
}

const SENTENCE: Record<'lost' | 'complete', string> = {
  lost: 'This ticket lost. There is no payout to claim.',
  complete: 'This position is already settled on chain.',
}

function actionFor(read: { state: number; cashoutQuote: bigint; claimPreview: bigint }, market: OnChainMarket, now: number): MarketPositionAction {
  return marketPositionAction({
    positionOpen: read.state === 1,
    marketState: market.state === MARKET_STATE.active ? 'active' : market.state === MARKET_STATE.resolved ? 'resolved' : 'voided',
    beforeDeadline: now < market.deadline * 1000,
    cashoutQuote: read.cashoutQuote,
    claimPreview: read.claimPreview,
  })
}

function PositionRow({ position, markets, stake, now, onReview }: {
  position: StoredPosition
  markets: readonly OnChainMarket[]
  stake: Stake
  now: number
  onReview: (review: Review) => void
}) {
  const read = useQuery(marketPositionQuery(position.commitment))
  // A seed is stored before the chain assigns the id; the read names the market it landed in.
  const market = markets.find((m) => m.id === (read.data?.marketId ?? position.id))
  const action = read.data && market ? actionFor(read.data, market, now) : null

  return (
    <Item size="sm" className="rounded-none px-0">
      <ItemContent>
        <ItemTitle className="text-body3">{position.label ?? (market ? marketQuestion(market) : `Market #${position.id}`)}</ItemTitle>
        <ItemDescription className="font-mono text-mono">
          {read.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : read.isError ? (
            'The position could not be read.'
          ) : !market ? (
            'This market is not in the registry yet.'
          ) : action?.kind === 'waiting' ? (
            action.because
          ) : action?.kind === 'lost' || action?.kind === 'complete' ? (
            SENTENCE[action.kind]
          ) : action ? (
            <>
              {action.kind === 'cashout' ? 'Sells back for ' : 'Pays '}
              <Amount wei={action.amount} decimals={stake.decimals} symbol={stake.symbol} size="sm" />
            </>
          ) : null}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {market && (action?.kind === 'cashout' || action?.kind === 'claim') ? (
          <Button size="sm" variant={action.kind === 'claim' ? 'default' : 'outline'} onClick={() => onReview({ position, market, door: action })}>
            {action.kind === 'claim' ? 'Review claim' : 'Review cash out'}
          </Button>
        ) : action?.kind === 'lost' || action?.kind === 'complete' ? (
          <Button size="sm" variant="ghost" onClick={() => void removeStoredPosition(position.commitment)}>
            Forget
          </Button>
        ) : null}
      </ItemActions>
    </Item>
  )
}

/** The bearer positions this browser holds on the Markets contract, each with its one live door. */
export function PositionsPanel({ markets, marketId, stake, now }: PositionsPanelProps) {
  const stored = useQuery(storedPositionsQuery())
  const send = useSend()
  const contract = appContracts().markets
  const [review, setReview] = useState<Review | null>(null)

  const settle = async () => {
    if (!review || !contract) return
    const { position, market, door } = review
    const cashout = door.kind === 'cashout'
    const payload = cashout ? cashoutPayload({ secret: position.secret, minOut: (door.amount * 99n) / 100n }) : claimPayload([position.secret])
    if (payload.state === 'refused') {
      toast.error(payload.because)
      return
    }
    const result = await send.mutateAsync({
      kind: cashout ? 'market-cashout' : 'market-claim',
      recipient: contract,
      token: market.token,
      symbol: stake.symbol,
      amount: 0n,
      surface: 'markets',
      label: cashout ? 'Cash out market position' : 'Claim market winnings',
      app: {
        contract,
        op: cashout ? MARKET_OP.cashout : MARKET_OP.claim,
        calldata: [...payload.calldata],
        noteIdSlots: [...payload.noteIdSlots],
        openNoteCount: 1,
        payoutToken: market.token,
      },
    })
    if (result.ok) {
      await removeStoredPosition(position.commitment)
      toast.success(cashout ? 'Position cashed out' : 'Payout claimed', {
        description: `${formatWei(door.amount, stake.decimals)} ${stake.symbol} matured into your shielded balance.`,
      })
      setReview(null)
      return
    }
    toast.error(sendProblem(result) ?? 'The settlement could not be sent.')
  }

  if (stored.isPending) return <Skeleton className="h-12 w-full" />
  if (stored.isError) return <p className="text-body4 text-irreversible">The position record could not be opened.</p>
  if (stored.data.state === 'corrupt') return <p className="text-body4 text-irreversible">{stored.data.because}</p>

  const rows = stored.data.positions.filter((p) => p.venue === 'market' && (marketId === undefined || p.id === marketId || p.id === -1))
  if (rows.length === 0) {
    return <p className="text-body4 text-muted-foreground">No positions in this browser yet. {POSITION_SECRETS_ARE_MONEY}</p>
  }
  const amount = review ? `${formatWei(review.door.amount, stake.decimals)} ${stake.symbol}` : '—'
  return (
    <div className="flex flex-col gap-2">
      <ItemGroup className="gap-0 divide-y">
        {rows.map((p) => (
          <PositionRow key={p.commitment} position={p} markets={markets} stake={stake} now={now} onReview={setReview} />
        ))}
      </ItemGroup>
      <p className="text-body4 text-muted-foreground">{POSITION_SECRETS_ARE_MONEY}</p>
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? undefined : setReview(null))}
        title={review?.door.kind === 'cashout' ? 'Review cash out' : 'Review claim'}
        boundary="bearer"
        rows={[
          { label: 'Market', value: review ? marketQuestion(review.market) : '—' },
          { label: review?.door.kind === 'cashout' ? 'Sells back for' : 'Pays', value: amount },
          { label: 'Receives shielded', value: 'One fresh note to yourself' },
        ]}
        disclosure={disclosureFor('markets-exit')}
        confirmLabel={review?.door.kind === 'cashout' ? `Cash out for ${amount}` : `Claim ${amount}`}
        onConfirm={() => void settle()}
        busy={send.isPending}
      />
    </div>
  )
}
