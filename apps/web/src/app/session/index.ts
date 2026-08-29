// The session's public surface. Everything under `src/app/session/` is reached from here.
import { createAccount, forget, importAccount, setLabel, switchAccount } from './actions'
import { lock, removePassword, setPassword, unlock } from './vault'

export type { Session, SessionStatus } from './store'
export { getSessionSnapshot, useSession } from './store'
export { getSessionLock, takeOverSubmitLock } from './boot'

export const sessionActions = {
  createAccount,
  importAccount,
  unlock,
  lock,
  setPassword,
  removePassword,
  switchAccount,
  setLabel,
  forget,
}

export type { BackupCeremony } from './backup'
export { backupActions, useBackupCeremony } from './backup'
