import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import type { VisibilityContext } from '@strk20/protocol/visibility-matrix'
import { notify } from '@/lib/notify'

import { backupActions, sessionActions, useBackupCeremony, useSession } from '@/app/session'
import { feeRecipientQuery, poolHealthQuery } from '@/queries'
import { AppearanceSection } from './appearance-section'
import { BackupReissueDialog } from './backup-reissue'
import { BackupSection } from './backup-section'
import { DangerSection } from './danger-section'
import { NetworkSection } from './network-section'
import { PrivacySection } from './privacy-section'
import { backupCadenceQuery } from './queries'
import { SecuritySection } from './security-section'
import { FORGOTTEN_TOAST, PASSWORD_CHANGED_TOAST, PASSWORD_REMOVED_TOAST, PASSWORD_SET_TOAST } from './settings-copy'
import {
  FORGET_PASSKEY_NOTE,
  PASSKEY_ADDED_TOAST,
  PASSKEY_REMOVED_TOAST_PASSWORD,
  PASSKEY_REMOVED_TOAST_PLAIN,
  PASSWORD_CHANGED_TOAST_V2,
  PASSWORD_REMOVED_TOAST_PASSKEY,
} from '@strk20/protocol/passkey-copy'
import { SoundsSection } from './sounds-section'
import { useSoundFlag } from './use-sound-flag'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Every hook lives here; the sections below it are props in, callbacks out. */
export function SettingsSurface() {
  const session = useSession()
  const ceremony = useBackupCeremony()
  const queryClient = useQueryClient()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [sounds, setSounds] = useSoundFlag()
  const [context, setContext] = useState<VisibilityContext>('pool-send')
  const [reissueOpen, setReissueOpen] = useState(false)

  const address = session.status === 'ready' ? session.address : undefined
  const cadence = useQuery(backupCadenceQuery(address))
  const health = useQuery(poolHealthQuery())
  const feeRecipient = useQuery(feeRecipientQuery())
  const refreshCadence = () => void queryClient.invalidateQueries({ queryKey: ['settings', 'backup-cadence'] })

  const passkey = session.protection?.passkey ?? null
  const setPassword = async (pw: string) => {
    const outcome = await sessionActions.setPassword(pw)
    if (!outcome.ok) throw new Error(outcome.error)
    notify.settled('Password set', { description: PASSWORD_SET_TOAST })
  }
  const removePassword = async (pw: string) => {
    const outcome = await sessionActions.removePassword(pw)
    if (!outcome.ok) throw new Error(outcome.error)
    notify.settled('Password removed', { description: passkey ? PASSWORD_REMOVED_TOAST_PASSKEY : PASSWORD_REMOVED_TOAST })
  }
  // One action: v1 removes then sets (and says so if the second leg fails); v2 swaps the wrapper.
  const changePassword = async (current: string, next: string) => {
    const outcome = await sessionActions.changePassword(current, next)
    if (!outcome.ok) throw new Error(outcome.error)
    notify.settled('Password changed', { description: passkey ? PASSWORD_CHANGED_TOAST_V2 : PASSWORD_CHANGED_TOAST })
  }
  const addPasskey = async (password?: string) => {
    const outcome = await sessionActions.protectWithPasskey(password ? { password } : {})
    if (!outcome.ok) throw new Error(outcome.error)
    notify.settled('Passkey added', { description: PASSKEY_ADDED_TOAST })
  }
  const removePasskey = async () => {
    const hadPassword = session.protection?.password === true
    const outcome = await sessionActions.removePasskey()
    if (!outcome.ok) throw new Error(outcome.error)
    notify.settled('Passkey removed', { description: hadPassword ? PASSKEY_REMOVED_TOAST_PASSWORD : PASSKEY_REMOVED_TOAST_PLAIN })
  }
  const syncPasskey = async () => {
    const outcome = await sessionActions.syncNow()
    if (!outcome.ok) throw new Error(outcome.error)
  }
  const verifyBackup = async (file: string, code: string) => {
    try {
      return await backupActions.verify(file, code)
    } finally {
      refreshCadence()
    }
  }
  const forget = () => {
    sessionActions.forget()
    notify.settled('Forgotten', { description: passkey ? `${FORGOTTEN_TOAST} ${FORGET_PASSKEY_NOTE}` : FORGOTTEN_TOAST })
  }

  return (
    <div className="flex flex-col gap-6">
      <AppearanceSection theme={theme} resolvedTheme={resolvedTheme} onChange={setTheme} />

      <SecuritySection
        status={session.status}
        hasVault={session.hasVault}
        protection={session.protection}
        onSetPassword={setPassword}
        onChangePassword={changePassword}
        onRemovePassword={removePassword}
        onLock={sessionActions.lock}
        passkey={{
          // A v2 vault sealed by a password alone needs that password once to add a passkey.
          needsPassword: session.hasVault && session.protection?.password === true && session.protection.passkey === null && !!session.protection,
          onAdd: addPasskey,
          onRemove: removePasskey,
          onSync: syncPasskey,
        }}
      />

      <BackupSection
        cadence={address ? cadence.data : null}
        status={ceremony.status}
        ready={session.status === 'ready'}
        onVerify={verifyBackup}
        onReissue={() => setReissueOpen(true)}
      />
      <BackupReissueDialog
        open={reissueOpen}
        onOpenChange={setReissueOpen}
        ceremony={ceremony}
        actions={backupActions}
        onComplete={() => {
          refreshCadence()
          notify.settled('Recovery file written')
        }}
      />

      <PrivacySection context={context} onContextChange={setContext} />

      <NetworkSection
        health={health.data}
        healthProblem={health.error ? message(health.error) : null}
        refreshing={health.isFetching}
        onRefresh={() => {
          void health.refetch()
          void feeRecipient.refetch()
        }}
        feeRecipient={feeRecipient.isError ? null : feeRecipient.data}
        feeRecipientProblem={feeRecipient.error ? message(feeRecipient.error) : null}
      />

      <SoundsSection enabled={sounds} onChange={setSounds} />

      <DangerSection accountCount={session.accounts.length} note={passkey ? FORGET_PASSKEY_NOTE : null} onForget={forget} />
    </div>
  )
}
