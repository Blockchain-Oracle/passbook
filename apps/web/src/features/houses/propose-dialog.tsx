//
// Putting a question to a House, in three steps.
//
// It was one dialog holding eight controls and a single blocker sentence in front of all of them,
// which is a form you fill in by guessing what it wants next. Ask → How it is counted → Review:
// each step fits a screen, each carries its own blocker, and the last one shows what you are about
// to publish before it is published — which nothing did before.
//
// The draft survives a reload (`propose-draft.ts`). A typed question lost to a refresh is the one
// failure this form can have that costs real work.
//
import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { parseAmountInput } from '@strk20/protocol/amount'

import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { SponsorRow, useSponsorChoice } from '@/components/money/sponsor-row'
import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNow } from '@/hooks/use-now'
import { shortAddress } from '@/lib/format'
import { notify } from '@/lib/notify'

import { usePropose } from './create-mutations'
import { houseTitle } from './gov-send'
import { useDoorGate, type DoorProps } from './house-doors'
import {
  EMPTY_DRAFT,
  MAX_QUESTION_CHARS,
  PROPOSE_STEPS,
  STEP_TITLE,
  WINDOWS,
  clearDraft,
  firstIncompleteStep,
  loadDraft,
  saveDraft,
  stepBlocker,
  type ProposeDraft,
  type ProposeStep,
} from './propose-draft'
import { SwitchRow } from './switch-row'
import { useHouseToken } from './use-house-token'

const SEALED = {
  permanent: 'Permanently private: only the aggregate will ever surface.',
  untilClose: 'Sealed until close; the key goes on-chain when the box closes.',
} as const

/** What publishing this puts in public, said before it is published rather than after. */
const WHAT_IS_PUBLIC =
  'The question, its window and every ballot’s weight are public. Each ballot’s choice is sealed to the Teller’s key, ' +
  'and the account that submits this proposal is visible on Starknet.'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <dt className="shrink-0 text-body4 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body3">{value}</dd>
    </div>
  )
}

