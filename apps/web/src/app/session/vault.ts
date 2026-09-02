// Lock, unlock and the password vault. Two locks, told apart everywhere: without a password the
// lock is a screen lock over a plaintext key (`LOCK_WHAT_IT_DOES`); with one, the accounts are
// sealed at rest and the plaintext mirror is deleted (`LOCK_WHAT_IT_DOES_SEALED`).
import { LOCK_NOT_SAVED, UNLOCK_DIFFERENT_IDENTITY } from '@strk20/protocol/account-copy'
import type { StoredVault } from '@strk20/protocol/session-vault'

import { ensureBooted } from './boot'
import { getSessionSnapshot, publishSession } from './store'
import { addressFor, getOpenVault, headerFor, loadRecord, loadTier, lockedSession, publishFromRecord, setOpenVault, type Tier } from './tier'

export type Outcome = { ok: true } | { ok: false; error: string }

const refuse = (error: string): Outcome => ({ ok: false, error })

// Placeholder until the passkey session tier lands: a v2 vault is readable but not yet openable here.
const V2_NOT_YET = 'This wallet is sealed by a passkey, which this build cannot open yet.'

/** Drops the key out of this page. Synchronous: the snapshot changes before the caller returns. */
export function lock(): void {
  const current = getSessionSnapshot()
  if (current.status !== 'ready') return
  setOpenVault(null)
  const locked = {
    status: 'locked' as const,
    address: current.address,
    label: current.label ?? null,
    accounts: current.accounts,
    hasVault: current.hasVault,
  }
  publishSession(locked)
  if (current.hasVault) return // sealed at rest — durable by construction
  void loadTier().then((t) => {
    const read = t.accounts.load()
    if (read.kind !== 'present') {
      publishSession({ ...locked, reason: LOCK_NOT_SAVED })
      return
    }
    try {
      t.accounts.save(t.protocol.withLocked(read.record, true))
    } catch {
      publishSession({ ...locked, reason: LOCK_NOT_SAVED })
    }
  })
}

async function unseal(t: Tier, vault: StoredVault, password: string): Promise<Outcome> {
  if (vault.v !== 1) return refuse(V2_NOT_YET)
  const opened = await t.protocol.openVault(vault, password)
  if (!opened.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[opened.error])
  const read = t.protocol.parseStoredAccounts(opened.value.plaintext)
  if (read.kind !== 'present') {
    return refuse(
      read.kind === 'unreadable'
        ? `This wallet opened, but the accounts inside it could not be read: ${read.reason}. Your Recovery File still works.`
        : 'This wallet opened, but there are no accounts inside it. Your Recovery File still works.',
    )
  }
  const active = t.protocol.activeAccount(read.record)
  if (!active) return refuse('The active account is missing from this browser’s account list.')
  if (!t.protocol.sameAddress(addressFor(t, active.accountKey), active.address)) {
    return refuse(UNLOCK_DIFFERENT_IDENTITY)
  }
  const record = t.protocol.withLocked(read.record, false)
  setOpenVault({ key: opened.value.vaultKey, record })
  publishFromRecord(t, record)
  return { ok: true }
}

/** Password is ignored on a plaintext (screen) lock; required when a vault is present. */
export async function unlock(password: string): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  const current = getSessionSnapshot()
  const republish = (error: string): Outcome => {
    if (current.status === 'locked') {
      publishSession(lockedSession(t, current.address ?? '', current.label ?? null, current.accounts, error))
    }
    return refuse(error)
  }

  const sealed = t.vaults.load()
  if (sealed.kind === 'damaged') return republish(`The locked wallet in this browser could not be read: ${sealed.reason}`)
  if (sealed.kind === 'present') {
    const outcome = await unseal(t, sealed.vault, password)
    return outcome.ok ? outcome : republish(outcome.error)
  }

  const read = t.accounts.load()
  if (read.kind !== 'present') {
    return republish(
      read.kind === 'unreadable'
        ? `The accounts saved in this browser could not be read: ${read.reason}`
        : 'There is no account saved in this browser to unlock.',
    )
  }
  const active = t.protocol.activeAccount(read.record)
  if (active && !t.protocol.sameAddress(addressFor(t, active.accountKey), active.address)) {
    return republish(UNLOCK_DIFFERENT_IDENTITY)
  }
  const record = t.protocol.withLocked(read.record, false)
  t.accounts.save(record)
  publishFromRecord(t, record)
  return { ok: true }
}

/**
 * Seals the accounts under a password and deletes the plaintext. Write, read back, reopen —
 * only then is the plaintext cleared, so a failed save leaves the wallet exactly as it was.
 */
export async function setPassword(password: string): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  if (getSessionSnapshot().status !== 'ready') return refuse('Open your wallet before setting a password.')
  const record = loadRecord(t)
  if (!record) return refuse('There is no account list in this browser to protect.')

  const open = t.protocol.withLocked(record, false)
  const sealed = await t.protocol.sealVault(t.protocol.serializeAccounts(open), headerFor(open), password)
  if (!sealed.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[sealed.error])
  t.vaults.save(sealed.value)

  const echo = t.vaults.load()
  if (echo.kind !== 'present') {
    return refuse('The password could not be saved in this browser, so nothing was changed and your wallet is still unprotected.')
  }
  const reopened = echo.vault.v === 1 ? await t.protocol.openVault(echo.vault, password) : null
  if (!reopened?.ok) {
    return refuse('The password was saved but could not be used to reopen the wallet, so nothing was deleted. Try again.')
  }
  t.protocol.clearPlaintextKeys(t.store)
  setOpenVault({ key: reopened.value.vaultKey, record: open })
  publishFromRecord(t, open)
  return { ok: true }
}

/** Proves the password once more, then writes the accounts back in plaintext and drops the vault. */
export async function removePassword(password: string): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  const sealed = t.vaults.load()
  if (sealed.kind !== 'present') return refuse('This wallet has no password to remove.')
  if (sealed.vault.v !== 1) return refuse(V2_NOT_YET)
  const opened = await t.protocol.openVault(sealed.vault, password)
  if (!opened.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[opened.error])
  const read = t.protocol.parseStoredAccounts(opened.value.plaintext)
  if (read.kind !== 'present') {
    return refuse('The wallet opened but its contents could not be read, so the password was left in place. Removing it now would leave nothing behind.')
  }
  const record = getOpenVault()?.record ?? read.record
  setOpenVault(null)
  t.accounts.save(record)
  t.vaults.clear()
  publishFromRecord(t, record)
  return { ok: true }
}
