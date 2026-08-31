import { useState } from 'react'
import { notify } from '@/lib/notify'
import { useRefusal } from '@/components/money/refusal'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { DISCLOSURE_HEADLINE } from '@strk20/protocol/disclosure-copy'
import { GOV_OP, delegatePayload } from '@strk20/protocol/governance-calldata'

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
import { shortAddress } from '@/lib/format'
import { govLeg, houseTitle, mayHaveLanded } from './gov-send'
import { useDoorGate, type DoorProps } from './house-doors'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'
import { useHouseToken } from './use-house-token'

/**
 * Delegate weight to another member's handle. The tokens escrow behind a bearer commitment, so
 * the position is stored first and revoked later through `gov-revoke`.
 */
export function DelegateDialog({ house, open, onOpenChange, initialDelegate }: DoorProps & { initialDelegate?: string }) {
  // Seeded once: the handle arrives from a chat card through the route, and is then just the field's value.
  const [delegate, setDelegate] = useState(initialDelegate ?? '')
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
  const token = useHouseToken(house)
  const send = useSend()
  const gate = useDoorGate(token.sessionReady)
  const parsed = parseAmountInput(raw, token.decimals)
  const short = insufficient(parsed.wei, token.available)
  const handle = delegate.trim()
  let handleOk = false
  try {
    handleOk = handle !== '' && BigInt(handle) > 0n
  } catch {
    handleOk = false
  }
  const blocker =
    gate.blocker ??
    (token.memberMode
      ? 'A one-member-one-vote DAO has no weight to delegate'
      : handle === ''
        ? 'Enter their handle'
        : !handleOk
          ? 'That is not a handle'
          : parsed.problem
            ? parsed.problem
            : parsed.wei === null || parsed.wei === 0n
              ? 'Enter the weight to delegate'
              : short
                ? `Not enough shielded ${token.symbol}`
                : null)
  const amountText = parsed.wei !== null && token.decimals !== null ? toPlainText(parsed.wei, token.decimals) : raw

  const confirm = async (sponsored: boolean) => {
    if (!gate.contract || parsed.wei === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const escrow = mintPositionSecret()
    const payload = delegatePayload({ houseId: house.id, delegate: handle, amount: parsed.wei, reclaimCommitment: escrow.commitment })
    if (payload.state === 'refused') {
      refuse(payload.because)
      return
    }
    // The secret IS the escrow. Stored first, so a landed delegation can never outrun its record.
    await addStoredPosition({
      venue: 'governance',
      kind: 'gov-delegation',
      id: house.id,
      houseId: house.id,
      secret: escrow.secret,
      commitment: escrow.commitment,
      createdAt: Date.now(),
      label: `Delegated ${amountText} ${token.symbol} in ${houseTitle(house)} to ${shortAddress(handle)}`,
    })
    const result = await send.mutateAsync({
      kind: 'gov-delegate',
      sponsored,
      recipient: gate.contract,
      token: house.token,
      symbol: token.symbol,
      amount: parsed.wei,
      surface: 'houses',
      app: govLeg(gate.contract, GOV_OP.delegate, payload, { via: 'compute' }),
    })
    if (result.ok) {
      await relabelStoredPosition(escrow.commitment, { txHash: result.transactionHash })
      notify.settled('Weight delegated', {
        description: 'Revoke it any time from your positions — the escrow comes back as a fresh note.',
        hash: sendTransactionHash(result),
      })
      setReviewing(false)
      onOpenChange(false)
      setRaw('')
      return
    }
    if (!mayHaveLanded(result)) await removeStoredPosition(escrow.commitment)
    refuse(sendProblem(result) ?? 'The delegation did not go through.', sendTransactionHash(result))
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="bearer" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Delegate in {houseTitle(house)}</DialogTitle>
            <DialogDescription>{DISCLOSURE_HEADLINE['gov-delegate']}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="house-delegate">Delegate’s handle</FieldLabel>
              <Input id="house-delegate" value={delegate} onChange={(e) => setDelegate(e.target.value)} placeholder="0x…" className="font-mono" autoFocus />
              <FieldDescription>
                Not an address — the pool-derived handle on this roll. Ask them for it: they read it on this House’s page,
                under “Your handle on this roll”.
              </FieldDescription>
            </Field>
            <AssetIdentity symbol={token.symbol} logoUri={token.logoUri} boundary="shielded" />
            <MoneyField
              label="Weight — escrowed until you revoke"
              value={raw}
              onChange={setRaw}
              symbol={token.symbol}
              decimals={token.decimals}
              available={token.available}
              boundary="shielded"
              onMax={token.available !== null && token.decimals !== null ? () => setRaw(toPlainText(token.available!, token.decimals!)) : undefined}
              problem={parsed.problem ?? (short ? `Not enough shielded ${token.symbol}` : null)}
            />
          </div>
          <DialogFooter>
            <Button size="lg" aria-disabled={blocker !== null || undefined} onClick={() => {
              if (blocker === null) {
                clearRefusal()
                setReviewing(true)
              }
            }}>
              {blocker ?? `Review · ${amountText} ${token.symbol}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => !next && setReviewing(false)}
        title="Delegate weight"
        description={houseTitle(house)}
        boundary="bearer"
        rows={[
          { label: 'To', value: shortAddress(handle) },
          { label: 'Weight', value: <Amount wei={parsed.wei} decimals={token.decimals} symbol={token.symbol} size="sm" /> },
        ]}
        disclosure={disclosureFor('gov-delegate')}
        confirmLabel={`Delegate ${amountText} ${token.symbol}`}
        sponsor={{ kind: 'eligible' }}
        onConfirm={(sponsored) => void confirm(sponsored)}
        busy={send.isPending}
        blocker={blocker}
        problem={refusal}
      />
    </>
  )
}