/** Put a question to a House — a direct call, with the Teller's key minted first. */
export function ProposeDialog({ house, open, onOpenChange }: DoorProps) {
  const token = useHouseToken(house)
  const gate = useDoorGate(token.sessionReady)
  const propose = usePropose()
  // The deadline is computed at submission, so a preview that drifts forward while you type is the
  // honest one. The shared clock rather than `Date.now()` in render.
  const now = useNow(30_000)
  const [draft, setDraft] = useState<ProposeDraft>(EMPTY_DRAFT)
  const [restored, setRestored] = useState(false)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
  const [step, setStep] = useState<ProposeStep>('ask')
  const [wasOpen, setWasOpen] = useState(open)

  // Each opening starts from what was stored, not from what the last opening left in memory.
  // Adjusted during render rather than in an effect — one render instead of two.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const loaded = loadDraft(house.id)
      setDraft(loaded.draft)
      setRestored(loaded.restored)
      setStep('ask')
    }
  }

  const patch = (change: Partial<ProposeDraft>) => {
    const next = { ...draft, ...change }
    setDraft(next)
    setRestored(false)
    saveDraft(house.id, next)
  }

  const reset = () => {
    clearDraft(house.id)
    setDraft(EMPTY_DRAFT)
    setRestored(false)
    setStep('ask')
  }

  const amount = parseAmountInput(draft.amountRaw, token.decimals)
  const busy = propose.isPending
  const sponsor = useSponsorChoice()
  const index = PROPOSE_STEPS.indexOf(step)
  const last = step === 'review'
  const incomplete = firstIncompleteStep(draft, token.decimals)
  // On a step: what that step still wants. On Review: the door's own gate, then the earliest gap.
  const blocker = last ? (gate.blocker ?? (incomplete ? stepBlocker(incomplete, draft, token.decimals) : null)) : stepBlocker(step, draft, token.decimals)
  const closesAt = new Date(now + WINDOWS[draft.windowIdx]!.seconds * 1000)

  const advance = () => {
    if (blocker !== null) {
      // A gap on an earlier step is reachable only defensively, but a dead button is worse than a
      // button that takes you to the field it is complaining about.
      if (last && incomplete && incomplete !== 'review') setStep(incomplete)
      return
    }
    if (!last) {
      setStep(PROPOSE_STEPS[index + 1]!)
      return
    }
    void confirm()
  }

  const confirm = async () => {
    clearRefusal()
    const outcome = await propose.mutateAsync({
      houseId: house.id,
      question: draft.question,
      permanent: draft.permanent,
      abstain: draft.abstain,
      windowSeconds: WINDOWS[draft.windowIdx]!.seconds,
      spend: draft.spend && amount.wei !== null ? { amountWei: amount.wei, recipient: draft.recipient } : null,
      sponsored: sponsor.sponsored,
    })
    if (!outcome.ok) {
      refuse(outcome.because)
      return
    }
    notify.settled('The box is open', { description: draft.permanent ? SEALED.permanent : SEALED.untilClose })
    // Only now: a draft is cleared when it has become a proposal, never when a submission failed.
    clearDraft(house.id)
    setDraft(EMPTY_DRAFT)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <BoundaryBadge kind="revealsInfo" className="w-fit" />
          <DialogTitle className="font-display text-display3 uppercase">Put it to {houseTitle(house)}</DialogTitle>
          <DialogDescription>
            Step {index + 1} of {PROPOSE_STEPS.length} · {STEP_TITLE[step]}
          </DialogDescription>
        </DialogHeader>

        {restored ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
            <p className="text-body4 text-muted-foreground">Picked up where you left off.</p>
            <Button size="sm" variant="ghost" onClick={reset}>
              Start over
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {step === 'ask' ? (
            <>
              <Field>
                <FieldLabel htmlFor="propose-question">The question</FieldLabel>
                <Textarea
                  id="propose-question"
                  value={draft.question}
                  onChange={(e) => patch({ question: e.target.value })}
                  rows={3}
                  placeholder="Pay 40 STRK from the treasury to fund the meetup?"
                  autoFocus
                />
                <FieldDescription>
                  {draft.question.trim().length}/{MAX_QUESTION_CHARS} · public, and permanent
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Window</FieldLabel>
                <ToggleGroup
                  value={[String(draft.windowIdx)]}
                  onValueChange={(v) => {
                    const next = Number(v[0])
                    if (Number.isInteger(next) && WINDOWS[next]) patch({ windowIdx: next })
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
                <FieldDescription>Closes {closesAt.toLocaleString()}</FieldDescription>
              </Field>
            </>
          ) : null}

          {step === 'rules' ? (
            <>
              <div className="flex flex-col gap-2">
                <SwitchRow
                  id="propose-permanent"
                  label="Permanently private"
                  hint="Only the totals ever surface"
                  checked={draft.permanent}
                  onChange={(v) => patch({ permanent: v })}
                />
                <SwitchRow id="propose-abstain" label="Allow abstain" checked={draft.abstain} onChange={(v) => patch({ abstain: v })} />
                <SwitchRow
                  id="propose-spend"
                  label="Treasury spend"
                  hint="Passing it moves money"
                  checked={draft.spend}
                  onChange={(v) => patch({ spend: v })}
                />
              </div>
              {draft.spend ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="propose-amount">Pays ({token.symbol})</FieldLabel>
                    <Input
                      id="propose-amount"
                      value={draft.amountRaw}
                      onChange={(e) => patch({ amountRaw: e.target.value })}
                      inputMode="decimal"
                      className="font-mono"
                      placeholder="0"
                    />
                    {amount.problem ? <FieldDescription className="text-irreversible">{amount.problem}</FieldDescription> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="propose-recipient">To</FieldLabel>
                    <Input
                      id="propose-recipient"
                      value={draft.recipient}
                      onChange={(e) => patch({ recipient: e.target.value })}
                      className="font-mono"
                      placeholder="0x…"
                    />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 'review' ? (
            <>
              <dl className="flex flex-col">
                <Row label="House" value={houseTitle(house)} />
                <Row label="Question" value={<span className="whitespace-pre-wrap">{draft.question.trim()}</span>} />
                <Row label="Closes" value={closesAt.toLocaleString()} />
                <Row label="Ballots" value={draft.permanent ? 'Permanently sealed' : 'Sealed until close'} />
                <Row label="Options" value={draft.abstain ? 'For · Against · Abstain' : 'For · Against'} />
                <Row
                  label="If it passes"
                  value={
                    draft.spend ? (
                      <span className="flex flex-wrap items-baseline justify-end gap-1">
                        <Amount wei={amount.wei} decimals={token.decimals} symbol={token.symbol} size="sm" />
                        <span className="text-muted-foreground">to</span>
                        <span className="font-mono text-mono">{shortAddress(draft.recipient.trim(), 8, 6)}</span>
                      </span>
                    ) : (
                      'Nothing moves — a signal only'
                    )
                  }
                />
              </dl>
              <p className="rounded-lg border bg-inset/40 px-3 py-2 text-body4 text-muted-foreground">{WHAT_IS_PUBLIC}</p>
            </>
          ) : null}
        </div>

        {/* Only on the review step: the earlier ones are not about to submit anything. */}
        {last ? <div className="px-4"><SponsorRow
          offer={{ kind: 'eligible' }}
          allowance={sponsor.allowance}
          loading={sponsor.loading}
          checked={sponsor.want}
          onCheckedChange={sponsor.setWant}
          locked={busy}
        /></div> : null}
        <div className="px-4">
          <RefusalRow refusal={refusal} />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep(PROPOSE_STEPS[index - 1]!)}
            aria-disabled={index === 0 || busy || undefined}
            className={index === 0 ? 'invisible' : undefined}
          >
            <ArrowLeft data-icon="inline-start" aria-hidden />
            Back
          </Button>
          <Button size="lg" aria-disabled={blocker !== null || busy || undefined} onClick={advance}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {blocker ?? (last ? 'Open the box' : 'Next')}
            {blocker === null && !last ? <ArrowRight data-icon="inline-end" aria-hidden /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
