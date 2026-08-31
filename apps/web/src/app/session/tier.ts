// The lazily-loaded tier under the session: storage, the protocol's session modules, identity
// derivation and `starknet`. Everything that drags `starknet` sits behind `import()` so the entry
// chunk stays light; the session arrives a beat after first paint.
import { accountAddressFor } from '@strk20/protocol/account-address'
import { UNLOCK_DIFFERENT_IDENTITY } from '@strk20/protocol/account-copy'
import type { StoredAccount, StoredAccounts } from '@strk20/protocol/session-accounts'
import type { VaultHeader, VaultKey } from '@strk20/protocol/session-vault'

import { publishSession, type PrivateTransfersUser, type Session, type SessionAccount } from './store'

type Protocol = typeof import('@strk20/protocol/session')
type Identity = typeof import('@strk20/protocol/identity')
type Starknet = typeof import('starknet')
type Rpc = typeof import('@strk20/protocol/rpc')

export interface Tier {
  protocol: Protocol
  identity: Identity
  sdk: Starknet
  rpc: Rpc
  store: ReturnType<Protocol['browserSessionStore']>
  accounts: ReturnType<Protocol['sessionAccountStore']>
  vaults: ReturnType<Protocol['sessionVaultStore']>
}

let tierPromise: Promise<Tier> | null = null

export function loadTier(): Promise<Tier> {
  if (tierPromise) return tierPromise
  tierPromise = Promise.all([
    import('@strk20/protocol/session'),
    import('@strk20/protocol/identity'),
    import('starknet'),
    import('@strk20/protocol/rpc'),
  ]).then(([protocol, identity, sdk, rpc]) => {
    const store = protocol.browserSessionStore()
    return {
      protocol,
      identity,
      sdk,
      rpc,
      store,
      accounts: protocol.sessionAccountStore(store),
      vaults: protocol.sessionVaultStore(store),
    }
  })
  // A failed load must not be cached: the next subscriber gets another attempt.
  tierPromise.catch(() => {
    tierPromise = null
  })
  return tierPromise
}

/** The counterfactual OZ address for a key. Exact before deployment — funds sent here wait. */
export function addressFor(t: Tier, accountKey: string): string {
  const publicKey = t.identity.deriveIdentityPublicKey(accountKey)
  return accountAddressFor(publicKey, (a, b) => t.sdk.hash.computePedersenHash(a, b))
}

/** The `{ address, signer }` the SDK proves with: a starknet Account over the embedded key. */
export function makeAccount(t: Tier, address: string, accountKey: string): PrivateTransfersUser {
  return new t.sdk.Account({ provider: t.rpc.getProvider(), address, signer: accountKey })
}

// ── The open vault, held only while unlocked ────────────────────────────────────────────────

interface OpenVault {
  key: VaultKey
  record: StoredAccounts
}

let openVault: OpenVault | null = null

export function setOpenVault(next: OpenVault | null): void {
  openVault = next
}

export function getOpenVault(): OpenVault | null {
  return openVault
}

export function hasVault(t: Tier): boolean {
  return openVault !== null || t.vaults.load().kind === 'present'
}

/** The current record: the open vault's, or the plaintext one. `null` when there is none. */
export function loadRecord(t: Tier): StoredAccounts | null {
  if (openVault) return openVault.record
  const read = t.accounts.load()
  return read.kind === 'present' ? read.record : null
}

export function headerFor(record: StoredAccounts): VaultHeader {
  return {
    active: record.active,
    accounts: record.accounts.map((a) => ({ address: a.address, label: a.label, addedAt: a.addedAt })),
  }
}

/**
 * Writes the record where it lives: plaintext when there is no vault, re-sealed under the open
 * vault key otherwise. After a sealed write the plaintext mirror is cleared again.
 */
export async function persist(t: Tier, record: StoredAccounts): Promise<void> {
  if (!openVault) {
    t.accounts.save(record)
    return
  }
  const sealed = await t.protocol.sealWithKey(t.protocol.serializeAccounts(record), headerFor(record), openVault.key)
  if (!sealed.ok) throw new Error(t.protocol.VAULT_ERROR_TEXT[sealed.error])
  t.vaults.save(sealed.value)
  openVault = { key: openVault.key, record }
  t.protocol.clearPlaintextKeys(t.store)
}

export function summarize(record: StoredAccounts): SessionAccount[] {
  return [...record.accounts]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((a) => ({ address: a.address, label: a.label }))
}

export function readySession(t: Tier, record: StoredAccounts, active: StoredAccount): Session {
  return {
    status: 'ready',
    address: active.address,
    accountKey: active.accountKey,
    account: makeAccount(t, active.address, active.accountKey),
    label: active.label,
    accounts: summarize(record),
    hasVault: hasVault(t),
  }
}

export function lockedSession(
  t: Tier,
  address: string,
  label: string | null,
  accounts: readonly SessionAccount[],
  reason?: string,
): Session {
  return {
    status: 'locked',
    address,
    label,
    accounts,
    hasVault: hasVault(t),
    ...(reason ? { reason } : {}),
  }
}

/** Publishes `ready` for the record's active account, or `locked` with a reason when it cannot. */
export function publishFromRecord(t: Tier, record: StoredAccounts, unlockProblem?: string): void {
  const active = t.protocol.activeAccount(record)
  if (!active) {
    publishSession({
      status: 'locked',
      accounts: summarize(record),
      hasVault: hasVault(t),
        reason: 'The active account is missing from this browser’s account list.',
    })
    return
  }
  if (!t.protocol.sameAddress(addressFor(t, active.accountKey), active.address)) {
    publishSession(lockedSession(t, active.address, active.label, summarize(record), UNLOCK_DIFFERENT_IDENTITY))
    return
  }
  if (record.locked) {
    publishSession(lockedSession(t, active.address, active.label, summarize(record), unlockProblem))
    return
  }
  publishSession(readySession(t, record, active))
}
