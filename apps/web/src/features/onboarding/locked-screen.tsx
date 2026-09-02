import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Fingerprint, Lock, LockOpen, RotateCcw } from 'lucide-react'
import {
  IMPORT_ENTRY_CTA,
  LOCKED_BODY,
  LOCKED_BODY_SEALED,
  LOCKED_HEADLINE,
  UNLOCK_ACTION,
  UNLOCK_FORGOT_PASSWORD,
  UNLOCK_PASSWORD_LABEL,
} from '@strk20/protocol/account-copy'
import { LOCKED_BODY_BOTH, LOCKED_BODY_PASSKEY, UNLOCK_LOST_PASSKEY, UNLOCK_WITH_PASSKEY } from '@strk20/protocol/passkey-copy'

import { sessionActions, type Session } from '@/app/session'
import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { shortAddress } from '@/lib/format'
import { PasswordField } from './password-field'

/** What the lock screen asks for, by what actually seals the accounts. */
function lockedBody(session: Session): string {
  const p = session.protection
  if (!session.hasVault || !p) return LOCKED_BODY
  if (p.password && p.passkey) return LOCKED_BODY_BOTH
  if (p.passkey) return LOCKED_BODY_PASSKEY
  return LOCKED_BODY_SEALED
}

/** The screen lock (or the sealed vault) — nothing was deleted, and the copy leads with that. */
export function LockedScreen({ session, onImport }: { session: Session; onImport: () => void }) {
  const [password, setPassword] = useState('')
  const { refusal, refuse, clear } = useRefusal()
  const unlock = useMutation({
    mutationKey: ['unlock'],
    mutationFn: async (pw: string) => {
      const outcome = await sessionActions.unlock(pw)
      if (!outcome.ok) throw new Error(outcome.error)
    },
  })
  const passkeyUnlock = useMutation({
    mutationKey: ['unlock', 'passkey'],
    mutationFn: async () => {
      const outcome = await sessionActions.unlockWithPasskey()
      if (!outcome.ok) throw new Error(outcome.error)
    },
    onError: (e) => refuse(e.message),
  })
  const sealed = session.hasVault
  // A damaged vault reads as `null` protection: nothing is offered but the Recovery File door.
  const withPassword = !sealed || session.protection?.password === true
  const withPasskey = session.protection?.passkey !== null && session.protection?.passkey !== undefined
  const busy = unlock.isPending || passkeyUnlock.isPending
  const submit = () => !busy && withPassword && unlock.mutate(sealed ? password : '')
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
        <p className="mt-1 text-body3 text-muted-foreground">{lockedBody(session)}</p>
        {session.address ? (
          <p className="mt-3 inline-flex items-center gap-2 rounded-pill border border-border bg-card py-1 pr-3 pl-1 font-mono text-mono">
            <span className="flex size-6 items-center justify-center rounded-pill bg-primary text-primary-foreground">
              <Lock className="size-3" aria-hidden />
            </span>
            {session.label ? <span className="font-sans text-body4 font-medium">{session.label}</span> : null}
            <span className="text-muted-foreground">{shortAddress(session.address, 8, 6)}</span>
          </p>
        ) : null}
      </div>
      {sealed && withPassword ? (
        <PasswordField
          id="unlock-password"
          label={UNLOCK_PASSWORD_LABEL}
          autoComplete="current-password"
          autoFocus={!withPasskey}
          value={password}
          onChange={(v) => {
            setPassword(v)
            if (unlock.isError) unlock.reset()
            clear()
          }}
          error={unlock.error?.message ?? null}
        />
      ) : null}
      {session.reason ? (
        <Alert variant="destructive">
          <AlertDescription>{session.reason}</AlertDescription>
        </Alert>
      ) : null}
      {!sealed && unlock.error ? (
        <Alert variant="destructive">
          <AlertDescription>{unlock.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {session.accounts.length > 1 ? (
        <p className="text-body4 text-muted-foreground">
          {session.accounts.length} accounts are saved in this browser. Unlock, then switch from the account menu.
        </p>
      ) : null}
      <RefusalRow refusal={refusal} />
      <div className="flex flex-wrap gap-3">
        {withPasskey ? (
          <Button type="button" size="lg" className="h-12 text-buttonLabel2" aria-disabled={busy} onClick={() => !busy && passkeyUnlock.mutate()}>
            {passkeyUnlock.isPending ? <Spinner data-icon="inline-start" /> : <Fingerprint data-icon="inline-start" />}
            {passkeyUnlock.isPending ? 'Unlocking…' : UNLOCK_WITH_PASSKEY}
          </Button>
        ) : null}
        {withPassword ? (
          <Button
            type="submit"
            size="lg"
            variant={withPasskey ? 'outline' : 'default'}
            className="h-12 text-buttonLabel2"
            aria-disabled={busy || (sealed && password === '')}
          >
            {unlock.isPending ? <Spinner data-icon="inline-start" /> : <LockOpen data-icon="inline-start" />}
            {unlock.isPending ? 'Unlocking…' : UNLOCK_ACTION}
          </Button>
        ) : null}
        <Button type="button" size="lg" variant="outline" className="h-12 text-buttonLabel2" onClick={onImport}>
          {IMPORT_ENTRY_CTA}
        </Button>
      </div>
      {sealed && withPassword ? <p className="text-body4 text-muted-foreground">{UNLOCK_FORGOT_PASSWORD}</p> : null}
      {sealed && withPasskey && !withPassword ? <p className="text-body4 text-muted-foreground">{UNLOCK_LOST_PASSKEY}</p> : null}
    </form>
  )
}

export function BootingScreen() {
  return (
    <div className="flex items-center gap-3 text-body3 text-muted-foreground">
      <Spinner />
      Opening this browser’s account…
    </div>
  )
}

export function NoStorageScreen({ reason }: { reason: string | undefined }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-display3 uppercase">This browser cannot hold a key</h2>
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
