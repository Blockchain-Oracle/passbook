import { queryOptions, skipToken } from '@tanstack/react-query'
import type { BackupStatus, CadenceState } from '@strk20/protocol/backup-cadence'

/** The cadence ladder as plain data — the session core exposes only `status`. */
export interface BackupCadenceView {
  status: BackupStatus
  backedUp: boolean
  checkDue: boolean
  dueAt: number | null
  lastVerifiedAt: number | null
  intervalDays: number
}

/**
 * Reads `passbook.backup-cadence` the way `app/session/backup.ts` writes it (`{ state, status }`).
 * Keyed by address so an account switch re-reads; invalidated after a verify or a re-issue.
 */
export function backupCadenceQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['settings', 'backup-cadence', address ?? null],
    queryFn: address
      ? async (): Promise<BackupCadenceView> => {
          const [{ readBackupCadence, intervalDays }, { browserSessionStore, SESSION_KEYS }] = await Promise.all([
            import('@strk20/protocol/backup-cadence'),
            import('@strk20/protocol/session-store'),
          ])
          const store = browserSessionStore()
          const reading = readBackupCadence(Date.now(), {
            load() {
              const raw = store.read(SESSION_KEYS.cadence)
              if (raw === null) return { kind: 'absent' }
              try {
                const parsed = JSON.parse(raw) as { state: CadenceState; status: BackupStatus }
                return { kind: 'present', state: parsed.state, status: parsed.status }
              } catch (e) {
                return { kind: 'unreadable', reason: String(e) }
              }
            },
            save() {
              throw new Error('settings only reads the cadence; the session writes it')
            },
          })
          return {
            status: reading.status,
            backedUp: reading.backedUp,
            checkDue: reading.checkDue,
            dueAt: reading.dueAt,
            lastVerifiedAt: reading.cadence.lastVerifiedAt,
            intervalDays: intervalDays(reading.cadence),
          }
        }
      : skipToken,
    staleTime: 0,
  })
}
