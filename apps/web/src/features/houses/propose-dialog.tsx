import { useState } from 'react'
import { toast } from 'sonner'
import { parseAmountInput } from '@strk20/protocol/amount'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { usePropose } from './create-mutations'
import { houseTitle } from './gov-send'
import { useDoorGate, type DoorProps } from './house-doors'
import { useHouseToken } from './use-house-token'

const WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '1 hour — demo', seconds: 3_600 },
] as const

/** Put a question to a House — a direct call, with the Teller's key minted first. */
export function ProposeDialog({ house, open, onOpenChange }: DoorProps) {
  const token = useHouseToken(house)
  const gate = useDoorGate(token.sessionReady)
  const propose = usePropose()
  const [question, setQuestion] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [abstain, setAbstain] = useState(false)
  const [windowIdx, setWindowIdx] = useState(0)
  const [spend, setSpend] = useState(false)
  const [amountRaw, setAmountRaw] = useState('')
  const [recipient, setRecipient] = useState('')

  const amount = parseAmountInput(amountRaw, token.decimals)
  let recipientOk = false
  try {
    recipientOk = recipient.trim() !== '' && BigInt(recipient.trim()) > 0n
  } catch {
    recipientOk = false
  }
  const busy = propose.isPending
  const blocker =
    gate.blocker ??
    (question.trim() === ''
      ? 'Ask the question'
      : question.trim().length > 400
        ? 'Four hundred characters at most'
        : spend && (amount.problem || amount.wei === null || amount.wei === 0n)
          ? (amount.problem ?? 'How much the treasury pays')
          : spend && !recipientOk
            ? 'Who the treasury pays — a real address'
            : busy
              ? 'Proposing…'
              : null)

  const confirm = async () => {
    if (blocker !== null) return
    const outcome = await propose.mutateAsync({
      houseId: house.id,
      question,
      permanent,
      abstain,
      windowSeconds: WINDOWS[windowIdx]!.seconds,
      spend: spend && amount.wei !== null ? { amountWei: amount.wei, recipient } : null,
    })
    if (!outcome.ok) {
      toast.error('The proposal was not made', { description: outcome.because })
      return
    }
    toast.success('The box is open', {
      description: permanent ? 'Permanently private: only the aggregate will ever surface.' : 'Sealed until close; the key goes on-chain when the box closes.',
    })
    setQuestion('')
    setAmountRaw('')
    setRecipient('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <BoundaryBadge kind="revealsInfo" className="w-fit" />
          <DialogTitle className="font-display text-display3 uppercase">Put it to {houseTitle(house)}</DialogTitle>
          <DialogDescription>The question and its window are public. Every ballot's choice will be sealed to the Teller's key.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="propose-question">The question</FieldLabel>
            <Textarea
              id="propose-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="Pay 40 STRK from the treasury to fund the meetup?"
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>Window</FieldLabel>
            <ToggleGroup
              value={[String(windowIdx)]}
              onValueChange={(v) => {
                const next = Number(v[0])
                if (Number.isInteger(next) && WINDOWS[next]) setWindowIdx(next)
              }}
              variant="outline"
              className="flex flex-wrap"
            >
              {WINDOWS.map((w, i) => (
                <ToggleGroupItem key={w.label} value={String(i)}>
                  {w.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SwitchRow id="propose-permanent" label="Permanently private" checked={permanent} onChange={setPermanent} />
            <SwitchRow id="propose-abstain" label="Allow abstain" checked={abstain} onChange={setAbstain} />
            <SwitchRow id="propose-spend" label="Treasury spend" checked={spend} onChange={setSpend} />
          </div>
          {spend ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="propose-amount">Pays ({token.symbol})</FieldLabel>
                <Input id="propose-amount" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} inputMode="decimal" className="font-mono" placeholder="0" />
                {amount.problem ? <FieldDescription className="text-irreversible">{amount.problem}</FieldDescription> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="propose-recipient">To</FieldLabel>
                <Input id="propose-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="font-mono" placeholder="0x…" />
              </Field>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button size="lg" aria-disabled={blocker !== null || undefined} onClick={() => void confirm()}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {blocker ?? 'Open the box'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SwitchRow({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2">
      <div className="flex flex-col">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  )
}
