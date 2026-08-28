import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LockOpen, RotateCcw } from 'lucide-react'
import {
  IMPORT_ENTRY_CTA,
  LOCKED_BODY,
  LOCKED_BODY_SEALED,
  LOCKED_HEADLINE,
  UNLOCK_ACTION,
  UNLOCK_FORGOT_PASSWORD,
  UNLOCK_PASSWORD_LABEL,
} from '@strk20/protocol/account-copy'

import { sessionActions, type Session } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { shortAddress } from '@/lib/format'

/** The screen lock (or the sealed vault) — nothing was deleted, and the copy leads with that. */
export function LockedScreen({ session, onImport }: { session: Session; onImport: () => void }) {
  const [password, setPassword] = useState('')
  const unlock = useMutation({
    mutationKey: ['unlock'],
    mutationFn: async (pw: string) => {
      const outcome = await sessionActions.unlock(pw)
      if (!outcome.ok) throw new Error(outcome.error)
    },
  })
  const sealed = session.hasVault
  const submit = () => !unlock.isPending && unlock.mutate(sealed ? password : '')
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div>
        <h2 className="font-display text-display3 uppercase">{LOCKED_HEADLINE}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{sealed ? LOCKED_BODY_SEALED : LOCKED_BODY}</p>
        {session.address ? (
          <p className="mt-2 font-mono text-mono text-muted-foreground">
            {session.label ? `${session.label} · ` : ''}
            {shortAddress(session.address, 10, 8)}
          </p>
        ) : null}
      </div>
      {sealed ? (
        <Field>
          <FieldLabel htmlFor="unlock-password">{UNLOCK_PASSWORD_LABEL}</FieldLabel>
          <Input id="unlock-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      ) : null}
      {session.reason ? (
        <Alert variant="destructive">
          <AlertDescription>{session.reason}</AlertDescription>
        </Alert>
      ) : null}
      {unlock.error ? (
        <Alert variant="destructive">
          <AlertDescription>{unlock.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {session.accounts.length > 1 ? (
        <p className="text-body4 text-muted-foreground">
          {session.accounts.length} accounts are saved in this browser. Unlock, then switch from the account menu.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" aria-disabled={unlock.isPending || (sealed && password === '')}>
          {unlock.isPending ? <Spinner data-icon="inline-start" /> : <LockOpen data-icon="inline-start" />}
          {unlock.isPending ? 'Unlocking…' : UNLOCK_ACTION}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onImport}>
          {IMPORT_ENTRY_CTA}
        </Button>
      </div>
      {sealed ? <p className="text-body4 text-muted-foreground">{UNLOCK_FORGOT_PASSWORD}</p> : null}
    </form>
  )
}

export function BootingScreen() {
  return (
    <div className="flex items-center gap-3 text-body3 text-muted-foreground">
      <Spinner />
      Opening this browser’s wallet…
    </div>
  )
}

export function NoStorageScreen({ reason }: { reason: string | undefined }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-display3 uppercase">This browser cannot hold a wallet</h2>
        <p className="mt-1 text-body3 text-muted-foreground">
          {reason ?? 'Storage could not be read, and this app will not write over what it cannot read.'}
        </p>
      </div>
      <Button size="lg" variant="outline" className="self-start" onClick={() => location.reload()}>
        <RotateCcw data-icon="inline-start" />
        Reload
      </Button>
    </div>
  )
}

export function CheckingScreen({ problem, onRetry, onContinue }: { problem: string | null; onRetry: () => void; onContinue: () => void }) {
  if (problem === null) {
    return (
      <div className="flex items-center gap-3 text-body3 text-muted-foreground">
        <Spinner />
        Checking this account — reading its funding, deployment and pool registration.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-display3 uppercase">The account could not be verified</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{problem}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" />
          Try again
        </Button>
        <Button size="lg" variant="outline" onClick={onContinue}>
          Continue anyway
        </Button>
      </div>
    </div>
  )
}
