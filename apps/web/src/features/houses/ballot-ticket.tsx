import { useState } from 'react'
import { toast } from 'sonner'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { DISCLOSURE_HEADLINE, GOV_TELLER_PEEK } from '@strk20/protocol/disclosure-copy'
import { GOV_OP, GOV_OPT_AGAINST, GOV_OPT_FOR, ballotPayload } from '@strk20/protocol/governance-calldata'
import { quorumPct, type OnChainHouse, type OnChainProposal } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { sendProblem, useSend } from '@/mutations'
import { appContracts, governanceWrites } from '@/queries'
import { cn } from '@/lib/utils'
import { govLeg, mayHaveLanded, proposalTitle } from './gov-send'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'
import { useHouseToken } from './use-house-token'

export interface BallotTicketProps {
  house: OnChainHouse
  proposal: OnChainProposal
  open: boolean
  onOpenChange: (open: boolean) => void
  initialChoice?: number
}

const ABSTAIN = 2
const CAST_DETAIL = 'Your weight is public; your choice is sealed. Re-vote any time before close — the new ballot replaces this one.'

const OPTIONS = [
  { value: GOV_OPT_FOR, label: 'For', word: 'FOR', tone: 'border-settled text-settled' },
  { value: GOV_OPT_AGAINST, label: 'Against', word: 'AGAINST', tone: 'border-irreversible text-irreversible' },
  { value: ABSTAIN, label: 'Abstain', word: 'ABSTAIN', tone: 'border-foreground text-foreground' },
] as const

/**
 * The ballot — the whole mechanism behind one press. Confirm mints a bearer escrow secret, mints
 * the Pedersen vector for the choice, seals choice+blinds to the proposal's tally key, and sends
 * it as `gov-ballot`. The escrow's claim is stored before the send leaves this browser.
 */
