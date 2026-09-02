// The session store: one module singleton read through `useSyncExternalStore`.
//
// Genuinely non-cacheable UI state — the embedded key is not a chain read, so it does not live in
// TanStack Query. Nothing heavy is imported here: `starknet` and the protocol's identity code load
// lazily in `tier.ts`, which is why the first snapshot is `booting` rather than a synchronous lie.
import { useSyncExternalStore } from 'react'

import type { RegisterInput } from '@strk20/protocol/register'

/** The SDK's `{ address, signer }` pair, taken from the pipeline that consumes it (type-only). */
export type PrivateTransfersUser = RegisterInput['account']

export type SessionStatus = 'booting' | 'no-storage' | 'fresh' | 'locked' | 'ready'

export interface SessionAccount {
  readonly address: string
  readonly label: string | null
}

/** Whether the sealed copy at the recovery service matches this browser's vault. */
export type PasskeySync = 'synced' | 'syncing' | 'behind'

export interface PasskeyProtection {
  /** base64url; rendered short in Settings. Public — it is the verifier's lookup key. */
  readonly credentialId: string
  /** What the provider reported: synced across the user's devices, or bound to this one. */
  readonly backedUp: boolean
  readonly sync: PasskeySync
  /** A sync that could not complete, as a whole sentence for Settings to render red. */
  readonly problem: string | null
}

/** What seals the accounts at rest. Both may be on; both may be off. */
export interface Protection {
  readonly password: boolean
  readonly passkey: PasskeyProtection | null
}

export const NO_PROTECTION: Protection = { password: false, passkey: null }

export interface Session {
  readonly status: SessionStatus
  /** Why a `no-storage` or `locked` state is what it is, as a whole sentence. */
  readonly reason?: string
  readonly address?: string
  /** The root key. Never rendered, never logged — held so mutations can sign. `ready` only. */
  readonly accountKey?: string
  /** A starknet `Account` over the embedded key. `ready` only. */
  readonly account?: PrivateTransfersUser
  readonly label?: string | null
  readonly accounts: readonly SessionAccount[]
  /** True when a vault seals the accounts at rest — by a password, a passkey, or both. */
  readonly hasVault: boolean
  /** How the vault is sealed. `null` only when the vault could not be read: nothing is guessed. */
  readonly protection: Protection | null
}

export const BOOTING: Session = { status: 'booting', accounts: [], hasVault: false, protection: NO_PROTECTION }

let snapshot: Session = BOOTING
const listeners = new Set<() => void>()
let onFirstSubscribe: (() => void) | null = null

export function publishSession(next: Session): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function patchSession(patch: Partial<Session>): void {
  publishSession({ ...snapshot, ...patch })
}

/** For non-React callers — mutations that need the key and account at call time. */
export function getSessionSnapshot(): Session {
  return snapshot
}

/** `boot.ts` registers itself here so the first subscriber triggers the boot, not module load. */
export function setBootTrigger(trigger: () => void): void {
  onFirstSubscribe = trigger
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (onFirstSubscribe) {
    const run = onFirstSubscribe
    onFirstSubscribe = null
    run()
  }
  return () => {
    listeners.delete(listener)
  }
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, getSessionSnapshot, getSessionSnapshot)
}

/** Subscribe outside React (the backup ceremony watches the active account). */
export function subscribeSession(listener: () => void): () => void {
  return subscribe(listener)
}
