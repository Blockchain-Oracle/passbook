import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { HOUSE_MEMBERSHIP, type OnChainHouse, type OnChainProposal } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { BallotTicket } from './ballot-ticket'
import { DelegateDialog } from './delegate-dialog'
import { houseTitle } from './gov-send'
import { FundDialog, JoinDialog } from './house-doors'
import { ProposalRow } from './proposal-row'
import { ProposeDialog } from './propose-dialog'
import { useHouseToken } from './use-house-token'

export interface HouseCardProps {
  house: OnChainHouse
  proposals: readonly OnChainProposal[]
  now: number
  /** Whether the doors render. When false, the surface above says why — the card stays quiet. */
  writesEnabled: boolean
  className?: string
}

type Door = 'propose' | 'fund' | 'join' | 'delegate' | null

/** One House, whole: identity, treasury, its proposals as boxes, and the doors in. */
export function HouseCard({ house, proposals, now, writesEnabled, className }: HouseCardProps) {
  const token = useHouseToken(house)
  const [ballot, setBallot] = useState<{ proposal: OnChainProposal; choice: number } | null>(null)
  const [door, setDoor] = useState<Door>(null)
  const invite = house.membership === HOUSE_MEMBERSHIP.invite

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 flex-1 font-display text-display4 uppercase">
            <Link to="/houses/$id" params={{ id: String(house.id) }} preload="intent" className="group inline-flex items-center gap-1 hover:underline">
              {houseTitle(house)}
              <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
          </CardTitle>
          <Badge variant="outline" className="font-mono text-mono">
            {invite ? `${house.memberCount} members · invite` : 'open'}
          </Badge>
          {token.memberMode ? (
            <Badge variant="outline" className="font-mono text-mono">
              1 member · 1 vote
            </Badge>
          ) : null}
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-mono text-muted-foreground">
          <div className="flex gap-1">
            <dt>treasury</dt>
            <dd className="text-foreground">
              <Amount wei={house.treasury} decimals={token.decimals} symbol={token.symbol} size="sm" />
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>quorum</dt>
            <dd className="text-foreground">
              <Amount wei={house.quorum} decimals={token.weightDecimals} symbol={token.weightUnit} size="sm" />
            </dd>
          </div>
        </dl>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {proposals.length === 0 ? (
          <p className="text-body4 text-muted-foreground">No question is standing. The box is ready.</p>
        ) : (
          proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              now={now}
              symbol={token.symbol}
              decimals={token.weightDecimals}
              unit={token.weightUnit}
              onVote={writesEnabled ? (choice) => setBallot({ proposal, choice }) : undefined}
            />
          ))
        )}
      </CardContent>
      {writesEnabled ? (
        <CardFooter className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDoor('propose')}>
            Propose
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDoor('fund')}>
            Fund the treasury
          </Button>
          {invite ? (
            <Button variant="outline" size="sm" onClick={() => setDoor('join')}>
              Join with an invite
            </Button>
          ) : null}
          {!token.memberMode ? (
            <Button variant="ghost" size="sm" onClick={() => setDoor('delegate')}>
              Delegate
            </Button>
          ) : null}
        </CardFooter>
      ) : null}

      {ballot ? (
        <BallotTicket house={house} proposal={ballot.proposal} initialChoice={ballot.choice} open onOpenChange={(o) => !o && setBallot(null)} />
      ) : null}
      <ProposeDialog house={house} open={door === 'propose'} onOpenChange={(o) => !o && setDoor(null)} />
      <FundDialog house={house} open={door === 'fund'} onOpenChange={(o) => !o && setDoor(null)} />
      {invite ? <JoinDialog house={house} open={door === 'join'} onOpenChange={(o) => !o && setDoor(null)} /> : null}
      <DelegateDialog house={house} open={door === 'delegate'} onOpenChange={(o) => !o && setDoor(null)} />
    </Card>
  )
}
