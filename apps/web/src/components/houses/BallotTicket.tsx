//
// The ballot — the whole mechanism behind one press, honestly labelled.
//
// Confirm does five things in the lazy graph: mints a bearer escrow secret, mints the Pedersen
// vector for the choice, seals choice+blinds to the proposal's tally key, lays the payload out,
// and sends it as the `gov-ballot` kind — the ComputeAndInvoke ride where the POOL injects the
// anonymous voter handle. The weight is escrowed until close; the stored position is the claim.
//
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { confidenceOf, toPlainText } from '@strk20/protocol/amount'
import { GOV_OP, GOV_OPT_AGAINST, GOV_OPT_FOR, ballotPayload } from '@strk20/protocol/governance-calldata'
import {
  HOUSE_COUNTING,
  quorumPct,
  type OnChainHouse,
  type OnChainProposal,
} from '@strk20/protocol/governance-reads'
import { DISCLOSURE_HEADLINE } from '@strk20/protocol/disclosure-copy'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../../shell/pool-health'
import { toast } from '../../shell/toast-store'
import { useBalance } from '../../shell/use-balance'
import { addPosition } from '../../shell/use-positions'
import { stageLabels } from '../../shell/stage-labels'
import { useSend } from '../../shell/use-send'
import { useSession, shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { AmountInput, useAmountField } from '../AmountInput'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'

const STAGE_LABEL: Record<string, string> = stageLabels('Building the ballot…')

export function BallotTicket({
  house,
  proposal,
  open,
  initialChoice = GOV_OPT_FOR,
  onClose,
}: {
  house: OnChainHouse
  proposal: OnChainProposal
  open: boolean
  initialChoice?: number
  onClose: () => void
}) {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const stake = findToken(tokens, house.token)
  const symbol = stake?.symbol ?? shortenFelt(house.token, 4, 3)
  const decimals = stake?.decimals ?? 18

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const memberMode = house.counting === HOUSE_COUNTING.member
  const [choice, setChoice] = useState(initialChoice)

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

  const weight = memberMode ? 1n : amount.wei

  const blocker =
    currentBlocker(health) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (choice < 0 || choice >= proposal.options ? 'Pick a side' : null) ??
    (memberMode
      ? null
      : ((amount.problem ?? null) ??
        (weight === null || weight === 0n ? 'Weigh the ballot — your tokens are the vote' : null) ??
        (amount.short ? `Not enough shielded ${symbol}` : null)))

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.governance
    if (!contract || !ready || weight === null || (weight === 0n && !memberMode)) return

    // The crypto trio stays lazy — `governance-commitment`/`-seal` reach `starknet` and
    // Poseidon, banned from the eager chunks. The payload builder is pure and rides statically.
    const [{ mintPositionSecret }, { mintBallotVector }, { sealBallot }] = await Promise.all([
      import('@strk20/protocol/commitment'),
      import('@strk20/protocol/governance-commitment'),
      import('@strk20/protocol/governance-seal'),
    ])

    const escrow = memberMode ? null : mintPositionSecret()
    const vector = mintBallotVector(weight, choice, proposal.options)
    const sealed = await sealBallot({ choice, weight, blinds: vector.blinds }, proposal.tallyKey)
    const payload = ballotPayload({
      houseId: house.id,
      proposalId: proposal.id,
      newTotalWeight: weight,
      reclaimCommitment: escrow?.commitment ?? null,
      drawPot: false,
      vector: vector.vector.map((point) => {
        if (point === null) throw new Error('a ballot commitment cannot be the identity point')
        return point
      }),
      sealed,
    })
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'The ballot was refused', detail: payload.because })
      return
    }

    const outcome = await sending.send({
      kind: 'gov-ballot',
      recipient: contract,
      token: house.token,
      symbol,
      // A member ballot escrows nothing — the value-less arm the planner carries for exactly this.
      amount: memberMode ? 0n : weight,
      app: {
        contract,
        op: GOV_OP.ballot,
        calldata: payload.calldata,
        noteIdSlots: [],
        openNoteCount: 0,
        via: 'compute',
      },
    })
    if (!outcome.ok) return

    if (escrow) {
      // The escrow's claim, stored before anything dismissible — the markets' rule.
      addPosition({
        venue: 'governance',
        id: proposal.id,
        secret: escrow.secret,
        commitment: escrow.commitment,
        createdAt: Date.now(),
        label: `Ballot on “${proposal.metadata.slice(0, 40) || `Proposal ${proposal.id}`}” · ${toPlainText(weight, decimals)} ${symbol} escrowed`,
        txHash: outcome.transactionHash,
      })
    }
    toast({
      kind: 'success',
      title: 'Ballot cast',
      detail:
        'Your weight is public; your choice is sealed. Re-vote any time before close — the new ballot replaces this one.',
    })
    onClose()
  }, [ready, weight, choice, memberMode, house, proposal, symbol, decimals, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Ballot" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <div className="flex flex-col gap-s2">
          <Text variant="kicker">Sealed ballot · quorum {quorumPct(proposal)}%</Text>
          <Text variant="subheading2" as="h2" className="text-neutral1">
            {proposal.metadata || `Proposal ${proposal.id}`}
          </Text>
        </div>

        <div className="flex gap-s6">
          {[
            { value: GOV_OPT_FOR, label: 'For', tone: 'text-settled', active: 'border-settled bg-settledTint' },
            { value: GOV_OPT_AGAINST, label: 'Against', tone: 'text-irreversible', active: 'border-irreversible bg-irreversibleTint' },
            ...(proposal.options > 2
              ? [{ value: 2, label: 'Abstain', tone: 'text-neutral2', active: 'border-neutral3 bg-inset' }]
              : []),
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setChoice(option.value)}
              aria-pressed={choice === option.value}
              className={cn(
                'focus-ring flex-1 cursor-pointer rounded-control border border-solid py-s12 text-buttonLabel3',
                option.tone,
                choice === option.value ? option.active : 'border-surface3 bg-transparent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {memberMode ? (
          <Text variant="body3" className="text-neutral2">
            One member, one vote — your ballot counts once, and nothing escrows.
          </Text>
        ) : (
          <AmountInput
            field={amount}
            symbol={symbol}
            balance={
              heldWei !== null && balance
                ? {
                    value: `${toPlainText(heldWei, decimals)} ${symbol}`,
                    confidence: confidenceOf(balance),
                  }
                : null
            }
            label="Weight — the tokens that ARE this ballot, escrowed until close"
          />
        )}

        <Text variant="body4" className="text-neutral3">
          {DISCLOSURE_HEADLINE['gov-ballot']}
        </Text>

        <BlockedButton
          blocker={sending.stage ? (STAGE_LABEL[sending.stage] ?? 'Working…') : (blocker ?? sending.problem)}
          action={choice === GOV_OPT_FOR ? 'Cast FOR, sealed' : choice === GOV_OPT_AGAINST ? 'Cast AGAINST, sealed' : 'Cast ABSTAIN, sealed'}
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}
