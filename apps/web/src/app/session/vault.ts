// Lock, unlock and the password side of the vault. Two locks, told apart everywhere: without a
// vault the lock is a screen lock over a plaintext key (`LOCK_WHAT_IT_DOES`); with one, the
// accounts are sealed at rest and the plaintext mirror is deleted. A v1 vault is the password
// alone; a v2 vault is a VEK with wrappers, and the password is one wrapper among them.
import { LOCK_NOT_SAVED, UNLOCK_DIFFERENT_IDENTITY } from '@strk20/protocol/account-copy'
import type { StoredVault, VaultV2 } from '@strk20/protocol/session-vault'

import { ensureBooted } from './boot'
import { clearRecoveryState } from './recovery-state'
import { getSessionSnapshot, publishSession } from './store'
import { addressFor, getOpenVault, headerFor, loadRecord, loadTier, lockedSession, persistEnvelope, publishFromRecord, setOpenVault, type Tier } from './tier'

export type Outcome = { ok: true } | { ok: false; error: string }

const refuse = (error: string): Outcome => ({ ok: false, error })

const NO_PASSWORD = 'This wallet has no password. Unlock it with your passkey.'
const HAS_PASSWORD = 'This wallet already has a password. Change it instead.'
const NEEDS_OPEN = 'Open your wallet before changing how it is protected.'

