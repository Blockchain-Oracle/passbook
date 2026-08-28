//
// One House, whole: its identity, its treasury, its proposals as Sealed Ballot Boxes, and the
// three doors in — propose, fund, join.
//
// THE SEALED BALLOT BOX IS THE ANTI-BANDWAGON CLAIM, DRAWN (spec §9.2): while a vote is open the
// card shows participation — ballots landed, weight escrowed, the quorum bar filling — and
// NEVER a leaderboard, because the direction is sealed and a bar chart of it would be a lie.
// "Quorum reached, outcome sealed" is a state no transparent voting product can render.
//
import { Link } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { toPlainText } from '@strk20/protocol/amount'
import { GOV_OP, GOV_OPT_AGAINST, GOV_OPT_FOR, fundPayload, joinPayload } from '@strk20/protocol/governance-calldata'
import {
  HOUSE_COUNTING,
  HOUSE_MEMBERSHIP,
  PROPOSAL_STATE,
  proposalPhase,
  quorumPct,
  type OnChainHouse,
  type OnChainProposal,
} from '@strk20/protocol/governance-reads'
import { timeLeft } from '@strk20/protocol/app-reads'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { toast } from '../../shell/toast-store'
import { useBalance } from '../../shell/use-balance'
import { useSend } from '../../shell/use-send'
import { useSession, shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { AmountInput, useAmountField } from '../AmountInput'
import { BlockedButton } from '../BlockedButton'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'
import { BallotTicket } from './BallotTicket'
import { ProposeDialog } from './ProposeDialog'

export function HouseCard({
  house,
  proposals,
  now,
}: {
  house: OnChainHouse
  proposals: readonly OnChainProposal[]
  now: number
}) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, house.token)
  const symbol = stake?.symbol ?? shortenFelt(house.token, 4, 3)
  const decimals = stake?.decimals ?? 18

  const [ballot, setBallot] = useState<{ proposal: OnChainProposal; choice: number } | null>(null)
  const [proposing, setProposing] = useState(false)
  const [funding, setFunding] = useState(false)
  const [joining, setJoining] = useState(false)

  const invite = house.membership === HOUSE_MEMBERSHIP.invite

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s16">
      {/*
        THE HEADER IS THE DOOR IN. "I can't even go inside a particular DAO" was the review —
        the name and the fact row link into the House's record page, while the vote buttons and
        the three doors below keep working in place.
      */}
      <Link
        to="/houses/$id"
        params={{ id: String(house.id) }}
        preload="intent"
        className="focus-ring group flex flex-col gap-s8 no-underline"
      >
        <div className="flex items-center gap-s8">
          <Text variant="subheading1" as="h2" className="min-w-0 flex-1 truncate text-neutral1">
            {house.metadata || `House ${house.id}`}
          </Text>
          <span className="rounded-pill border border-solid border-surface3 px-s8 py-s2 font-mono text-mono text-neutral2">
            {invite ? `${house.memberCount} members · invite` : 'open'}
          </span>
          {house.counting === HOUSE_COUNTING.member ? (
            <span className="rounded-pill border border-solid border-surface3 px-s8 py-s2 font-mono text-mono text-neutral2">
              1 member · 1 vote
            </span>
          ) : null}
        </div>

        <div className="flex items-baseline gap-s12 font-mono text-mono text-neutral3">
          <span>
            treasury{' '}
            <span className="text-neutral1">
              {toPlainText(house.treasury, decimals)} {symbol}
            </span>
          </span>
          <span>
            quorum {toPlainText(house.quorum, house.counting === HOUSE_COUNTING.member ? 0 : decimals)}
            {house.counting === HOUSE_COUNTING.member ? ' voices' : ` ${symbol}`}
          </span>
          <span className="flex-1 text-right text-neutral3 opacity-0 transition-opacity group-hover:opacity-100">
            the record →
          </span>
        </div>
      </Link>

      {proposals.length === 0 ? (
        <Text variant="body4" className="text-neutral3">
          No question is standing. The box is ready.
        </Text>
      ) : (
        <div className="flex flex-col gap-s8">
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              now={now}
              symbol={symbol}
              decimals={house.counting === HOUSE_COUNTING.member ? 0 : decimals}
              onVote={(choice) => setBallot({ proposal, choice })}
            />
          ))}
        </div>
      )}

      <div className="flex gap-s6">
        <Button variant="secondary" size="sm" onClick={() => setProposing(true)}>
          Propose
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFunding(true)}>
          Fund the treasury
        </Button>
        {invite ? (
          <Button variant="secondary" size="sm" onClick={() => setJoining(true)}>
            Join with an invite
          </Button>
        ) : null}
      </div>

      {ballot ? (
        <BallotTicket
          house={house}
          proposal={ballot.proposal}
          initialChoice={ballot.choice}
          open
          onClose={() => setBallot(null)}
        />
      ) : null}
      <ProposeDialog house={house} open={proposing} onClose={() => setProposing(false)} />
      <FundDialog house={house} open={funding} onClose={() => setFunding(false)} />
      {invite ? <JoinDialog house={house} open={joining} onClose={() => setJoining(false)} /> : null}
    </section>
  )
}