export function BallotTicket({ house, proposal, open, onOpenChange, initialChoice = GOV_OPT_FOR }: BallotTicketProps) {
  const [choice, setChoice] = useState(initialChoice)
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const token = useHouseToken(house)
  const send = useSend()
  const contract = appContracts().governance
  const writes = governanceWrites()

  const parsed = parseAmountInput(raw, token.decimals)
  const weight = token.memberMode ? 1n : parsed.wei
  const short = !token.memberMode && insufficient(parsed.wei, token.available)
  const options = OPTIONS.filter((o) => o.value < proposal.options)
  const picked = options.find((o) => o.value === choice) ?? OPTIONS[0]

  const blocker = !writes.enabled
    ? writes.because
    : !contract
      ? 'The Governance deployment is missing from this build'
      : !token.sessionReady
        ? 'This browser has no account yet'
        : choice < 0 || choice >= proposal.options
          ? 'Pick a side'
          : token.memberMode
            ? null
            : parsed.problem
              ? parsed.problem
              : weight === null || weight === 0n
                ? 'Weigh the ballot — your tokens are the vote'
                : short
                  ? `Not enough shielded ${token.symbol}`
                  : null

  const weightText = token.memberMode ? '1 voice' : `${weight !== null && token.decimals !== null ? toPlainText(weight, token.decimals) : raw} ${token.symbol}`

  const confirm = async () => {
    if (!contract || weight === null) return
    // The crypto trio stays lazy — `governance-commitment`/`-seal` reach `starknet`.
    const [{ mintPositionSecret }, { mintBallotVector }, { sealBallot }] = await Promise.all([
      import('@strk20/protocol/commitment'),
      import('@strk20/protocol/governance-commitment'),
      import('@strk20/protocol/governance-seal'),
    ])
    const escrow = token.memberMode ? null : mintPositionSecret()
    const vector = mintBallotVector(weight, choice, proposal.options)
    const sealed = await sealBallot({ choice, weight, blinds: vector.blinds }, proposal.tallyKey)
    const points = []
    for (const point of vector.vector) {
      if (point === null) {
        toast.error('The ballot was refused', { description: 'A ballot commitment cannot be the identity point.' })
        return
      }
      points.push(point)
    }
    const payload = ballotPayload({
      houseId: house.id,
      proposalId: proposal.id,
      newTotalWeight: weight,
      reclaimCommitment: escrow?.commitment ?? null,
      drawPot: false,
      vector: points,
      sealed,
    })
    if (payload.state === 'refused') {
      toast.error('The ballot was refused', { description: payload.because })
      return
    }
    if (escrow) {
      // The secret IS the escrow. Written first, so a landed ballot can never outrun its record.
      await addStoredPosition({
        venue: 'governance',
        kind: 'gov-ballot',
        id: proposal.id,
        houseId: house.id,
        secret: escrow.secret,
        commitment: escrow.commitment,
        createdAt: Date.now(),
        label: `Ballot on “${proposalTitle(proposal).slice(0, 40)}” · ${weightText} escrowed`,
      })
    }
    const result = await send.mutateAsync({
      kind: 'gov-ballot',
      recipient: contract,
      token: house.token,
      symbol: token.symbol,
      // A member ballot escrows nothing — the value-less arm the planner carries for exactly this.
      amount: token.memberMode ? 0n : weight,
      surface: 'houses',
      app: govLeg(contract, GOV_OP.ballot, payload, { via: 'compute' }),
    })
    if (result.ok) {
      if (escrow) await relabelStoredPosition(escrow.commitment, { txHash: result.transactionHash })
      toast.success('Ballot cast', { description: CAST_DETAIL })
      setReviewing(false)
      onOpenChange(false)
      setRaw('')
      return
    }
    if (escrow && !mayHaveLanded(result)) await removeStoredPosition(escrow.commitment)
    toast.error(sendProblem(result) ?? 'The ballot could not be cast.')
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="bearer" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">{proposalTitle(proposal)}</DialogTitle>
            <DialogDescription>Sealed ballot · quorum {quorumPct(proposal)}%</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <ToggleGroup
              value={[String(choice)]}
              onValueChange={(value) => {
                const next = Number(value[0])
                if (Number.isInteger(next)) setChoice(next)
              }}
              variant="outline"
              className={cn('grid', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
            >
              {options.map((o) => (
                <ToggleGroupItem key={o.value} value={String(o.value)} className={cn('h-11', choice === o.value && o.tone)}>
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {token.memberMode ? (
              <p className="text-body3 text-muted-foreground">One member, one vote — your ballot counts once, and nothing escrows.</p>
            ) : (
              <>
                <AssetIdentity symbol={token.symbol} logoUri={token.logoUri} boundary="shielded" />
                <MoneyField
                  label="Weight — escrowed until close"
                  value={raw}
                  onChange={setRaw}
                  symbol={token.symbol}
                  decimals={token.decimals}
                  available={token.available}
                  boundary="shielded"
                  onMax={token.available !== null && token.decimals !== null ? () => setRaw(toPlainText(token.available!, token.decimals!)) : undefined}
                  problem={parsed.problem ?? (short ? `Not enough shielded ${token.symbol}` : null)}
                  autoFocus
                />
              </>
            )}
            <p className="text-body4 text-muted-foreground">{DISCLOSURE_HEADLINE['gov-ballot']}</p>
          </div>
          <DialogFooter>
            <Button
              size="lg"
              aria-disabled={blocker !== null || undefined}
              onClick={() => {
                if (blocker === null) setReviewing(true)
              }}
            >
              {blocker ?? `Review · ${picked.word} · ${weightText}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false)
        }}
        title="Cast sealed ballot"
        description={proposalTitle(proposal)}
        boundary="bearer"
        rows={[
          { label: 'Choice', value: `${picked.word} (sealed)` },
          { label: 'Weight', value: token.memberMode ? '1 voice' : <Amount wei={weight} decimals={token.decimals} symbol={token.symbol} size="sm" /> },
          { label: 'Escrow', value: token.memberMode ? 'none' : 'until the box closes' },
        ]}
        disclosure={disclosureFor('gov-ballot')}
        confirmLabel={`Cast ${picked.word}, sealed`}
        onConfirm={() => void confirm()}
        busy={send.isPending}
        blocker={blocker}
      >
        <p className="text-body4 text-muted-foreground">{GOV_TELLER_PEEK}</p>
      </ReviewSheet>
    </>
  )
}
