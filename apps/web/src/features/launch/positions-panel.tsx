// The bearer positions this browser holds on a launch — the private half of a public sale. The
// secret IS the claim; the chain decides which terminal door (redeem / refund) is open right now.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import type { OnChainLaunch } from '@strk20/protocol/app-reads'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { LAUNCH_OP, redeemPayload, refundPayload } from '@strk20/protocol/launch-calldata'
import { launchPositionAction, type LaunchPositionAction } from '@strk20/protocol/position-actions'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerTx, formatWei, shortAddress } from '@/lib/format'
import { sendProblem, useSend } from '@/mutations'
import { appContracts, launchPositionQuery } from '@/queries'
import { removeStoredPosition, storedPositionsQuery } from '@/queries/positions'
import { launchStateWord } from './phase'
import { useStakeToken } from './queries'

type Door = Extract<LaunchPositionAction, { kind: 'redeem' | 'refund' }>
interface Review {
  position: StoredPosition
  door: Door
}

function PositionRow({ position, launch, stake, onReview }: {
  position: StoredPosition
  launch: OnChainLaunch
  stake: { symbol: string; decimals: number | null }
  onReview: (door: Door) => void
}) {
  const read = useQuery(launchPositionQuery(position.commitment))
  const action: LaunchPositionAction | null = read.data
    ? launchPositionAction({
        positionOpen: read.data.state === 1,
        launchState: launchStateWord(launch),
        deadlinePassed: Date.now() >= launch.deadline * 1000,
        redeemPreview: read.data.redeemPreview,
        refundPreview: read.data.refundPreview,
      })
    : null
  const payout = action?.kind === 'redeem' ? { symbol: launch.symbol, decimals: 18 } : stake

  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle>{position.label ?? `Launch ${position.id}`}</ItemTitle>
        <ItemDescription className="flex items-center gap-2 font-mono text-mono">
          {shortAddress(position.commitment, 10, 8)}
          {position.txHash ? (
            <a href={explorerTx(position.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent1">
              opened <ArrowUpRight className="size-3" aria-hidden />
            </a>
          ) : null}
        </ItemDescription>
        {read.isPending ? <Skeleton className="mt-1 h-4 w-40" /> : null}
        {read.isError ? <p className="text-body4 text-irreversible">Position state could not be read.</p> : null}
        {action && (action.kind === 'redeem' || action.kind === 'refund') ? (
          <p className="text-body4">
            {action.kind === 'redeem' ? 'Token payout' : 'Refund'} ·{' '}
            <Amount wei={action.amount} decimals={payout.decimals} symbol={payout.symbol} size="sm" />
          </p>
        ) : null}
        {action && action.kind === 'waiting' ? <p className="text-body4 text-muted-foreground">{action.because}</p> : null}
        {action && action.kind === 'complete' ? <p className="text-body4 text-muted-foreground">This position is already settled on chain.</p> : null}
      </ItemContent>
      <ItemActions>
        {read.isError ? (
          <Button size="sm" variant="ghost" onClick={() => void read.refetch()}>
            <RefreshCw data-icon="inline-start" /> Retry
          </Button>
        ) : null}
        {action && (action.kind === 'redeem' || action.kind === 'refund') ? (
          <Button size="sm" variant="outline" onClick={() => onReview(action)}>
            {action.kind === 'redeem' ? 'Review redeem' : 'Review refund'}
          </Button>
        ) : null}
      </ItemActions>
    </Item>
  )
}

/** Positions stored for one launch (or, without `launch`, every launch position this browser holds). */
export function PositionsPanel({ launch }: { launch: OnChainLaunch }) {
  const stored = useQuery(storedPositionsQuery())
  const stake = useStakeToken(launch.stakeToken)
  const send = useSend()
  const [review, setReview] = useState<Review | null>(null)
  const contract = appContracts().launch
  if (stored.data?.state === 'corrupt') return <p className="text-body4 text-irreversible">{stored.data.because}</p>
  const positions = stored.data?.state === 'ok' ? stored.data.positions.filter((p) => p.venue === 'launch' && p.id === launch.id) : []
  if (positions.length === 0) return null

  const payout = review?.door.kind === 'redeem' ? { symbol: launch.symbol, decimals: 18, token: launch.token } : { ...stake, token: launch.stakeToken }

  const settle = async () => {
    if (!review || !contract) return
    const redeeming = review.door.kind === 'redeem'
    const payload = redeeming ? redeemPayload([review.position.secret]) : refundPayload([review.position.secret])
    if (payload.state === 'refused') {
      toast.error('Settlement refused', { description: payload.because })
      return
    }
    const outcome = await send.mutateAsync({
      kind: redeeming ? 'launch-redeem' : 'launch-refund',
      recipient: contract,
      token: payout.token,
      symbol: payout.symbol,
      amount: 0n,
      label: redeeming ? `Redeem ${launch.symbol}` : `Refund launch ${launch.id}`,
      app: { contract, op: redeeming ? LAUNCH_OP.redeem : LAUNCH_OP.refund, calldata: payload.calldata, noteIdSlots: payload.noteIdSlots, openNoteCount: 1, payoutToken: payout.token },
    })
    if (!outcome.ok) {
      toast.error('The settlement did not go through', { description: sendProblem(outcome) ?? undefined })
      return
    }
    await removeStoredPosition(review.position.commitment)
    toast.success(redeeming ? 'Launch tokens redeemed' : 'Purchase refunded', {
      description: `${formatWei(review.door.amount, payout.decimals)} ${payout.symbol} matured into your shielded balance.`,
    })
    setReview(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-kicker uppercase text-muted-foreground">Your positions</CardTitle>
        <CardDescription>
          Launch records store commitments, not buyer addresses. The account that submits a buy or settlement is still visible on Starknet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {positions.map((position) => (
            <PositionRow key={position.commitment} position={position} launch={launch} stake={stake} onReview={(door) => setReview({ position, door })} />
          ))}
        </ItemGroup>
      </CardContent>
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? undefined : setReview(null))}
        title={review?.door.kind === 'redeem' ? 'Review redemption' : 'Review refund'}
        boundary="bearer"
        rows={[
          { label: 'Record', value: `Launch #${launch.id}` },
          { label: 'Receives shielded', value: review ? `${formatWei(review.door.amount, payout.decimals)} ${payout.symbol}` : '—' },
        ]}
        disclosure={disclosureFor('launch-sell')}
        confirmLabel={review ? `${review.door.kind === 'redeem' ? 'Redeem' : 'Refund'} ${formatWei(review.door.amount, payout.decimals)} ${payout.symbol}` : ''}
        onConfirm={() => void settle()}
        busy={send.isPending}
      >
        <p className="text-body4 text-muted-foreground">
          The transaction submitter is visible on Starknet. The Launch contract records the bearer commitment instead of a buyer address.
        </p>
      </ReviewSheet>
    </Card>
  )
}
