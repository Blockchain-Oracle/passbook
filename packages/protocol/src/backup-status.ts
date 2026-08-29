//
// The backup status tri-state, its ONE fail-closed collapse, and the balance-presence tri-state.
// Pure. `unknown → not-backed-up` happens in `collapseBackupStatus` and nowhere else: "we could
// not read whether this account is backed up" must read as not backed up, never as fine.
//

/** Three values, not two: "no backup" and "could not find out" have different causes. */
export type BackupStatus = 'backed-up' | 'not-backed-up' | 'unknown'

/** THE named collapse boundary. The only place `unknown` becomes an answer. */
export function collapseBackupStatus(status: BackupStatus): 'backed-up' | 'not-backed-up' {
  return status === 'backed-up' ? 'backed-up' : 'not-backed-up'
}

export function readsAsBackedUp(status: BackupStatus): boolean {
  return collapseBackupStatus(status) === 'backed-up'
}

/** Whether this session holds a shielded balance. A boolean would hide "unreadable" as "empty". */
export type ShieldedBalancePresence = 'present' | 'absent' | 'unknown'
