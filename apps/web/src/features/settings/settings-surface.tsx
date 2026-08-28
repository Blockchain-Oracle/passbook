import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import type { VisibilityContext } from '@strk20/protocol/visibility-matrix'
import { toast } from 'sonner'

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
import {
  FORGOTTEN_TOAST,
  PASSWORD_CHANGED_TOAST,
  PASSWORD_CHANGE_HALF_DONE,
  PASSWORD_REMOVED_TOAST,
  PASSWORD_SET_TOAST,
} from './settings-copy'
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

  const setPassword = async (pw: string) => {
    const outcome = await sessionActions.setPassword(pw)
    if (!outcome.ok) throw new Error(outcome.error)
    toast.success('Password set', { description: PASSWORD_SET_TOAST })
  }
  const removePassword = async (pw: string) => {
    const outcome = await sessionActions.removePassword(pw)
    if (!outcome.ok) throw new Error(outcome.error)
    toast.success('Password removed', { description: PASSWORD_REMOVED_TOAST })
  }
  // The core has no atomic re-seal: unseal with the old password, then seal with the new one.
  // A failure on the second step is said loudly — the key is in plaintext until it is redone.
  const changePassword = async (current: string, next: string) => {
    const removed = await sessionActions.removePassword(current)
    if (!removed.ok) throw new Error(removed.error)
    const set = await sessionActions.setPassword(next)
    if (!set.ok) throw new Error(`${PASSWORD_CHANGE_HALF_DONE} (${set.error})`)
    toast.success('Password changed', { description: PASSWORD_CHANGED_TOAST })
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
    toast.success('Forgotten', { description: FORGOTTEN_TOAST })
  }

  return (
    <div className="flex flex-col gap-6">
      <AppearanceSection theme={theme} resolvedTheme={resolvedTheme} onChange={setTheme} />

      <SecuritySection
        status={session.status}
        hasVault={session.hasVault}
        onSetPassword={setPassword}
        onChangePassword={changePassword}
        onRemovePassword={removePassword}
        onLock={sessionActions.lock}
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
          toast.success('Recovery file written')
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

      <DangerSection accountCount={session.accounts.length} onForget={forget} />
    </div>
  )
}
