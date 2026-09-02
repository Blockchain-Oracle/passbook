// The Custody step: mint the key, then seal it — under a password, a passkey, both, or neither.
// Two independent switches on purpose: unprotected stays a choice (`session-store.ts` insists),
// and a phone passkey is a real second factor next to a password, not a replacement for one.
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Fingerprint, KeyRound } from 'lucide-react'
import { PASSWORD_BODY, PASSWORD_MISMATCH, PASSWORD_NO_RESET } from '@strk20/protocol/account-copy'
import { CUSTODY_BODY, CUSTODY_CTA, CUSTODY_TITLE } from '@strk20/protocol/onboarding-copy'
import { CUSTODY_PASSKEY_BODY, CUSTODY_PASSKEY_LABEL, CUSTODY_PASSKEY_PROMPTS, PASSKEY_ERROR_TEXT } from '@strk20/protocol/passkey-copy'
import { MIN_PASSWORD_LENGTH } from '@strk20/protocol/session-vault'

import { getSessionSnapshot, sessionActions } from '@/app/session'
import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { passkeySupport } from '@/lib/passkey-ceremony'
import { PasswordField } from './password-field'

interface CustodyAsk {
  label: string | null
  password: string | null
  passkey: boolean
}

/**
 * Mints the key; labels it; seals it. One press, in that order — and idempotent on the key: a
 * retry after a closed passkey prompt must not mint a second account.
 */
async function generateKey(ask: CustodyAsk): Promise<void> {
  if (getSessionSnapshot().status !== 'ready') await sessionActions.createAccount()
  const snapshot = getSessionSnapshot()
  if (ask.label && snapshot.address && snapshot.label !== ask.label) sessionActions.setLabel(snapshot.address, ask.label)
  if (ask.password && !snapshot.protection?.password) {
    const sealed = await sessionActions.setPassword(ask.password)
    if (!sealed.ok) throw new Error(sealed.error)
  }
  if (ask.passkey && !getSessionSnapshot().protection?.passkey) {
    const sealed = await sessionActions.protectWithPasskey()
    if (!sealed.ok) throw new Error(sealed.error)
  }
}

function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-display3 uppercase">{title}</h2>
      {body ? <p className="text-body3 text-muted-foreground">{body}</p> : null}
    </div>
  )
}

export function CustodyScreen({ label, onNext }: { label: string | null; onNext: () => void }) {
  const [wantPassword, setWantPassword] = useState(false)
  const [wantPasskey, setWantPasskey] = useState(false)
  const [support, setSupport] = useState<'unknown' | 'unsupported' | 'available'>('unknown')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { refusal, refuse, clear } = useRefusal()
  const mutation = useMutation({
    mutationKey: ['generate-key'],
    mutationFn: generateKey,
    onSuccess: onNext,
    onError: (e) => refuse(e.message),
  })

  useEffect(() => {
    void passkeySupport().then(setSupport)
  }, [])

  const mismatch = wantPassword && confirm !== '' && confirm !== password
  const blocker = !wantPassword
    ? null
    : password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : mismatch || confirm === ''
        ? PASSWORD_MISMATCH
        : null
  const passkeyBlocked = wantPasskey && support === 'unsupported'

  return (
    <div className="flex flex-col gap-6">
      <Heading title={CUSTODY_TITLE} body={CUSTODY_BODY} />
      <Field orientation="horizontal">
        <Switch id="custody-password" checked={wantPassword} onCheckedChange={(v) => { setWantPassword(v); clear() }} />
        <div>
          <FieldLabel htmlFor="custody-password">Protect this browser with a password</FieldLabel>
          <FieldDescription>{PASSWORD_BODY}</FieldDescription>
        </div>
      </Field>
      {wantPassword ? (
        <div className="flex flex-col gap-4 border-l-2 border-primary pl-4">
          <PasswordField id="custody-pw" label="New password" autoComplete="new-password" autoFocus meter value={password} onChange={setPassword} hint={PASSWORD_NO_RESET} />
          <PasswordField id="custody-pw2" label="Confirm password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={mismatch ? PASSWORD_MISMATCH : null} />
        </div>
      ) : null}
      <Field orientation="horizontal">
        <Switch id="custody-passkey" checked={wantPasskey} onCheckedChange={(v) => { setWantPasskey(v); clear() }} />
        <div>
          <FieldLabel htmlFor="custody-passkey">{CUSTODY_PASSKEY_LABEL}</FieldLabel>
          <FieldDescription>{CUSTODY_PASSKEY_BODY}</FieldDescription>
          {wantPasskey && support === 'available' ? <FieldDescription>{CUSTODY_PASSKEY_PROMPTS}</FieldDescription> : null}
          {passkeyBlocked ? <p className="text-body4 text-irreversible">{PASSKEY_ERROR_TEXT.unsupported}</p> : null}
        </div>
      </Field>
      <RefusalRow refusal={refusal} />
      {/* Never `disabled`: blocked, it stays pressable and says why — inline, under the field. */}
      <Button
        size="lg"
        className="h-12 self-start text-buttonLabel2"
        aria-disabled={mutation.isPending || blocker !== null || passkeyBlocked}
        onClick={() => !mutation.isPending && blocker === null && !passkeyBlocked && mutation.mutate({ label, password: wantPassword ? password : null, passkey: wantPasskey })}
      >
        {mutation.isPending ? <Spinner data-icon="inline-start" /> : wantPasskey ? <Fingerprint data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {mutation.isPending ? 'Making your key…' : CUSTODY_CTA}
      </Button>
      {blocker && !mismatch ? <p className="-mt-3 text-body4 text-muted-foreground">{blocker}</p> : null}
    </div>
  )
}
