// In-memory recovery state: the relayer session token, the remote revision this browser last saw,
// and whether the sealed copy is behind. Pure — the session snapshot is what React reads; whoever
// changes this calls `refreshProtection` so the snapshot follows.
import type { PasskeySync } from './store'

let token: string | null = null
let revision = 0
let sync: PasskeySync = 'synced'
let problem: string | null = null

export function getRecoverySession(): string | null {
  return token
}

export function setRecoverySession(next: string | null): void {
  token = next
}

export function getRemoteRevision(): number {
  return revision
}

export function setRemoteRevision(next: number): void {
  revision = next
}

export function getSyncState(): { sync: PasskeySync; problem: string | null } {
  return { sync, problem }
}

export function setSyncState(next: PasskeySync, nextProblem: string | null = null): void {
  sync = next
  problem = nextProblem
}

/** Lock and Forget both drop everything: a token must not outlive the vault it opened. */
export function clearRecoveryState(): void {
  token = null
  revision = 0
  sync = 'synced'
  problem = null
}
