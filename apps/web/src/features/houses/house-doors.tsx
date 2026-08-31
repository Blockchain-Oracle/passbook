import { useState } from 'react'
import { notify } from '@/lib/notify'
import { useRefusal } from '@/components/money/refusal'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { DISCLOSURE_HEADLINE } from '@strk20/protocol/disclosure-copy'
import { GOV_OP, fundPayload, joinPayload } from '@strk20/protocol/governance-calldata'
import type { OnChainHouse } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { sendProblem, sendTransactionHash, useSend } from '@/mutations'
import { appContracts, governanceWrites } from '@/queries'
import { govLeg, houseTitle } from './gov-send'
import { useHouseToken } from './use-house-token'

export interface DoorProps {
  house: OnChainHouse
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A door that is shut still has to say so.
 *
 * Every governance button was written `onClick={() => enabled && open()}` with a label that did not
 * change when `enabled` was false — so a blocked door looked live, swallowed the click, and said
 * nothing at all. "I click Create and nothing happens" is that bug, and silence is the worst
 * possible reading of a refusal: it is indistinguishable from the app being broken.
 *
 * The rule now: a blocked door raises its reason. It never just declines to act.
 */
export function shutDoor(because: string): void {
  notify.warned('That door is closed right now', { description: because })
}

/** Common gate for every door: writes verified, contract present, an account to sign. */
export function useDoorGate(sessionReady: boolean): { contract: string | null; blocker: string | null } {
  const writes = governanceWrites()
  const contract = appContracts().governance ?? null
  // The CTA gets the short word; `WritesBlocked` on the list and record pages carries the sentence.
  const blocker = !writes.enabled
    ? writes.blocker
    : !contract
      ? 'The Governance deployment is missing from this build'
      : !sessionReady
        ? 'This browser has no account yet'
        : null
  return { contract, blocker }
}

/** Fund the treasury: given, not lent. Amount public; no commitment, no way back. */
export function FundDialog({ house, open, onOpenChange }: DoorProps) {
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
  const token = useHouseToken(house)
  const send = useSend()
  const gate = useDoorGate(token.sessionReady)
  const parsed = parseAmountInput(raw, token.decimals)
  const short = insufficient(parsed.wei, token.available)
  const blocker =
    gate.blocker ??
    (parsed.problem ? parsed.problem : parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : short ? `Not enough shielded ${token.symbol}` : null)
  const amountText = parsed.wei !== null && token.decimals !== null ? toPlainText(parsed.wei, token.decimals) : raw

  const confirm = async (sponsored: boolean) => {
    if (!gate.contract || parsed.wei === null) return
    const payload = fundPayload({ houseId: house.id, amount: parsed.wei })
    if (payload.state === 'refused') {
      refuse(payload.because)
      return
    }
    const result = await send.mutateAsync({
      kind: 'gov-fund',
      sponsored,
      recipient: gate.contract,
      token: house.token,
      symbol: token.symbol,
      amount: parsed.wei,
      surface: 'houses',
      app: govLeg(gate.contract, GOV_OP.fund, payload),
    })
    if (result.ok) {
      notify.settled('The treasury grew', {
        description: `${amountText} ${token.symbol} is now the DAO's, in public.`,
        hash: sendTransactionHash(result),
      })
      setReviewing(false)
      onOpenChange(false)
      setRaw('')
      return
    }
    refuse(sendProblem(result) ?? 'The treasury was not funded.', sendTransactionHash(result))
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="revealsInfo" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Fund {houseTitle(house)}</DialogTitle>
            <DialogDescription>{DISCLOSURE_HEADLINE['gov-fund']}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <AssetIdentity symbol={token.symbol} logoUri={token.logoUri} boundary="shielded" />
            <MoneyField
              label="Gift"
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
          </div>
          <DialogFooter>
            <Button size="lg" aria-disabled={blocker !== null || undefined} onClick={() => {
                if (blocker === null) {
                  clearRefusal()
                  setReviewing(true)
                }
              }}>
              {blocker ?? `Review gift · ${amountText} ${token.symbol}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => !next && setReviewing(false)}
        title="Fund the treasury"
        description={houseTitle(house)}
        boundary="revealsInfo"
        rows={[
          { label: 'Gift', value: <Amount wei={parsed.wei} decimals={token.decimals} symbol={token.symbol} size="sm" /> },
          { label: 'Treasury now', value: <Amount wei={house.treasury} decimals={token.decimals} symbol={token.symbol} size="sm" /> },
        ]}
        disclosure={disclosureFor('gov-fund')}
        confirmLabel={`Give ${amountText} ${token.symbol}`}
        sponsor={{ kind: 'eligible' }}
        onConfirm={(sponsored) => void confirm(sponsored)}
        busy={send.isPending}
        blocker={blocker}
        problem={refusal}
      />
    </>
  )
}

/** Join with the door key: zero-value, the identity is the whole payload. */
export function JoinDialog({ house, open, onOpenChange }: DoorProps) {
  const [invite, setInvite] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
  const token = useHouseToken(house)
  const send = useSend()
  const gate = useDoorGate(token.sessionReady)
  const trimmed = invite.trim()
  let inviteOk = false
  try {
    inviteOk = trimmed !== '' && BigInt(trimmed) > 0n
  } catch {
    inviteOk = false
  }
  const blocker = gate.blocker ?? (trimmed === '' ? 'Paste the invite' : !inviteOk ? 'That is not a door key' : null)

  const confirm = async (sponsored: boolean) => {
    if (!gate.contract) return
    const payload = joinPayload({ houseId: house.id, inviteSecret: trimmed })
    if (payload.state === 'refused') {
      refuse(payload.because)
      return
    }
    const result = await send.mutateAsync({
      kind: 'gov-join',
      sponsored,
      recipient: gate.contract,
      token: house.token,
      symbol: token.symbol,
      amount: 0n,
      surface: 'houses',
      app: govLeg(gate.contract, GOV_OP.join, payload, { via: 'compute' }),
    })
    if (result.ok) {
      notify.settled('You are on the roll', { description: DISCLOSURE_HEADLINE['gov-join'], hash: sendTransactionHash(result) })
      setReviewing(false)
      onOpenChange(false)
      setInvite('')
      return
    }
    refuse(sendProblem(result) ?? 'The join did not go through.', sendTransactionHash(result))
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="readOnly" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Join {houseTitle(house)}</DialogTitle>
            <DialogDescription>{DISCLOSURE_HEADLINE['gov-join']}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="house-invite">The door key</FieldLabel>
            <Input id="house-invite" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="0x…" className="font-mono" autoFocus />
            <FieldDescription>The founder handed this out. The chain holds only its fingerprint.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button size="lg" aria-disabled={blocker !== null || undefined} onClick={() => {
                if (blocker === null) {
                  clearRefusal()
                  setReviewing(true)
                }
              }}>
              {blocker ?? 'Review join'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => !next && setReviewing(false)}
        title="Join the roll"
        description={houseTitle(house)}
        boundary="readOnly"
        rows={[
          { label: 'DAO', value: `#${house.id}` },
          { label: 'Members now', value: String(house.memberCount) },
        ]}
        disclosure={disclosureFor('gov-join')}
        confirmLabel="Join, as a derived handle"
        sponsor={{ kind: 'eligible' }}
        onConfirm={(sponsored) => void confirm(sponsored)}
        busy={send.isPending}
        blocker={blocker}
        problem={refusal}
      />
    </>
  )
}
