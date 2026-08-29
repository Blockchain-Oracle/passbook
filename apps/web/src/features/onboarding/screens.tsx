import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, FileKey, KeyRound, ShieldCheck, Wallet } from 'lucide-react'
import { IMPORT_ENTRY_CTA, PASSWORD_BODY, PASSWORD_MISMATCH, PASSWORD_NO_RESET } from '@strk20/protocol/account-copy'
import {
  CUSTODY_BODY,
  CUSTODY_CTA,
  CUSTODY_TITLE,
  NAME_CAPTION,
  NAME_CLAIM_NOTE,
  NAME_CLAIM_OPT_IN,
  NAME_CTA,
  NAME_PLACEHOLDER,
  NAME_TITLE,
  namePreview,
} from '@strk20/protocol/onboarding-copy'
import { MIN_PASSWORD_LENGTH, passwordStrength } from '@strk20/protocol/session-vault'

import { BOUNDARY } from '@/app/boundary'
import { getSessionSnapshot, sessionActions } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <div>
      <h2 className="font-display text-display3 uppercase">{title}</h2>
      {body ? <p className="mt-1 text-body3 text-muted-foreground">{body}</p> : null}
    </div>
  )
}

/** Screen one: a private wallet is activated here, or an existing one is brought in. */
export function ForkScreen({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-kicker uppercase text-muted-foreground">strk20.run</p>
        <h1 className="font-display text-display2 uppercase md:text-display1">Private money that behaves like money</h1>
        <p className="mt-2 max-w-prose text-body2 text-muted-foreground">
          The key that reads your balance and signs your spending is made in this browser. Nothing here signs you in.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="h-12 flex-1 text-buttonLabel2" onClick={onCreate}>
          <Wallet data-icon="inline-start" />
          Create a new wallet
        </Button>
        <Button size="lg" variant="outline" className="h-12 flex-1 text-buttonLabel2" onClick={onImport}>
          <FileKey data-icon="inline-start" />
          {IMPORT_ENTRY_CTA}
        </Button>
      </div>
    </div>
  )
}

/** "Two balances. One wallet." — the one idea a new user must hold before anything else. */
export function TeachScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Heading title="Two balances. One wallet." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-2 border-shielded">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-display4 uppercase">
              <ShieldCheck className="size-5 text-shielded" aria-hidden />
              Shielded
            </CardTitle>
          </CardHeader>
          <CardContent className="text-body3 text-muted-foreground">{BOUNDARY.shielded.hint}</CardContent>
        </Card>
        <Card className="border-2 border-dashed border-public">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-display4 uppercase">
              <Eye className="size-5 text-public" aria-hidden />
              Public
            </CardTitle>
          </CardHeader>
          <CardContent className="text-body3 text-muted-foreground">
            Your Starknet address, readable by anyone. Money lands here first, then crosses into the pool.
          </CardContent>
        </Card>
      </div>
      <p className="text-body4 text-muted-foreground">The two are never added together, here or anywhere in this app.</p>
      <Button size="lg" className="self-start" onClick={onNext}>
        {NAME_CTA}
      </Button>
    </div>
  )
}

export interface NameChoice {
  name: string
  claimPublicly: boolean
}

export function NameScreen({ initial, onNext }: { initial: NameChoice; onNext: (choice: NameChoice) => void }) {
  const [name, setName] = useState(initial.name)
  const [claim, setClaim] = useState(initial.claimPublicly)
  const trimmed = name.trim().toLowerCase().replace(/^@/, '')
  return (
    <div className="flex flex-col gap-6">
      <Heading title={NAME_TITLE} />
      <Field>
        <FieldLabel htmlFor="onboarding-name">Name</FieldLabel>
        <Input id="onboarding-name" autoFocus placeholder={NAME_PLACEHOLDER} value={name} onChange={(e) => setName(e.target.value)} />
        <FieldDescription>{trimmed === '' ? NAME_CAPTION : namePreview(trimmed, claim)}</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Switch id="onboarding-claim" checked={claim} onCheckedChange={setClaim} />
        <div>
          <FieldLabel htmlFor="onboarding-claim">{NAME_CLAIM_OPT_IN}</FieldLabel>
          <FieldDescription>{NAME_CLAIM_NOTE}</FieldDescription>
        </div>
      </Field>
      {/* Never `disabled`: blocked, it stays pressable and says why. */}
      <Button
        size="lg"
        className="self-start"
        aria-disabled={trimmed === '' || undefined}
        onClick={() => (trimmed ? onNext({ name: trimmed, claimPublicly: claim }) : toast(`${NAME_TITLE} first`))}
      >
        {NAME_CTA}
      </Button>
    </div>
  )
}

interface CustodyAsk {
  label: string | null
  password: string | null
}

/** Mints the key; labels it; optionally seals it under a password. One press, in that order. */
async function generateKey(ask: CustodyAsk): Promise<void> {
  await sessionActions.createAccount()
  const address = getSessionSnapshot().address
  if (ask.label && address) sessionActions.setLabel(address, ask.label)
  if (ask.password) {
    const sealed = await sessionActions.setPassword(ask.password)
    if (!sealed.ok) throw new Error(sealed.error)
  }
}

export function CustodyScreen({ label, onNext }: { label: string | null; onNext: () => void }) {
  const [wantPassword, setWantPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const mutation = useMutation({ mutationKey: ['generate-key'], mutationFn: generateKey, onSuccess: onNext })

  const strength = passwordStrength(password)
  const mismatch = wantPassword && confirm !== '' && confirm !== password
  const blocker = !wantPassword
    ? null
    : password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : mismatch || confirm === ''
        ? PASSWORD_MISMATCH
        : null

  return (
    <div className="flex flex-col gap-6">
      <Heading title={CUSTODY_TITLE} body={CUSTODY_BODY} />
      <Field orientation="horizontal">
        <Switch id="custody-password" checked={wantPassword} onCheckedChange={setWantPassword} />
        <div>
          <FieldLabel htmlFor="custody-password">Protect this browser with a password</FieldLabel>
          <FieldDescription>{PASSWORD_BODY}</FieldDescription>
        </div>
      </Field>
      {wantPassword ? (
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="custody-pw">New password</FieldLabel>
            <Input id="custody-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <FieldDescription>{password ? `Strength: ${strength}` : PASSWORD_NO_RESET}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="custody-pw2">Confirm</FieldLabel>
            <Input id="custody-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {mismatch ? <FieldDescription className="text-destructive">{PASSWORD_MISMATCH}</FieldDescription> : null}
          </Field>
        </div>
      ) : null}
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        size="lg"
        className="self-start"
        aria-disabled={mutation.isPending || blocker !== null}
        onClick={() => !mutation.isPending && blocker === null && mutation.mutate({ label, password: wantPassword ? password : null })}
      >
        {mutation.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {mutation.isPending ? 'Working…' : (blocker ?? CUSTODY_CTA)}
      </Button>
    </div>
  )
}
