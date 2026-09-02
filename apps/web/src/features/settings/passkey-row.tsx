// Settings → Security → Passkey: what seals the wallet by passkey, whether the provider syncs it,
// whether the sealed copy at the recovery service is current, and the two doors (add, remove).
// A refusal is red, inline, above the button that caused it — never a toast behind a section.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Fingerprint, RefreshCw } from 'lucide-react'
import {
  PASSKEY_ADD,
  PASSKEY_DEVICE_ONLY,
  PASSKEY_DEVICE_ONLY_WARNING,
  PASSKEY_NEEDS_PASSWORD,
  PASSKEY_NONE,
  PASSKEY_NONE_BODY,
  PASSKEY_REMOVE,
  PASSKEY_REMOVE_BODY_PASSWORD,
  PASSKEY_REMOVE_BODY_PLAIN,
  PASSKEY_SYNC_NOW,
  PASSKEY_SYNC_STATE_SYNCED,
  PASSKEY_SYNC_STATE_SYNCING,
  PASSKEY_SYNCED,
  PASSKEY_TITLE,
} from '@strk20/protocol/passkey-copy'
import { RECOVERY_BEHIND } from '@strk20/protocol/recovery-wire'

import type { Protection } from '@/app/session'
import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { shortAddress } from '@/lib/format'
import { CurrentPasswordField } from './password-fields'

export interface PasskeyRowProps {
  ready: boolean
  protection: Protection | null
  /** Set when the vault is v2 and password-only: adding a passkey then needs the password once. */
  needsPassword: boolean
  onAdd: (password?: string) => Promise<void>
  onRemove: () => Promise<void>
  onSync: () => Promise<void>
}

function SyncLine({ protection, onSync, busy }: { protection: Protection; onSync: () => void; busy: boolean }) {
  const passkey = protection.passkey
  if (!passkey) return null
  if (passkey.sync === 'synced') return <ItemDescription>{PASSKEY_SYNC_STATE_SYNCED}</ItemDescription>
  if (passkey.sync === 'syncing') return <ItemDescription>{PASSKEY_SYNC_STATE_SYNCING}</ItemDescription>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-exposed/40 text-exposed">{RECOVERY_BEHIND}</Badge>
      <Button size="sm" variant="outline" aria-disabled={busy} onClick={() => !busy && onSync()}>
        <RefreshCw data-icon="inline-start" />
        {PASSKEY_SYNC_NOW}
      </Button>
    </div>
  )
}

export function PasskeyRow({ ready, protection, needsPassword, onAdd, onRemove, onSync }: PasskeyRowProps) {
  const [password, setPassword] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { refusal, refuse, clear } = useRefusal()
  const add = useMutation({ mutationKey: ['settings', 'passkey', 'add'], mutationFn: onAdd, onError: (e) => refuse(e.message), onSuccess: () => setPassword('') })
  const remove = useMutation({ mutationKey: ['settings', 'passkey', 'remove'], mutationFn: onRemove, onError: (e) => refuse(e.message), onSuccess: () => setConfirmRemove(false) })
  const sync = useMutation({ mutationKey: ['settings', 'passkey', 'sync'], mutationFn: onSync, onError: (e) => refuse(e.message) })
  const busy = add.isPending || remove.isPending || sync.isPending
  const passkey = protection?.passkey ?? null

  return (
    <Item variant="outline" className="items-start">
      <ItemMedia variant="icon">
        <Fingerprint aria-hidden />
      </ItemMedia>
      <ItemContent className="gap-3">
        <ItemTitle>{PASSKEY_TITLE}</ItemTitle>
        {passkey ? (
          <>
            <ItemDescription className="line-clamp-none">
              {passkey.backedUp ? PASSKEY_SYNCED : PASSKEY_DEVICE_ONLY}
              <span className="ml-2 font-mono text-mono text-muted-foreground">{shortAddress(passkey.credentialId, 6, 4)}</span>
            </ItemDescription>
            {!passkey.backedUp ? <ItemDescription className="line-clamp-none text-exposed">{PASSKEY_DEVICE_ONLY_WARNING}</ItemDescription> : null}
            {protection && ready ? <SyncLine protection={protection} busy={busy} onSync={() => { clear(); sync.mutate() }} /> : null}
            {passkey.problem ? <RefusalRow refusal={{ sentence: passkey.problem, hash: null }} /> : null}
            {ready ? (
              <div className="flex flex-col gap-3">
                {confirmRemove ? (
                  <ItemDescription className="line-clamp-none">{protection?.password ? PASSKEY_REMOVE_BODY_PASSWORD : PASSKEY_REMOVE_BODY_PLAIN}</ItemDescription>
                ) : null}
                <RefusalRow refusal={refusal} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={confirmRemove ? 'destructive' : 'outline'}
                    aria-disabled={busy}
                    onClick={() => {
                      if (busy) return
                      clear()
                      if (!confirmRemove) setConfirmRemove(true)
                      else remove.mutate()
                    }}
                  >
                    {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {confirmRemove ? 'Remove for good' : PASSKEY_REMOVE}
                  </Button>
                  {confirmRemove ? (
                    <Button variant="ghost" onClick={() => { setConfirmRemove(false); clear() }}>
                      Keep it
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <ItemDescription className="line-clamp-none">{PASSKEY_NONE}</ItemDescription>
            {ready ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (busy || (needsPassword && password === '')) return
                  clear()
                  add.mutate(needsPassword ? password : undefined)
                }}
              >
                <ItemDescription className="line-clamp-none">{PASSKEY_NONE_BODY}</ItemDescription>
                {needsPassword ? (
                  <>
                    <p className="text-body4 text-muted-foreground">{PASSKEY_NEEDS_PASSWORD}</p>
                    <CurrentPasswordField value={password} onChange={(v) => { setPassword(v); clear() }} />
                  </>
                ) : null}
                <RefusalRow refusal={refusal} />
                <Button type="submit" className="self-start" aria-disabled={busy || (needsPassword && password === '')}>
                  {add.isPending ? <Spinner data-icon="inline-start" /> : <Fingerprint data-icon="inline-start" />}
                  {add.isPending ? 'Waiting for the passkey…' : PASSKEY_ADD}
                </Button>
              </form>
            ) : null}
          </>
        )}
      </ItemContent>
    </Item>
  )
}