/** One proposal as its box. Open: participation without direction. Settled: the accepted tally. */
export function ProposalRow({
  proposal,
  now,
  symbol,
  decimals,
  onVote,
}: {
  proposal: OnChainProposal
  now: number
  symbol: string
  decimals: number
  onVote: (choice: number) => void
}) {
  const open = proposal.state === PROPOSAL_STATE.active && proposal.deadline * 1000 > now
  const pct = quorumPct(proposal)
  const settledWithTally =
    proposal.state === PROPOSAL_STATE.succeeded ||
    proposal.state === PROPOSAL_STATE.defeated ||
    proposal.state === PROPOSAL_STATE.executed

  return (
    <div className="flex flex-col gap-s6 rounded-card border border-solid border-surface3 p-s10">
      <div className="flex items-baseline justify-between gap-s8">
        <Text variant="body3" className="min-w-0 font-medium text-neutral1">
          {proposal.metadata || `Proposal ${proposal.id}`}
        </Text>
        <Text variant="mono" className="shrink-0 text-neutral3">
          {open ? `closes in ${timeLeft(proposal.deadline, now)}` : proposalPhase(proposal, now)}
        </Text>
      </div>

      {open ? (
        <>
          {/* Participation, never direction: the quorum bar fills while the outcome stays sealed. */}
          <div className="h-s4 overflow-hidden rounded-pill bg-insetHovered">
            <span aria-hidden="true" className="block h-full rounded-pill bg-accent1" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center gap-s8 font-mono text-mono text-neutral3">
            <span>
              {proposal.ballotCount} ballot{proposal.ballotCount === 1 ? '' : 's'} in the box
            </span>
            <span>
              {toPlainText(proposal.totalWeight, decimals)}
              {decimals === 0 ? ' voices' : ` ${symbol}`} escrowed
            </span>
            <span className={cn('flex-1 text-right', pct >= 100 ? 'text-settled' : '')}>
              {pct >= 100 ? 'quorum reached — outcome sealed' : `quorum ${pct}%`}
            </span>
          </div>
          <div className="flex gap-s6">
            <button
              type="button"
              onClick={() => onVote(GOV_OPT_FOR)}
              className="focus-ring flex-1 cursor-pointer rounded-control bg-settledTint py-s8 text-buttonLabel4 text-settled"
            >
              For — sealed
            </button>
            <button
              type="button"
              onClick={() => onVote(GOV_OPT_AGAINST)}
              className="focus-ring flex-1 cursor-pointer rounded-control bg-irreversibleTint py-s8 text-buttonLabel4 text-irreversible"
            >
              Against — sealed
            </button>
          </div>
        </>
      ) : settledWithTally ? (
        <div className="flex items-center gap-s8 font-mono text-mono">
          <span className="text-settled">FOR {toPlainText(proposal.tallyFor, decimals)}</span>
          <span className="text-irreversible">AGAINST {toPlainText(proposal.tallyAgainst, decimals)}</span>
          <span className="flex-1 text-right text-neutral3">
            the chain accepted this tally — a wrong one is unpublishable
          </span>
        </div>
      ) : (
        <Text variant="body4" className="text-neutral3">
          {proposal.state === PROPOSAL_STATE.voided
            ? 'Voided — every escrow reopens. No vote can strand tokens.'
            : 'The box is closed. The Teller publishes when the sums verify.'}
        </Text>
      )}
    </div>
  )
}

