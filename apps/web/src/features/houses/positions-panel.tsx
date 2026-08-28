import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { GOV_RECLAIM_BEARER } from '@strk20/protocol/disclosure-copy'
import { GOV_OP, reclaimPayload, revokePayload } from '@strk20/protocol/governance-calldata'
import { PROPOSAL_STATE, type OnChainHouse, type OnChainProposal } from '@strk20/protocol/governance-reads'
import { governancePositionAction } from '@strk20/protocol/position-actions'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { shortAddress } from '@/lib/format'
import { sendProblem, useSend } from '@/mutations'
import { appContracts, governanceWrites } from '@/queries'
import { govLeg } from './gov-send'
import { removeStoredPosition, storedPositionsQuery } from '@/queries/positions'

export interface PositionsPanelProps {
  houses: readonly OnChainHouse[]
  proposals: readonly OnChainProposal[]
  /** Narrow to one House on its record page. */
  houseId?: number
  className?: string
}

type Door = 'reclaim' | 'revoke'
interface Review {
  position: StoredPosition
  door: Door
}

/** The bearer claims this browser holds in the Houses, each with its one honest door. */
export function PositionsPanel({ houses, proposals, houseId, className }: PositionsPanelProps) {
  const stored = useQuery(storedPositionsQuery())
  const send = useSend()
  const writes = governanceWrites()
  const contract = appContracts().governance
  const [review, setReview] = useState<Review | null>(null)

  const positions =
    stored.data?.state === 'ok'
      ? stored.data.positions.filter((p) => p.venue === 'governance' && (houseId === undefined || p.houseId === houseId || (p.kind === 'gov-founder' && houseId === undefined)))
      : []
  const reviewHouse = review ? houses.find((h) => h.id === review.position.houseId) : undefined

  const settle = async () => {
    if (!review || !contract) return
    const { position, door } = review
    const payload = door === 'reclaim' ? reclaimPayload([position.secret]) : revokePayload([position.secret])
    if (payload.state === 'refused') {
      toast.error('The settlement was refused', { description: payload.because })
      return
    }
    const result = await send.mutateAsync({
      kind: door === 'reclaim' ? 'gov-reclaim' : 'gov-revoke',
      recipient: contract,
      token: reviewHouse?.token ?? '0x0',
      symbol: '',
      amount: 0n,
      surface: 'houses',
      label: door === 'reclaim' ? 'Reclaim House escrow' : 'Revoke House delegation',
      app: govLeg(contract, door === 'reclaim' ? GOV_OP.reclaim : GOV_OP.revoke, payload, { payoutToken: reviewHouse?.token }),
    })
    if (result.ok) {
      await removeStoredPosition(position.commitment)
      toast.success(door === 'reclaim' ? 'Escrow reclaimed' : 'Delegation revoked', { description: 'The escrow matured into your shielded balance as a fresh note.' })
      setReview(null)
      return
    }
    toast.error(sendProblem(result) ?? 'The settlement did not go through.')
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-display text-display4 uppercase">Your positions</CardTitle>
        <CardDescription>{GOV_RECLAIM_BEARER}</CardDescription>
        <CardAction>
          <BoundaryBadge kind="bearer" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {stored.data?.state === 'corrupt' ? (
          <p className="text-body4 text-irreversible">{stored.data.because}</p>
        ) : positions.length === 0 ? (
          <p className="text-body4 text-muted-foreground">
            {stored.isPending ? 'Reading this browser’s claims…' : 'No ballot escrow, delegation or founder claim is held here.'}
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {positions.map((position) => {
              const proposal = position.kind === 'gov-ballot' ? proposals.find((p) => p.id === position.id) : undefined
              const action =
                position.kind === 'gov-founder'
                  ? null
                  : governancePositionAction({
                      escrowOpen: true,
                      kind: position.kind === 'gov-delegation' ? 'delegation' : 'ballot',
                      amount: 0n,
                      proposalActive: proposal ? proposal.state === PROPOSAL_STATE.active : position.kind === 'gov-ballot',
                      writesEnabled: writes.enabled,
                      ...(writes.enabled ? {} : { writeBlocker: writes.because }),
                    })
              return (
                <Item key={position.commitment} variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle>{position.label ?? position.kind ?? 'Position'}</ItemTitle>
                    <ItemDescription className="font-mono text-mono">
                      {shortAddress(position.commitment, 10, 6)}
                      {position.txHash ? ` · tx ${shortAddress(position.txHash, 8, 4)}` : ''}
                    </ItemDescription>
                    {action && (action.kind === 'waiting' || action.kind === 'blocked') ? (
                      <ItemDescription>{action.because}</ItemDescription>
                    ) : null}
                    {position.kind === 'gov-founder' ? <ItemDescription>The founder claim. It has no door until the House needs one.</ItemDescription> : null}
                  </ItemContent>
                  {action && (action.kind === 'reclaim' || action.kind === 'revoke') ? (
                    <ItemActions>
                      <Button size="sm" variant="outline" onClick={() => setReview({ position, door: action.kind })}>
                        {action.kind === 'reclaim' ? 'Review reclaim' : 'Review revoke'}
                      </Button>
                    </ItemActions>
                  ) : null}
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? undefined : setReview(null))}
        title={review?.door === 'reclaim' ? 'Review reclaim' : 'Review revoke'}
        boundary="bearer"
        rows={[
          { label: 'Record', value: review?.position.label ?? review?.position.kind ?? '—' },
          { label: 'House', value: review?.position.houseId !== undefined ? `House #${review.position.houseId}` : '—' },
          { label: 'Receives shielded', value: 'The escrow, back as one fresh note' },
        ]}
        disclosure={disclosureFor('gov-reclaim')}
        confirmLabel={review?.door === 'reclaim' ? 'Reclaim escrow' : 'Revoke delegation'}
        onConfirm={() => void settle()}
        busy={send.isPending}
      />
    </Card>
  )
}
