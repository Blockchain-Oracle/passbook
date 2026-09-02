import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, Lock, TimerOff } from 'lucide-react'
import {
  lockWhatItDoes,
  PASSWORD_BODY,
  PASSWORD_NO_RESET,
  PASSWORD_REMOVE_ACTION,
  PASSWORD_REMOVE_CONFIRM,
  PASSWORD_SET_ACTION,
  PASSWORD_TITLE,
} from '@strk20/protocol/account-copy'

import type { Protection, SessionStatus } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CurrentPasswordField, NewPasswordFields, type NewPasswordValue } from './password-fields'
import { PasskeyRow, type PasskeyRowProps } from './passkey-row'
import { SettingsSection } from './section'
import { AUTO_LOCK_BODY, AUTO_LOCK_TITLE, LOCK_NOW, NEED_UNLOCK, PASSWORD_CHANGE_ACTION, PASSWORD_CHANGE_BODY } from './settings-copy'

export interface SecuritySectionProps {
  status: SessionStatus
  hasVault: boolean
  protection: Protection | null
  /** Each resolves on success and throws a whole sentence on refusal. */
  onSetPassword: (password: string) => Promise<void>
  onChangePassword: (current: string, next: string) => Promise<void>
  onRemovePassword: (current: string) => Promise<void>
  onLock: () => void
  passkey: Omit<PasskeyRowProps, 'ready' | 'protection'>
}

const EMPTY: NewPasswordValue = { password: '', ready: false }

function Problem({ error }: { error: Error | null }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  )
}

function SetPasswordForm({ onSubmit }: { onSubmit: (pw: string) => Promise<void> }) {
  const [next, setNext] = useState(EMPTY)
  const set = useMutation({ mutationKey: ['settings', 'set-password'], mutationFn: onSubmit })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (next.ready && !set.isPending) set.mutate(next.password)
      }}
    >
      <NewPasswordFields onChange={setNext} />
      <p className="text-body4 text-muted-foreground">{PASSWORD_NO_RESET}</p>
      <Problem error={set.error} />
      <Button type="submit" aria-disabled={!next.ready || set.isPending} className="self-start">
        {set.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {PASSWORD_SET_ACTION}
      </Button>
    </form>
  )
}

function ChangePasswordForm({ onSubmit }: { onSubmit: (current: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState(EMPTY)
  const change = useMutation({
    mutationKey: ['settings', 'change-password'],
    mutationFn: (ask: { current: string; next: string }) => onSubmit(ask.current, ask.next),
  })
  const ready = current !== '' && next.ready
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !change.isPending) change.mutate({ current, next: next.password })
      }}
    >
      <p className="text-body4 text-muted-foreground">{PASSWORD_CHANGE_BODY}</p>
      <CurrentPasswordField value={current} onChange={setCurrent} />
      <NewPasswordFields onChange={setNext} />
      <Problem error={change.error} />
      <Button type="submit" aria-disabled={!ready || change.isPending} className="self-start">
        {change.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {PASSWORD_CHANGE_ACTION}
      </Button>
    </form>
  )
}

function RemovePasswordForm({ onSubmit }: { onSubmit: (current: string) => Promise<void> }) {
  const [current, setCurrent] = useState('')
  const remove = useMutation({ mutationKey: ['settings', 'remove-password'], mutationFn: onSubmit })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (current !== '' && !remove.isPending) remove.mutate(current)
      }}
    >
      <p className="text-body4 text-muted-foreground">{PASSWORD_REMOVE_CONFIRM}</p>
      <CurrentPasswordField value={current} onChange={setCurrent} />
      <Problem error={remove.error} />
      <Button type="submit" variant="destructive" aria-disabled={current === '' || remove.isPending} className="self-start">
        {remove.isPending ? <Spinner data-icon="inline-start" /> : null}
        {PASSWORD_REMOVE_ACTION}
      </Button>
    </form>
  )
}

export function SecuritySection({ status, hasVault, protection, onSetPassword, onChangePassword, onRemovePassword, onLock, passkey }: SecuritySectionProps) {
  const ready = status === 'ready'
  // A passkey-only vault has no password to change: the password row offers to set one.
  const withPassword = hasVault && protection?.password !== false
  return (
    <SettingsSection id="security" index="02" title="Security" description={PASSWORD_BODY}>
      {!ready ? (
        <Alert>
          <Lock />
          <AlertDescription>{NEED_UNLOCK}</AlertDescription>
        </Alert>
      ) : null}

      <Item variant="outline" className="items-start">
        <ItemMedia variant="icon">
          <KeyRound aria-hidden />
        </ItemMedia>
        <ItemContent className="gap-3">
          <ItemTitle>{PASSWORD_TITLE}</ItemTitle>
          {ready && !withPassword ? <SetPasswordForm onSubmit={onSetPassword} /> : null}
          {ready && withPassword ? (
            <Tabs defaultValue="change">
              <TabsList>
                <TabsTrigger value="change">Change</TabsTrigger>
                <TabsTrigger value="remove">Remove</TabsTrigger>
              </TabsList>
              <TabsContent value="change" className="pt-3">
                <ChangePasswordForm onSubmit={onChangePassword} />
              </TabsContent>
              <TabsContent value="remove" className="pt-3">
                <RemovePasswordForm onSubmit={onRemovePassword} />
              </TabsContent>
            </Tabs>
          ) : null}
          {!ready ? <ItemDescription>{withPassword ? 'A password protects this browser’s accounts.' : 'No password is set.'}</ItemDescription> : null}
        </ItemContent>
      </Item>

      <PasskeyRow ready={ready} protection={protection} {...passkey} />

      <Item variant="outline">
        <ItemMedia variant="icon">
          <Lock aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Lock</ItemTitle>
          <ItemDescription className="line-clamp-none">{lockWhatItDoes(hasVault, protection)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" aria-disabled={!ready} onClick={() => ready && onLock()}>
            <Lock data-icon="inline-start" />
            {LOCK_NOW}
          </Button>
        </ItemActions>
      </Item>

      <Item variant="muted">
        <ItemMedia variant="icon">
          <TimerOff aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{AUTO_LOCK_TITLE}</ItemTitle>
          <ItemDescription className="line-clamp-none">{AUTO_LOCK_BODY}</ItemDescription>
        </ItemContent>
      </Item>
    </SettingsSection>
  )
}
