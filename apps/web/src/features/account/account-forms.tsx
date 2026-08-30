import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { EXPORT_ROW_DETAIL, EXPORT_ROW_LABEL, LOCK_WHAT_IT_DOES, LOCK_WHAT_IT_DOES_SEALED } from '@strk20/protocol/account-copy'
import { DIRECTORY_NAME_PATTERN, normalizeDirectoryName } from '@strk20/protocol/directory-name'
import { MAX_ACCOUNT_LABEL_LENGTH } from '@strk20/protocol/session-accounts'

import { sessionActions } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { BackupCeremony } from '@/features/onboarding/backup-ceremony'
import { notify } from '@/lib/notify'
import { useDirectoryClaim } from '@/mutations'
import { directoryQuery } from '@/queries'
import {
  FORGET_ACTION,
  FORGET_BODY,
  FORGET_CONFIRM_WORD,
  FORGET_TITLE,
  LABEL_ACTION,
  LABEL_BODY,
  LABEL_TITLE,
  NAME_ACTION,
  NAME_BODY,
  NAME_RULE,
  NAME_TAKEN,
  NAME_TITLE,
  forgetPrompt,
} from './account-copy'

interface FormProps {
  onDone: () => void
}

export function LabelForm({ address, current, onDone }: FormProps & { address: string; current: string | null }) {
  const [label, setLabel] = useState(current ?? '')
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        sessionActions.setLabel(address, label.trim() || null)
        onDone()
      }}
    >
      <div>
        <h3 className="font-display text-display4 uppercase">{LABEL_TITLE}</h3>
        <p className="text-body4 text-muted-foreground">{LABEL_BODY}</p>
      </div>
      <Field>
        <FieldLabel htmlFor="account-label">Label</FieldLabel>
        <Input id="account-label" autoFocus maxLength={MAX_ACCOUNT_LABEL_LENGTH} value={label} onChange={(e) => setLabel(e.target.value)} />
        <FieldDescription>Up to {MAX_ACCOUNT_LABEL_LENGTH} characters. Leave it empty to show the address.</FieldDescription>
      </Field>
      <Button type="submit">{LABEL_ACTION}</Button>
    </form>
  )
}

/** Irreversible: typed confirmation, then every key in this browser is gone. */
export function ForgetForm({ onDone }: FormProps) {
  const [typed, setTyped] = useState('')
  const armed = typed.trim().toLowerCase() === FORGET_CONFIRM_WORD
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!armed) return
        sessionActions.forget()
        onDone()
      }}
    >
      <div>
        <h3 className="font-display text-display4 uppercase text-irreversible">{FORGET_TITLE}</h3>
        <p className="text-body4 text-muted-foreground">{FORGET_BODY}</p>
      </div>
      <Field>
        <FieldLabel htmlFor="forget-confirm">{forgetPrompt(FORGET_CONFIRM_WORD)}</FieldLabel>
        <Input id="forget-confirm" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
      <Button type="submit" variant="destructive" aria-disabled={!armed}>
        <Trash2 data-icon="inline-start" />
        {armed ? FORGET_ACTION : forgetPrompt(FORGET_CONFIRM_WORD)}
      </Button>
    </form>
  )
}

/** Re-issues the ceremony: a fresh file and a fresh code, the old pair still opens the key. */
export function ExportPanel({ onDone }: FormProps) {
  return <BackupCeremony title={EXPORT_ROW_LABEL} body={EXPORT_ROW_DETAIL} onComplete={onDone} />
}

/** Lock / unlock, with the honest sentence for the browser's actual protection. */
export function LockControl({ hasVault, onLocked }: { hasVault: boolean; onLocked: () => void }) {
  const lock = useMutation({
    mutationKey: ['lock'],
    mutationFn: async () => {
      sessionActions.lock()
    },
    onSuccess: onLocked,
  })
  return (
    <div className="flex flex-col gap-2">
      <Alert>
        <AlertDescription>{hasVault ? LOCK_WHAT_IT_DOES_SEALED : LOCK_WHAT_IT_DOES}</AlertDescription>
      </Alert>
      <Button variant="outline" onClick={() => lock.mutate()} aria-disabled={lock.isPending}>
        Lock now
      </Button>
    </div>
  )
}

/**
 * Claiming the public handle.
 *
 * Onboarding has always offered this and then said "you can claim one in Settings" if it failed —
 * where there was nothing to claim it with. This is that missing door, and it is also the only way
 * an account created before the directory existed can get a name.
 */
export function NameForm({ current, onDone }: FormProps & { current: string | null }) {
  const [name, setName] = useState(current ?? '')
  const claim = useDirectoryClaim()
  const directory = useQuery(directoryQuery())
  const clean = normalizeDirectoryName(name)
  const wellFormed = DIRECTORY_NAME_PATTERN.test(clean)
  // Checked against the list we already hold, so a doomed claim never costs a round trip.
  const taken = wellFormed && clean !== current && (directory.data ?? []).some((e) => e.name === clean)
  const problem = name.trim() === '' ? null : !wellFormed ? NAME_RULE : taken ? NAME_TAKEN : null

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!wellFormed || taken || claim.isPending) return
        void claim.mutateAsync({ name: clean }).then((outcome) => {
          if (outcome.ok) {
            notify.settled(`You are @${clean}`, { description: 'Anyone can now find this address by that name.' })
            onDone()
          } else {
            notify.refused('The name was not claimed', { description: outcome.because })
          }
        })
      }}
    >
      <div>
        <h3 className="font-display text-display4 uppercase">{NAME_TITLE}</h3>
        <p className="text-body4 text-muted-foreground">{NAME_BODY}</p>
      </div>
      <Field data-invalid={problem ? true : undefined}>
        <FieldLabel htmlFor="public-name">Public name</FieldLabel>
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <InputGroupText>@</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="public-name"
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={problem ? true : undefined}
          />
        </InputGroup>
        {problem ? <FieldError>{problem}</FieldError> : <FieldDescription>{NAME_RULE}</FieldDescription>}
      </Field>
      <Button type="submit" aria-disabled={!wellFormed || taken || claim.isPending || undefined}>
        {claim.isPending ? 'Claiming…' : NAME_ACTION}
      </Button>
    </form>
  )
}
