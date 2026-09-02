// The session's public surface. Everything under `src/app/session/` is reached from here.
import { createAccount, forget, importAccount, setLabel, switchAccount } from './actions'
import { protectWithPasskey, removePasskey, reproveWithPasskey, restoreWithPasskey, syncNow, unlockWithPasskey } from './passkey'
import { changePassword, lock, removePassword, setPassword, unlock } from './vault'

export type { PasskeyProtection, PasskeySync, Protection, Session, SessionStatus } from './store'
export { getSessionSnapshot, useSession } from './store'
export { getSessionLock } from './boot'
export { useRecoverySync } from './recovery-sync'

export const sessionActions = {
  createAccount,
  importAccount,
  unlock,
  unlockWithPasskey,
  lock,
  // On a passkey-sealed wallet the passkey re-proves once so the password can wrap the same VEK.
  setPassword: (password: string) => setPassword(password, reproveWithPasskey),
  changePassword,
  removePassword,
  protectWithPasskey,
  removePasskey,
  restoreWithPasskey,
  syncNow,
  switchAccount,
  setLabel,
  forget,
}

export type { BackupCeremony } from './backup'
export { backupActions, useBackupCeremony } from './backup'
