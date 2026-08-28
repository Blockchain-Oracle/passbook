import { timeLeft } from '@strk20/protocol/app-reads'
import { GOV_OPT_AGAINST, GOV_OPT_FOR } from '@strk20/protocol/governance-calldata'
import { PROPOSAL_MODE, PROPOSAL_STATE, proposalPhase, quorumPct, type OnChainProposal } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { proposalTitle } from './gov-send'

export interface ProposalRowProps {
  proposal: OnChainProposal
  now: number
  symbol: string
  /** 0 when the House counts members: weights render as voices. */
  decimals: number | null
  unit: string
  /** Absent when writes are blocked — the row then says nothing about voting, the surface says why. */
  onVote?: (choice: number) => void
  className?: string
}

export function proposalIsOpen(proposal: OnChainProposal, now: number): boolean {
  return proposal.state === PROPOSAL_STATE.active && proposal.deadline * 1000 > now
}

export function proposalSettled(proposal: OnChainProposal): boolean {
  return (
    proposal.state === PROPOSAL_STATE.succeeded ||
    proposal.state === PROPOSAL_STATE.defeated ||
    proposal.state === PROPOSAL_STATE.executed
  )
}

/**
 * One proposal as its Sealed Ballot Box. Open: participation — ballots landed, weight escrowed,
 * the quorum bar filling — and NEVER a leaderboard, because the direction is sealed. Settled:
 * the accepted tally, which the chain refused to publish unless the sums verified.
 */
export function ProposalRow({ proposal, now, symbol, decimals, unit, onVote, className }: ProposalRowProps) {
  const open = proposalIsOpen(proposal, now)
  const pct = quorumPct(proposal)
  const settled = proposalSettled(proposal)
  const voided = proposal.state === PROPOSAL_STATE.voided

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-body3 font-medium">{proposalTitle(proposal)}</p>
        <Badge variant="outline" className="shrink-0 font-mono text-mono">
          {open ? `closes in ${timeLeft(proposal.deadline, now)}` : proposalPhase(proposal, now)}
        </Badge>
      </div>
      <p className="font-mono text-mono text-muted-foreground">
        #{proposal.id} · {proposal.mode === PROPOSAL_MODE.permanent ? 'permanently sealed' : 'sealed until close'} ·{' '}
        {open ? 'closes' : 'closed'} {new Date(proposal.deadline * 1000).toLocaleString()}
      </p>

      {open ? (
        <>
          <Progress value={pct} aria-label={`Quorum ${pct}%`} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-mono text-muted-foreground">
            <span>
              {proposal.ballotCount} ballot{proposal.ballotCount === 1 ? '' : 's'} in the box
            </span>
            <span>
              <Amount wei={proposal.totalWeight} decimals={decimals} symbol={unit} size="sm" /> escrowed
            </span>
            <span className={cn('flex-1 text-right', pct >= 100 && 'text-settled')}>
              {pct >= 100 ? 'quorum reached — outcome sealed' : `quorum ${pct}%`}
            </span>
          </div>
          {onVote ? (
            <div className={cn('grid gap-2', proposal.options > 2 ? 'grid-cols-3' : 'grid-cols-2')}>
              <Button variant="outline" size="sm" className="border-settled text-settled" onClick={() => onVote(GOV_OPT_FOR)}>
                For — sealed
              </Button>
              <Button variant="outline" size="sm" className="border-irreversible text-irreversible" onClick={() => onVote(GOV_OPT_AGAINST)}>
                Against — sealed
              </Button>
              {proposal.options > 2 ? (
                <Button variant="outline" size="sm" onClick={() => onVote(2)}>
                  Abstain — sealed
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : settled ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-mono">
          <span className="text-settled">
            FOR <Amount wei={proposal.tallyFor} decimals={decimals} size="sm" />
          </span>
          <span className="text-irreversible">
            AGAINST <Amount wei={proposal.tallyAgainst} decimals={decimals} size="sm" />
          </span>
          <span className="text-muted-foreground">{symbol === unit ? symbol : unit} · the chain accepted this tally — a wrong one is unpublishable</span>
        </div>
      ) : voided ? (
        <p className="text-body4 text-muted-foreground">Voided — every escrow reopens. No vote can strand tokens.</p>
      ) : (
        <p className="text-body4 text-muted-foreground">The box is closed. The Teller publishes when the sums verify.</p>
      )}
    </div>
  )
}
