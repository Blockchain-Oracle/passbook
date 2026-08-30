import { GOV_OPT_AGAINST, GOV_OPT_FOR } from '@strk20/protocol/governance-calldata'
import { PROPOSAL_ACTION, PROPOSAL_MODE, quorumPct, type OnChainProposal } from '@strk20/protocol/governance-reads'
import { proposalLifecycle, type ProposalTone } from '@strk20/protocol/proposal-lifecycle'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { shortAddress } from '@/lib/format'
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

/** Only `open` wears the accent. Everything else is a fact about the past, and reads as one. */
const TONE_BADGE: Record<ProposalTone, { variant: 'default' | 'secondary' | 'outline'; className?: string }> = {
  open: { variant: 'default' },
  counting: { variant: 'secondary' },
  passed: { variant: 'outline', className: 'border-settled text-settled' },
  refused: { variant: 'outline', className: 'text-muted-foreground' },
  voided: { variant: 'outline', className: 'border-exposed text-exposed' },
}

export function proposalIsOpen(proposal: OnChainProposal, now: number): boolean {
  return proposalLifecycle(proposal, now).tone === 'open'
}

export function proposalSettled(proposal: OnChainProposal): boolean {
  const tone = proposalLifecycle(proposal, Date.now()).tone
  return tone === 'passed' || tone === 'refused'
}

/**
 * WHAT THIS PROPOSAL WOULD DO, which the row never said.
 *
 * A vote with an invisible consequence is a vote you cannot cast honestly: `action_kind` and
 * `action_amount` have been on the record since the contract shipped and appeared on no surface.
 */
function ActionLine({ proposal, decimals, unit }: { proposal: OnChainProposal; decimals: number | null; unit: string }) {
  if (proposal.actionKind === PROPOSAL_ACTION.spend) {
    return (
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-muted-foreground">If it passes</span>
        <span className="font-medium">
          spend <Amount wei={proposal.actionAmount} decimals={decimals} symbol={unit} size="sm" />
        </span>
        <span className="text-muted-foreground">to</span>
        <span className="font-mono text-mono">{shortAddress(proposal.actionRecipient, 8, 6)}</span>
      </span>
    )
  }
  // TEXT is the contract's other arm: a signal with nothing to execute. Said outright, not omitted.
  return <span className="text-muted-foreground">A signal only — passing it moves no money.</span>
}

/**
 * One proposal as its Sealed Ballot Box. Open: participation — ballots landed, weight escrowed,
 * the quorum bar filling — and NEVER a leaderboard, because the direction is sealed. Settled:
 * the accepted tally, which the chain refused to publish unless the sums verified.
 */
export function ProposalRow({ proposal, now, symbol, decimals, unit, onVote, className }: ProposalRowProps) {
  const life = proposalLifecycle(proposal, now)
  const open = life.tone === 'open'
  const settled = life.tone === 'passed' || life.tone === 'refused'
  const pct = quorumPct(proposal)
  const badge = TONE_BADGE[life.tone]

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', open && 'border-accent1/40', className)}>
      {/* State and clock are two facts and get two slots; they used to share one badge. */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-body3 font-medium">{proposalTitle(proposal)}</p>
        <Badge variant={badge.variant} className={cn('shrink-0', badge.className)}>
          {life.label}
        </Badge>
      </div>

      <p className="font-mono text-mono text-muted-foreground">
        #{proposal.id} · {proposal.mode === PROPOSAL_MODE.permanent ? 'permanently sealed' : 'sealed until close'}
        {life.timing ? (
          <>
            {' · '}
            {life.timing.live ? (
              <span className="text-accent1">{life.timing.text}</span>
            ) : (
              `${life.timing.label.toLowerCase()} ${new Date(life.timing.at).toLocaleString()}`
            )}
          </>
        ) : null}
      </p>

      <p className="text-body4">
        <ActionLine proposal={proposal} decimals={decimals} unit={unit} />
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
            <div className={cn('grid gap-2', proposal.options > 2 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>
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
          <span className="text-muted-foreground">{symbol === unit ? symbol : unit}</span>
        </div>
      ) : null}

      {life.detail ? <p className="text-body4 text-muted-foreground">{life.detail}</p> : null}
    </div>
  )
}