/** Drops the key out of this page. Synchronous: the snapshot changes before the caller returns. */
export function lock(): void {
  const current = getSessionSnapshot()
  if (current.status !== 'ready') return
  setOpenVault(null)
  clearRecoveryState()
  const locked = {
    status: 'locked' as const,
    address: current.address,
    label: current.label ?? null,
    accounts: current.accounts,
    hasVault: current.hasVault,
    protection: current.protection,
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

/** The opened plaintext, checked and published. Shared by every way a vault opens. */
export function adoptOpened(t: Tier, plaintext: string, open: (record: Parameters<typeof publishFromRecord>[1]) => void): Outcome {
  const read = t.protocol.parseStoredAccounts(plaintext)
  if (read.kind !== 'present') {
    return refuse(
      read.kind === 'unreadable'
        ? `This wallet opened, but the accounts inside it could not be read: ${read.reason}. Your Recovery File still works.`
        : 'This wallet opened, but there are no accounts inside it. Your Recovery File still works.',
    )
  }
  const active = t.protocol.activeAccount(read.record)
  if (!active) return refuse('The active account is missing from this browser’s account list.')
  for (const account of read.record.accounts) {
    if (!t.protocol.sameAddress(addressFor(t, account.accountKey), account.address)) return refuse(UNLOCK_DIFFERENT_IDENTITY)
  }
  const record = t.protocol.withLocked(read.record, false)
  open(record)
  publishFromRecord(t, record)
  return { ok: true }
}

async function unseal(t: Tier, vault: StoredVault, password: string): Promise<Outcome> {
  if (vault.v === 1) {
    const opened = await t.protocol.openVault(vault, password)
    if (!opened.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[opened.error])
    return adoptOpened(t, opened.value.plaintext, (record) => setOpenVault({ v: 1, key: opened.value.vaultKey, record }))
  }
  const wrapper = t.protocol.passwordWrapper(vault)
  if (!wrapper) return refuse(NO_PASSWORD)
  const kek = await t.protocol.passwordKek(password, wrapper.kdf)
  if (!kek.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[kek.error])
  const vek = await t.protocol.unwrapVek(wrapper, kek.value)
  if (!vek.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[vek.error])
  const opened = await t.protocol.openEnvelope(vault, vek.value, vault.vault.id)
  if (!opened.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[opened.error])
  return adoptOpened(t, opened.value, (record) => setOpenVault({ v: 2, vek: vek.value, envelope: vault, record }))
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

/** Proves a v2 vault's password wrapper and hands back the raw VEK — for the caller to re-wrap and zero. */
export async function proveV2Password(t: Tier, envelope: VaultV2, password: string): Promise<{ ok: true; raw: Uint8Array } | { ok: false; error: string }> {
  const wrapper = t.protocol.passwordWrapper(envelope)
  if (!wrapper) return { ok: false, error: NO_PASSWORD }
  const kek = await t.protocol.passwordKek(password, wrapper.kdf)
  if (!kek.ok) return { ok: false, error: t.protocol.VAULT_ERROR_TEXT[kek.error] }
  const raw = await t.protocol.unwrapVekRaw(wrapper, kek.value)
  if (!raw.ok) return { ok: false, error: t.protocol.VAULT_ERROR_TEXT[raw.error] }
  return { ok: true, raw: raw.value }
}

/** A NEW password wrapper over raw VEK bytes; the bytes are zeroed here whatever happens. */
export async function passwordWrapperFor(t: Tier, raw: Uint8Array, password: string): Promise<{ ok: true; wrapper: VaultV2['wrappers'][number] } | { ok: false; error: string }> {
  try {
    if (password.length < t.protocol.MIN_PASSWORD_LENGTH) return { ok: false, error: t.protocol.VAULT_ERROR_TEXT['password-too-short'] }
    const kdf = t.protocol.newPasswordKdf()
    const kek = await t.protocol.passwordKek(password, kdf)
    if (!kek.ok) return { ok: false, error: t.protocol.VAULT_ERROR_TEXT[kek.error] }
    const wrapped = await t.protocol.wrapVek(raw, kek.value, { kind: 'password' as const, id: t.protocol.newWrapperId(), kdf })
    if (!wrapped.ok) return { ok: false, error: t.protocol.VAULT_ERROR_TEXT[wrapped.error] }
    return { ok: true, wrapper: wrapped.value }
  } finally {
    raw.fill(0)
  }
}

/**
 * Seals the accounts under a password and deletes the plaintext. Write, read back, reopen —
 * only then is the plaintext cleared, so a failed save leaves the wallet exactly as it was.
 * On a v2 vault the password becomes one more wrapper; the passkey re-proves once to hand over
 * the VEK, because the key in memory is deliberately not extractable.
 */
export async function setPassword(password: string, reprove?: () => Promise<Uint8Array>): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  if (getSessionSnapshot().status !== 'ready') return refuse('Open your wallet before setting a password.')
  const open = getOpenVault()
  if (open?.v === 2) {
    if (t.protocol.passwordWrapper(open.envelope)) return refuse(HAS_PASSWORD)
    if (!reprove) return refuse('Approve your passkey once to add a password beside it.')
    const raw = await reprove()
    const made = await passwordWrapperFor(t, raw, password)
    if (!made.ok) return refuse(made.error)
    await persistEnvelope(t, open.record, { wrappers: t.protocol.withWrapper(open.envelope, made.wrapper).wrappers })
    publishFromRecord(t, open.record)
    return { ok: true }
  }
  const record = loadRecord(t)
  if (!record) return refuse('There is no account list in this browser to protect.')

  const unlocked = t.protocol.withLocked(record, false)
  const sealed = await t.protocol.sealVault(t.protocol.serializeAccounts(unlocked), headerFor(unlocked), password)
  if (!sealed.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[sealed.error])
  t.vaults.save(sealed.value)

  const echo = t.vaults.load()
  if (echo.kind !== 'present' || echo.vault.v !== 1) {
    return refuse('The password could not be saved in this browser, so nothing was changed and your wallet is still unprotected.')
  }
  const reopened = await t.protocol.openVault(echo.vault, password)
  if (!reopened.ok) {
    return refuse('The password was saved but could not be used to reopen the wallet, so nothing was deleted. Try again.')
  }
  t.protocol.clearPlaintextKeys(t.store)
  setOpenVault({ v: 1, key: reopened.value.vaultKey, record: unlocked })
  publishFromRecord(t, unlocked)
  return { ok: true }
}

/** v1: remove then set, as before. v2: the wrapper is swapped under the VEK — no plaintext moment. */
export async function changePassword(current: string, next: string): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  const open = getOpenVault()
  if (!open) return refuse(NEEDS_OPEN)
  if (open.v === 1) {
    const removed = await removePassword(current)
    if (!removed.ok) return removed
    return setPassword(next)
  }
  const proved = await proveV2Password(t, open.envelope, current)
  if (!proved.ok) return refuse(proved.error)
  const made = await passwordWrapperFor(t, proved.raw, next)
  if (!made.ok) return refuse(made.error)
  const old = t.protocol.passwordWrapper(open.envelope)!
  const wrappers = t.protocol.withWrapper(t.protocol.withoutWrapper(open.envelope, old.id), made.wrapper).wrappers
  await persistEnvelope(t, open.record, { wrappers })
  publishFromRecord(t, open.record)
  return { ok: true }
}

/**
 * Proves the password once more, then drops it. v1: the accounts go back to plaintext. v2: the
 * password wrapper goes; when a passkey still seals the vault nothing else moves, and when it was
 * the last wrapper the accounts go back to plaintext exactly as in v1.
 */
export async function removePassword(password: string): Promise<Outcome> {
  await ensureBooted()
  const t = await loadTier()
  const sealed = t.vaults.load()
  if (sealed.kind !== 'present') return refuse('This wallet has no password to remove.')
  if (sealed.vault.v === 2) {
    const open = getOpenVault()
    if (!open || open.v !== 2) return refuse(NEEDS_OPEN)
    const proved = await proveV2Password(t, open.envelope, password)
    if (!proved.ok) return refuse(proved.error)
    proved.raw.fill(0)
    const wrapper = t.protocol.passwordWrapper(open.envelope)!
    const remaining = t.protocol.withoutWrapper(open.envelope, wrapper.id).wrappers
    if (remaining.length > 0) {
      await persistEnvelope(t, open.record, { wrappers: remaining })
      publishFromRecord(t, open.record)
      return { ok: true }
    }
    setOpenVault(null)
    t.accounts.save(open.record)
    t.vaults.clear()
    publishFromRecord(t, open.record)
    return { ok: true }
  }
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
