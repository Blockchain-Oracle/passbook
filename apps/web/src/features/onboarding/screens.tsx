import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Eye, FileKey, KeyRound, ShieldCheck, UserPlus } from 'lucide-react'
import { IMPORT_ENTRY_CTA, PASSWORD_BODY, PASSWORD_MISMATCH, PASSWORD_NO_RESET } from '@strk20/protocol/account-copy'
import {
  CUSTODY_BODY,
  CUSTODY_CTA,
  CUSTODY_TITLE,
  FORK_BODY,
  FORK_CREATE_CTA,
  FORK_TITLE,
  NAME_CAPTION,
  NAME_CLAIM_NOTE,
  NAME_CLAIM_OPT_IN,
  NAME_CTA,
  NAME_PLACEHOLDER,
  NAME_TITLE,
  namePreview,
} from '@strk20/protocol/onboarding-copy'
import { MIN_PASSWORD_LENGTH } from '@strk20/protocol/session-vault'

import { BOUNDARY } from '@/app/boundary'
import { getSessionSnapshot, sessionActions } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { PasswordField } from './password-field'

function Heading({ title, body }: { title: string; body?: string }) {
  return (
    <div>
      <h2 className="font-display text-display3 uppercase">{title}</h2>
      {body ? <p className="mt-1 text-body3 text-muted-foreground">{body}</p> : null}
    </div>
  )
}

/** Screen one: an account is created here, or an existing key is brought back in. */
export function ForkScreen({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-kicker uppercase tracking-[0.16em] text-muted-foreground">Start here</p>
        {/*
          Three lines, and the rule draws itself under the last one. The seed phrase is the thing a
          newcomer most expects to be handed and most dreads — so it is the beat that gets the
          emphasis, and the only one in the accent.
        */}
        <h1 className="mt-2 font-display text-display2 uppercase md:text-display1">
          {FORK_TITLE.map((line, i) => (
            <span key={line} className="block">
              {i === FORK_TITLE.length - 1 ? (
                <span className="underline-draw text-primary">{line}</span>
              ) : (
                line
              )}
            </span>
          ))}
        </h1>
        <p className="mt-4 text-body2 text-muted-foreground">{FORK_BODY}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="h-12 flex-1 text-buttonLabel2" onClick={onCreate}>
          <UserPlus data-icon="inline-start" />
          {FORK_CREATE_CTA}
        </Button>
        <Button size="lg" variant="outline" className="h-12 flex-1 text-buttonLabel2" onClick={onImport}>
          <FileKey data-icon="inline-start" />
          {IMPORT_ENTRY_CTA}
        </Button>
      </div>
    </div>
  )
}

/** "Two balances. One account." — the one idea a new user must hold before anything else. */
export function TeachScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Heading title="Two balances. One account." />
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
  const [attempted, setAttempted] = useState(false)
  const trimmed = name.trim().toLowerCase().replace(/^@/, '')
  const missing = attempted && trimmed === ''
  return (
    <div className="flex flex-col gap-6">
      <Heading title={NAME_TITLE} />
      <Field data-invalid={missing || undefined}>
        <FieldLabel htmlFor="onboarding-name">Name</FieldLabel>
        <Input
          id="onboarding-name"
          autoFocus
          placeholder={NAME_PLACEHOLDER}
          value={name}
          aria-invalid={missing || undefined}
          className="h-11 text-body2"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (trimmed ? onNext({ name: trimmed, claimPublicly: claim }) : setAttempted(true))}
        />
        {missing ? <FieldError>{`${NAME_TITLE} first.`}</FieldError> : <FieldDescription>{trimmed === '' ? NAME_CAPTION : namePreview(trimmed, claim)}</FieldDescription>}
      </Field>
      <Field orientation="horizontal">
        <Switch id="onboarding-claim" checked={claim} onCheckedChange={setClaim} />
        <div>
          <FieldLabel htmlFor="onboarding-claim">{NAME_CLAIM_OPT_IN}</FieldLabel>
          <FieldDescription>{NAME_CLAIM_NOTE}</FieldDescription>
        </div>
      </Field>
      {/* Never `disabled`: blocked, it stays pressable and says why — inline, under the field. */}
      <Button
        size="lg"
        className="h-12 self-start text-buttonLabel2"
        aria-disabled={trimmed === '' || undefined}
        onClick={() => (trimmed ? onNext({ name: trimmed, claimPublicly: claim }) : setAttempted(true))}
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
        <div className="flex flex-col gap-4 border-l-2 border-primary pl-4">
          <PasswordField
            id="custody-pw"
            label="New password"
            autoComplete="new-password"
            autoFocus
            meter
            value={password}
            onChange={setPassword}
            hint={PASSWORD_NO_RESET}
          />
          <PasswordField
            id="custody-pw2"
            label="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={mismatch ? PASSWORD_MISMATCH : null}
          />
        </div>
      ) : null}
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        size="lg"
        className="h-12 self-start text-buttonLabel2"
        aria-disabled={mutation.isPending || blocker !== null}
        onClick={() => !mutation.isPending && blocker === null && mutation.mutate({ label, password: wantPassword ? password : null })}
      >
        {mutation.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {mutation.isPending ? 'Making your key…' : CUSTODY_CTA}
      </Button>
      {blocker && !mismatch ? <p className="-mt-3 text-body4 text-muted-foreground">{blocker}</p> : null}
    </div>
  )
}
