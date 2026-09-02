//
// The recovery vault ledger: one JSON file, replaced whole on every write.
//
// What it holds is deliberately useless on its own — passkey PUBLIC keys (the verifier's half)
// and sealed envelopes this process has no key for. Nothing here names an account: no address,
// no label, no Stark key. What keeps it honest is the same discipline as every other ledger in
// this package: atomic writes, synchronous I/O, and a corrupt file is a HARD startup failure. A
// silently emptied store would tell every passkey holder "no sealed copy was ever uploaded".
//
import { readFileSync } from 'node:fs'

import { parseRemoteEnvelope, type RemoteEnvelope } from '../../protocol/src/vault-envelope.js'
import { atomicWriteJson } from './sponsorship-store.js'

export interface StoredCredential {
  /** base64url, as WebAuthn spells it. */
  id: string
  /** base64url of the COSE public key. */
  publicKey: string
  counter: number
  transports?: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
  createdAt: number
  lastUsedAt: number
}

export interface StoredVault {
  /** base64url of the 32 opaque bytes handed to the authenticator as `user.id`. */
  userHandle: string
  createdAt: number
  credentials: StoredCredential[]
  envelope: RemoteEnvelope | null
}

interface Serialized {
  v: 1
  vaults: Record<string, StoredVault>
  /** credential id → vault id. The lookup a discoverable assertion arrives with. */
  credentials: Record<string, string>
}

export interface RecoveryStore {
  vault(id: string): StoredVault | null
  vaultIdByCredential(credentialId: string): string | null
  /** Writes the vault and re-indexes its credentials. Synchronous: no yield between check and write. */
  putVault(id: string, vault: StoredVault): void
  deleteVault(id: string): void
  /** Vaults registered but never uploaded to, older than `maxAgeMs`. Returns how many were dropped. */
  sweepOrphans(now: number, maxAgeMs: number): number
  count(): number
}

class CorruptRecoveryStore extends Error {
  constructor(path: string, why: string) {
    super(
      `the recovery ledger at ${path} is unreadable (${why}). Refusing to start: an empty ledger ` +
        `would tell every passkey holder that no sealed copy was ever uploaded. Inspect the file, ` +
        `then either repair it or delete it deliberately.`,
    )
  }
}

const B64URL = /^[A-Za-z0-9_-]+$/

function isCredential(value: unknown): value is StoredCredential {
  const c = value as Partial<StoredCredential> | null
  return (
    !!c &&
    typeof c.id === 'string' && B64URL.test(c.id) &&
    typeof c.publicKey === 'string' && B64URL.test(c.publicKey) &&
    typeof c.counter === 'number' && Number.isInteger(c.counter) && c.counter >= 0 &&
    (c.transports === undefined || (Array.isArray(c.transports) && c.transports.every((t) => typeof t === 'string'))) &&
    (c.deviceType === 'singleDevice' || c.deviceType === 'multiDevice') &&
    typeof c.backedUp === 'boolean' &&
    typeof c.createdAt === 'number' &&
    typeof c.lastUsedAt === 'number'
  )
}

function validate(path: string, value: unknown): Serialized {
  const s = value as Partial<Serialized> | null
  if (!s || s.v !== 1 || !s.vaults || typeof s.vaults !== 'object' || !s.credentials || typeof s.credentials !== 'object') {
    throw new CorruptRecoveryStore(path, 'unknown shape')
  }
  for (const [id, vault] of Object.entries(s.vaults)) {
    const v = vault as Partial<StoredVault> | null
    if (!v || typeof v.userHandle !== 'string' || !B64URL.test(v.userHandle) || typeof v.createdAt !== 'number') {
      throw new CorruptRecoveryStore(path, `vault ${id} is malformed`)
    }
    if (!Array.isArray(v.credentials) || !v.credentials.every(isCredential)) {
      throw new CorruptRecoveryStore(path, `vault ${id} has a malformed credential`)
    }
    if (v.envelope !== null && parseRemoteEnvelope(v.envelope) === null) {
      throw new CorruptRecoveryStore(path, `vault ${id} has a malformed envelope`)
    }
  }
  for (const [credentialId, vaultId] of Object.entries(s.credentials)) {
    if (typeof vaultId !== 'string' || !(vaultId in s.vaults)) {
      throw new CorruptRecoveryStore(path, `credential ${credentialId.slice(0, 8)}… points at a missing vault`)
    }
  }
  return s as Serialized
}

export function openRecoveryStore(path: string): RecoveryStore {
  let state: Serialized
  try {
    state = validate(path, JSON.parse(readFileSync(path, 'utf8')))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (e instanceof CorruptRecoveryStore) throw e
      throw new CorruptRecoveryStore(path, String(e))
    }
    // First boot. Create the file now, so a bad path fails at startup where the operator is looking.
    state = { v: 1, vaults: {}, credentials: {} }
    atomicWriteJson(path, state)
  }

  function persist() {
    atomicWriteJson(path, state satisfies Serialized)
  }

  function unindex(vaultId: string) {
    for (const [credentialId, owner] of Object.entries(state.credentials)) {
      if (owner === vaultId) delete state.credentials[credentialId]
    }
  }

  return {
    vault: (id) => state.vaults[id] ?? null,
    vaultIdByCredential: (credentialId) => state.credentials[credentialId] ?? null,
    putVault: (id, vault) => {
      unindex(id)
      state.vaults[id] = vault
      for (const credential of vault.credentials) state.credentials[credential.id] = id
      persist()
    },
    deleteVault: (id) => {
      if (!(id in state.vaults)) return
      unindex(id)
      delete state.vaults[id]
      persist()
    },
    sweepOrphans: (now, maxAgeMs) => {
      let dropped = 0
      for (const [id, vault] of Object.entries(state.vaults)) {
        if (vault.envelope === null && now - vault.createdAt > maxAgeMs) {
          unindex(id)
          delete state.vaults[id]
          dropped += 1
        }
      }
      if (dropped > 0) persist()
      return dropped
    },
    count: () => Object.keys(state.vaults).length,
  }
}
