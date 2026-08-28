// The backup ceremony: issue a Recovery File + Recovery Code, confirm the code by paste, save the
// file, and (later) re-verify. Wraps `backup-gate` / `identity`; the state machine is theirs.
//
// `ready` is persisted (`saveCeremony`); mid-ceremony states are not — after a reload the honest
// move is to start again, which costs nothing before registration.
import { useSyncExternalStore } from 'react'

import type { BackupStatus, CadenceState, StoredCadence } from '@strk20/protocol/backup-cadence'
import type { BackupCeremonyState } from '@strk20/protocol/backup-gate'
import type { BackupVerification } from '@strk20/protocol/identity'

import { ensureBooted } from './boot'
import { getSessionSnapshot, subscribeSession } from './store'
import { loadTier, type Tier } from './tier'

export interface BackupCeremony {
  readonly state: BackupCeremonyState
  /** True once a file has been saved and verified — registration may open. */
  readonly complete: boolean
  readonly busy: boolean
  readonly problem: string | null
  readonly status: BackupStatus
  readonly lastVerification: BackupVerification | null
}

const CODE_MISMATCH = 'That does not match. Nothing is lost — check it and try again.'

let snapshot: BackupCeremony = {
  state: { step: 'not-started' },
  complete: false,
  busy: false,
  problem: null,
  status: 'unknown',
  lastVerification: null,
}
const listeners = new Set<() => void>()
let loadedFor: string | null = null

function publish(patch: Partial<BackupCeremony>): void {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

function cadenceStore(t: Tier) {
  const key = t.protocol.SESSION_KEYS.cadence
  return {
    load(): StoredCadence {
      const raw = t.store.read(key)
      if (raw === null) return { kind: 'absent' }
      try {
        const parsed = JSON.parse(raw) as { state: CadenceState; status: BackupStatus }
        return { kind: 'present', state: parsed.state, status: parsed.status }
      } catch (e) {
        return { kind: 'unreadable', reason: String(e) }
      }
    },
    save(next: { state: CadenceState; status: BackupStatus }): void {
      t.store.write(key, JSON.stringify(next))
    },
  }
}

/** Reloads the persisted ceremony whenever the active account changes. */
async function syncToAccount(): Promise<void> {
  const session = getSessionSnapshot()
  const address = session.status === 'ready' ? (session.address ?? null) : null
  if (address === loadedFor) return
  loadedFor = address
  if (!address) {
    publish({ state: { step: 'not-started' }, complete: false, problem: null, status: 'unknown' })
    return
  }
  const t = await loadTier()
  const [{ readBackupCadence }, { ceremonyIsComplete }] = await Promise.all([
    import('@strk20/protocol/backup-cadence'),
    import('@strk20/protocol/backup-gate'),
  ])
  const persisted = t.protocol.loadCeremony(t.store)
  const state: BackupCeremonyState = persisted ?? { step: 'not-started' }
  const cadence = readBackupCadence(Date.now(), cadenceStore(t))
  publish({ state, complete: ceremonyIsComplete(state), problem: null, status: cadence.status })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribeSession = subscribeSession(() => {
    void syncToAccount()
  })
  void ensureBooted().then(syncToAccount)
  return () => {
    listeners.delete(listener)
    unsubscribeSession()
  }
}

export function useBackupCeremony(): BackupCeremony {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

export function getBackupCeremonySnapshot(): BackupCeremony {
  return snapshot
}

function activeKey(): { accountKey: string; address: string } {
  const s = getSessionSnapshot()
  if (s.status !== 'ready' || !s.accountKey || !s.address) throw new Error('Open your wallet before saving a backup.')
  return { accountKey: s.accountKey, address: s.address }
}

async function run(work: () => Promise<void>): Promise<void> {
  if (snapshot.busy) return
  publish({ busy: true, problem: null })
  try {
    await work()
  } catch (e) {
    publish({ problem: e instanceof Error ? e.message : String(e) })
  } finally {
    publish({ busy: false })
  }
}

/** Writes a Recovery File for the active key and issues its Recovery Code. */
export async function issue(): Promise<void> {
  await run(async () => {
    const { accountKey, address } = activeKey()
    const { readBackupHeaderContext, issueBackup } = await import('@strk20/protocol/backup-gate')
    const context = await readBackupHeaderContext()
    if (!context.ok) throw new Error(`The chain could not be read, so no recovery file was written: ${context.reason}`)
    const state = await issueBackup(accountKey, context, address)
    publish({ state, complete: false })
  })
}

/** Paste-to-confirm. A mismatch leaves the state as it was and says so. */
export async function confirmCode(pasted: string): Promise<void> {
  await run(async () => {
    const { confirmPastedCode } = await import('@strk20/protocol/backup-gate')
    const next = confirmPastedCode(snapshot.state, pasted)
    if (next === snapshot.state) throw new Error(CODE_MISMATCH)
    publish({ state: next })
  })
}

/**
 * The UI has handed the file to the user (Blob download of `state.backup.file`). This performs
 * the first real decrypt-and-compare, persists `ready` and starts the cadence ladder.
 */
export async function markSaved(): Promise<void> {
  await run(async () => {
    const { accountKey } = activeKey()
    const t = await loadTier()
    const { completeCeremony, ceremonyIsComplete } = await import('@strk20/protocol/backup-gate')
    const { state, outcome } = await completeCeremony(snapshot.state, accountKey, Date.now())
    if (outcome) cadenceStore(t).save({ state: outcome.cadence, status: outcome.status })
    if (!ceremonyIsComplete(state)) {
      publish({ state, status: outcome?.status ?? 'unknown' })
      throw new Error(t.identity.BACKUP_VERIFICATION_FAILED)
    }
    const saved = t.protocol.saveCeremony(t.store, state)
    if (!saved.ok) throw new Error(saved.reason)
    publish({ state, complete: true, status: outcome?.status ?? 'backed-up' })
  })
}

/** Re-verifies a saved file against the active key (the periodic check, or a user's own test). */
export async function verify(file: string, code: string): Promise<BackupVerification> {
  const { accountKey } = activeKey()
  const t = await loadTier()
  const { runPeriodicVerification, readBackupCadence } = await import('@strk20/protocol/backup-cadence')
  const store = cadenceStore(t)
  const result = await runPeriodicVerification({
    file,
    recoveryCode: code,
    accountKey,
    now: Date.now(),
    cadence: readBackupCadence(Date.now(), store).cadence,
    store,
  })
  publish({ lastVerification: result.verification, status: result.outcome.status, problem: result.verification.ok ? null : result.message })
  return result.verification
}

/** Opens a recovery file and returns the key inside — `importAccount` takes it from here. */
export async function openRecoveryFile(file: string, code: string): Promise<string> {
  const t = await loadTier()
  return t.identity.restoreBackup(file, code)
}

export const backupActions = { issue, confirmCode, markSaved, verify, openRecoveryFile }