/** Fund the pot — anonymously, and there is no way back. Shared with the House record page. */
export function FundDialog({ house, open, onClose }: { house: OnChainHouse; open: boolean; onClose: () => void }) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, house.token)
  const symbol = stake?.symbol ?? shortenFelt(house.token, 4, 3)
  const decimals = stake?.decimals ?? 18

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const heldWei = useMemo(() => {
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(house.token)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance, house.token])
  const amount = useAmountField({ decimals, available: heldWei })

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.governance
    if (!contract || amount.wei === null || amount.wei === 0n) return
    const payload = fundPayload({ houseId: house.id, amount: amount.wei })
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'The gift was refused', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: 'gov-fund',
      recipient: contract,
      token: house.token,
      symbol,
      amount: amount.wei,
      app: { contract, op: GOV_OP.fund, calldata: payload.calldata, noteIdSlots: [], openNoteCount: 0 },
    })
    if (!outcome.ok) return
    toast({ kind: 'success', title: 'The treasury grew', detail: 'In public — and nobody knows it was you.' })
    onClose()
  }, [house, amount.wei, symbol, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Fund" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Fund {house.metadata || `House ${house.id}`}
        </Text>
        <AmountInput field={amount} symbol={symbol} balance={null} label="Amount to give" />
        <Text variant="body4" className="text-neutral3">
          The amount is public; the giver is not — and gifts have no way back. Spending it takes a
          passed vote, and the payout is public.
        </Text>
        <BlockedButton
          blocker={
            sending.stage
              ? 'Working…'
              : (!ready ? 'This browser has no account yet' : null) ??
                (amount.wei === null || amount.wei === 0n ? 'Enter an amount' : null) ??
                (amount.short ? `Not enough shielded ${symbol}` : null) ??
                sending.problem
          }
          action="Give it, anonymously"
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}

/** Join the roll — a zero-value ComputeAndInvoke, the whole payload being that you are someone. */
export function JoinDialog({ house, open, onClose }: { house: OnChainHouse; open: boolean; onClose: () => void }) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)
  const [secret, setSecret] = useState('')
  const { tokens } = useTokenList()
  const stake = findToken(tokens, house.token)

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.governance
    if (!contract || secret.trim() === '') return
    const payload = joinPayload({ houseId: house.id, inviteSecret: secret.trim() })
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'That is not an invite', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: 'gov-join',
      recipient: contract,
      token: house.token,
      symbol: stake?.symbol ?? 'STRK',
      amount: 0n,
      app: {
        contract,
        op: GOV_OP.join,
        calldata: payload.calldata,
        noteIdSlots: [],
        openNoteCount: 0,
        via: 'compute',
      },
    })
    if (!outcome.ok) return
    toast({
      kind: 'success',
      title: 'You are on the roll',
      detail: 'As an anonymous handle. The public sees the member count move, never a list.',
    })
    onClose()
  }, [house, secret, stake, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Join" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Join {house.metadata || `House ${house.id}`}
        </Text>
        <label className="flex flex-col gap-s4">
          <Text variant="body4" className="uppercase text-neutral3" as="span">
            The invite
          </Text>
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste what the founder handed you"
            aria-label="Invite secret"
            className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
          />
        </label>
        <Text variant="body4" className="text-neutral3">
          Joining escrows nothing and costs only the pool fee. Your seat on the roll is a handle
          the pool derives — anonymous even to the founder.
        </Text>
        <BlockedButton
          blocker={
            sending.stage
              ? 'Working…'
              : (!ready ? 'This browser has no account yet' : null) ??
                (secret.trim() === '' ? 'Paste the invite' : null) ??
                sending.problem
          }
          action="Take my seat"
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}
