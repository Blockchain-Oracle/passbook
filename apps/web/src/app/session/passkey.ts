// The passkey side of the vault: protect, unlock, restore, remove, and the sealed-copy sync.
//
// A passkey never makes a key. It unlocks the box: the PRF output becomes a KEK that wraps the
// VEK, and the VEK opens the same accounts record a password opens. Registration needs the
// relayer (it is the verifier for the fresh-device restore); an unlock never does — the
// ciphertext is the verifier there, and a local challenge is enough.
//
// The VEK in memory is not extractable, so making a NEW wrapper re-proves an existing one for
// the raw bytes, which are zeroed the moment the new wrapper exists.
import { PASSKEY_ERROR_TEXT } from '@strk20/protocol/passkey-copy'
import {
  PRF_INPUT,
  RECOVERY_BEHIND,
  RECOVERY_CONFLICT,
  RECOVERY_ENVELOPE_UNOPENABLE,
  RECOVERY_NO_ENVELOPE,
  RECOVERY_NOT_EMPTY,
  RECOVERY_SESSION_EXPIRED,
} from '@strk20/protocol/recovery-wire'
import type { PasskeyWrapper, RemoteEnvelope, VekWrapper } from '@strk20/protocol/session-vault'

import { assertPasskey, createPasskey, localAssertionOptions, PasskeyError, passkeySupport } from '@/lib/passkey-ceremony'
import { postAuthOptions, postAuthVerify, postEnvelopeDelete, postEnvelopePut, postRegisterOptions, postRegisterVerify, RecoveryError } from '@/queries/recovery'

import { ensureBooted } from './boot'
import { clearRecoveryState, getRecoverySession, getRemoteRevision, setRecoverySession, setRemoteRevision, setSyncState } from './recovery-state'
import { getSessionSnapshot, publishSession } from './store'
import { getOpenVault, headerFor, loadRecord, loadTier, lockedSession, persistEnvelope, publishFromRecord, refreshProtection, setOpenVault, type Tier } from './tier'
import { adoptOpened, proveV2Password, type Outcome } from './vault'

const refuse = (error: string): Outcome => ({ ok: false, error })
const NEEDS_OPEN = 'Open your wallet before changing how it is protected.'
const NO_PASSKEY = 'No passkey seals this wallet.'
const HAS_PASSKEY = 'A passkey already seals this wallet.'
const origin = () => location.origin
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function tier(): Promise<Tier> {
  await ensureBooted()
  return loadTier()
}

/** One assertion against the relayer: the PRF bytes plus a recovery session for later syncs. */
async function assertWithRelayer(credentialId: string | null) {
  const { options } = await postAuthOptions({ origin: origin(), ...(credentialId ? { credentialId } : {}) })
  const asserted = await assertPasskey(options)
  const verified = await postAuthVerify({ challenge: options.challenge, response: asserted.response })
  setRecoverySession(verified.session)
  return { ...asserted, verified }
}

/** PRF → KEK → the raw VEK out of the matching wrapper. The caller owns (and zeroes) the bytes. */
async function rawVekFromPrf(t: Tier, prf: Uint8Array, wrapper: PasskeyWrapper): Promise<Uint8Array> {
  const kek = await t.protocol.passkeyKek(prf, wrapper.hkdf)
  if (!kek.ok) throw new Error(t.protocol.VAULT_ERROR_TEXT[kek.error])
  const raw = await t.protocol.unwrapVekRaw(wrapper, kek.value)
  if (!raw.ok) throw new Error(t.protocol.VAULT_ERROR_TEXT[raw.error])
  return raw.value
}

/** Re-proves the vault's passkey (relayer when reachable, else locally) for the raw VEK. */
export async function reproveWithPasskey(): Promise<Uint8Array> {
  const t = await tier()
  const open = getOpenVault()
  if (!open || open.v !== 2) throw new Error(NEEDS_OPEN)
  const wrapper = t.protocol.passkeyWrappers(open.envelope)[0]
  if (!wrapper) throw new Error(NO_PASSKEY)
  let asserted: Awaited<ReturnType<typeof assertPasskey>>
  try {
    asserted = await assertWithRelayer(wrapper.credentialId)
  } catch (e) {
    if (e instanceof PasskeyError) throw e
    asserted = await assertPasskey(localAssertionOptions(wrapper.credentialId))
  }
  if (!asserted.prf) throw new PasskeyError('unsupported-prf')
  return rawVekFromPrf(t, asserted.prf, wrapper)
}

/**
 * Registers a passkey and seals the accounts under it. The order is the safety property: the
 * new wrapper is opened once BEFORE anything on disk changes, and the plaintext (or the v1
 * vault) is only cleared after the v2 vault has been written and read back.
 */
export async function protectWithPasskey(opts: { password?: string } = {}): Promise<Outcome> {
  const t = await tier()
  if (getSessionSnapshot().status !== 'ready') return refuse(NEEDS_OPEN)
  if ((await passkeySupport()) === 'unsupported') return refuse(PASSKEY_ERROR_TEXT.unsupported)
  const open = getOpenVault()
  const record = loadRecord(t)
  if (!record) return refuse('There is no account list in this browser to protect.')
  if (open?.v === 2 && t.protocol.passkeyWrappers(open.envelope).length > 0) return refuse(HAS_PASSKEY)

  let raw: Uint8Array | null = null
  try {
    // 1. The VEK: fresh for a plaintext or v1 wallet; re-proved out of a password-only v2.
    let vek: CryptoKey
    let wrappers: VekWrapper[]
    if (open?.v === 2) {
      if (!opts.password) return refuse('Adding a passkey to this wallet needs its password once.')
      const proved = await proveV2Password(t, open.envelope, opts.password)
      if (!proved.ok) return refuse(proved.error)
      raw = proved.raw
      vek = open.vek
      wrappers = [...open.envelope.wrappers]
    } else {
      const fresh = await t.protocol.generateVek()
      if (!fresh.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[fresh.error])
      raw = fresh.value.raw
      vek = fresh.value.key
      wrappers = []
      if (open?.v === 1) {
        // The v1 key in memory IS a password KEK — no re-entry needed to carry the password over.
        const kdf = { name: 'PBKDF2' as const, hash: 'SHA-256' as const, iterations: open.key.iterations, salt: open.key.salt }
        const pw = await t.protocol.wrapVek(raw, open.key.key, { kind: 'password' as const, id: t.protocol.newWrapperId(), kdf })
        if (!pw.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[pw.error])
        wrappers.push(pw.value)
      }
    }

    // 2. Register with the relayer, then assert the new passkey for its PRF. Two prompts, always.
    const reg = await postRegisterOptions({ origin: origin() })
    const created = await createPasskey(reg.options)
    const registered = await postRegisterVerify({ challenge: reg.options.challenge, response: created })
    const asserted = await assertWithRelayer(registered.credentialId)
    if (!asserted.prf) return refuse(PASSKEY_ERROR_TEXT['unsupported-prf'])

    // 3. Wrap, and open the new wrapper once before anything is written.
    const hkdf = { salt: t.protocol.newHkdfSalt(), info: 'strk20.run/vek-wrap/v1' as const }
    const kek = await t.protocol.passkeyKek(asserted.prf, hkdf)
    if (!kek.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[kek.error])
    const wrapped = await t.protocol.wrapVek(raw, kek.value, {
      kind: 'passkey' as const,
      id: t.protocol.newWrapperId(),
      credentialId: registered.credentialId,
      hkdf,
      prfInput: PRF_INPUT,
      backedUp: asserted.verified.backedUp,
      addedAt: Date.now(),
    })
    if (!wrapped.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[wrapped.error])
    const proof = await t.protocol.unwrapVek(wrapped.value, kek.value)
    if (!proof.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[proof.error])
    wrappers.push(wrapped.value)

    // 4. Write the v2 vault, read it back, only then clear what it replaces.
    const unlocked = t.protocol.withLocked(record, false)
    const sealed = await t.protocol.sealEnvelope(t.protocol.serializeAccounts(unlocked), headerFor(unlocked), vek, registered.vaultId, wrappers)
    if (!sealed.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[sealed.error])
    const reopened = await t.protocol.openEnvelope(sealed.value, proof.value, registered.vaultId)
    if (!reopened.ok || reopened.value !== t.protocol.serializeAccounts(unlocked)) return refuse(RECOVERY_ENVELOPE_UNOPENABLE)
    const previous = t.vaults.load()
    t.vaults.save(sealed.value)
    const echo = t.vaults.load()
    if (echo.kind !== 'present' || echo.vault.v !== 2) {
      if (previous.kind === 'present') t.vaults.save(previous.vault)
      return refuse('The passkey vault could not be saved in this browser, so nothing was changed.')
    }
    t.protocol.clearPlaintextKeys(t.store)
    setOpenVault({ v: 2, vek, envelope: sealed.value, record: unlocked })
    setRemoteRevision(0)
    setSyncState('behind')
    publishFromRecord(t, unlocked)
    // 5. The sealed copy. A failed upload is a sync problem, not a failed protect.
    await pushEnvelope()
    return { ok: true }
  } catch (e) {
    return refuse(message(e))
  } finally {
    raw?.fill(0)
  }
}

/** Unlock with the passkey: the relayer when reachable (it also earns a sync session), else locally. */
export async function unlockWithPasskey(): Promise<Outcome> {
  const t = await tier()
  const current = getSessionSnapshot()
  const republish = (error: string): Outcome => {
    if (current.status === 'locked') publishSession(lockedSession(t, current.address ?? '', current.label ?? null, current.accounts, error))
    return refuse(error)
  }
  const sealed = t.vaults.load()
  if (sealed.kind === 'damaged') return republish(`The locked wallet in this browser could not be read: ${sealed.reason}`)
  if (sealed.kind !== 'present' || sealed.vault.v !== 2) return republish(NO_PASSKEY)
  const envelope = sealed.vault
  const wrappers = t.protocol.passkeyWrappers(envelope)
  const first = wrappers[0]
  if (!first) return republish(NO_PASSKEY)
  try {
    let asserted: Awaited<ReturnType<typeof assertPasskey>>
    let remote: RemoteEnvelope | null | undefined
    try {
      const online = await assertWithRelayer(first.credentialId)
      asserted = online
      remote = online.verified.envelope
    } catch (e) {
      if (e instanceof PasskeyError) throw e
      // Unreachable or refused: the ciphertext is the verifier, a local challenge will do.
      asserted = await assertPasskey(localAssertionOptions(first.credentialId))
    }
    if (!asserted.prf) return republish(PASSKEY_ERROR_TEXT['unsupported-prf'])
    const wrapper = wrappers.find((w) => w.credentialId === asserted.response.id) ?? first
    const kek = await t.protocol.passkeyKek(asserted.prf, wrapper.hkdf)
    if (!kek.ok) return republish(t.protocol.VAULT_ERROR_TEXT[kek.error])
    const vek = await t.protocol.unwrapVek(wrapper, kek.value)
    if (!vek.ok) return republish(t.protocol.VAULT_ERROR_TEXT[vek.error])
    const opened = await t.protocol.openEnvelope(envelope, vek.value, envelope.vault.id)
    if (!opened.ok) return republish(t.protocol.VAULT_ERROR_TEXT[opened.error])
    if (remote !== undefined) {
      setRemoteRevision(remote?.revision ?? 0)
      setSyncState(remote && remote.body === envelope.body ? 'synced' : 'behind')
    }
    const outcome = adoptOpened(t, opened.value, (record) => setOpenVault({ v: 2, vek: vek.value, envelope, record }))
    return outcome.ok ? outcome : republish(outcome.error)
  } catch (e) {
    return republish(message(e))
  }
}

/** A fresh browser gets the account list back from the sealed copy. Refuses on a used one. */
export async function restoreWithPasskey(): Promise<Outcome> {
  const t = await tier()
  if (t.vaults.load().kind !== 'absent' || t.accounts.load().kind !== 'absent') return refuse(RECOVERY_NOT_EMPTY)
  if ((await passkeySupport()) === 'unsupported') return refuse(PASSKEY_ERROR_TEXT.unsupported)
  try {
    const asserted = await assertWithRelayer(null)
    if (!asserted.prf) return refuse(PASSKEY_ERROR_TEXT['unsupported-prf'])
    const { verified } = asserted
    if (!verified.envelope) return refuse(RECOVERY_NO_ENVELOPE)
    const wrapper = verified.envelope.wrappers.find((w) => w.credentialId === verified.credentialId)
    if (!wrapper) return refuse(RECOVERY_ENVELOPE_UNOPENABLE)
    const kek = await t.protocol.passkeyKek(asserted.prf, wrapper.hkdf)
    if (!kek.ok) return refuse(t.protocol.VAULT_ERROR_TEXT[kek.error])
    const vek = await t.protocol.unwrapVek(wrapper, kek.value)
    if (!vek.ok) return refuse(RECOVERY_ENVELOPE_UNOPENABLE)
    const opened = await t.protocol.openEnvelope(verified.envelope, vek.value, verified.vaultId)
    if (!opened.ok) return refuse(RECOVERY_ENVELOPE_UNOPENABLE)
    const envelope = verified.envelope
    return adoptOpened(t, opened.value, (record) => {
      const local = t.protocol.localVaultFromRemote(envelope, headerFor(record), verified.vaultId)
      t.vaults.save(local)
      setOpenVault({ v: 2, vek: vek.value, envelope: local, record })
      setRemoteRevision(envelope.revision)
      setSyncState('synced')
    })
  } catch (e) {
    return refuse(message(e))
  }
}

/** Drops the passkey here AND the sealed copy at the relayer; the relayer first, so no copy lingers unannounced. */
export async function removePasskey(): Promise<Outcome> {
  const t = await tier()
  const open = getOpenVault()
  if (!open || open.v !== 2) return refuse(NEEDS_OPEN)
  const passkeys = t.protocol.passkeyWrappers(open.envelope)
  if (passkeys.length === 0) return refuse(NO_PASSKEY)
  try {
    let token = getRecoverySession()
    if (!token) token = (await assertWithRelayer(passkeys[0]!.credentialId)).verified.session
    try {
      await postEnvelopeDelete({ session: token })
    } catch (e) {
      // Already gone at the relayer is not a failure to remove it.
      if (!(e instanceof RecoveryError && e.status === 404)) throw e
    }
    clearRecoveryState()
    const remaining = open.envelope.wrappers.filter((w) => w.kind !== 'passkey')
    if (remaining.length > 0) {
      await persistEnvelope(t, open.record, { wrappers: remaining, vaultId: null })
      publishFromRecord(t, open.record)
      return { ok: true }
    }
    setOpenVault(null)
    t.accounts.save(open.record)
    t.vaults.clear()
    publishFromRecord(t, open.record)
    return { ok: true }
  } catch (e) {
    return refuse(message(e))
  }
}

/** Adds accounts the remote copy has and this browser lacks, and wrappers likewise. Never drops. */
async function mergeRemote(t: Tier, open: Extract<NonNullable<ReturnType<typeof getOpenVault>>, { v: 2 }>, remote: RemoteEnvelope | null) {
  if (!remote) return null
  const opened = await t.protocol.openEnvelope(remote, open.vek, open.envelope.vault.id)
  if (!opened.ok) throw new RecoveryError(RECOVERY_CONFLICT, null)
  const read = t.protocol.parseStoredAccounts(opened.value)
  if (read.kind !== 'present') throw new RecoveryError(RECOVERY_CONFLICT, null)
  let record = open.record
  for (const account of read.record.accounts) {
    if (!record.accounts.some((a) => t.protocol.sameAddress(a.address, account.address))) record = t.protocol.withAccount(record, account)
  }
  const known = new Set(open.envelope.wrappers.map((w) => w.id))
  const wrappers = [...open.envelope.wrappers, ...remote.wrappers.filter((w) => !known.has(w.id))]
  return { record, wrappers }
}

/** Uploads the sealed copy; on a revision conflict, merges the server's copy in and tries once more. */
export async function pushEnvelope(): Promise<Outcome> {
  const t = await tier()
  const token = getRecoverySession()
  const open = getOpenVault()
  if (!open || open.v !== 2 || !open.envelope.vault.id) return { ok: true }
  if (!token) {
    setSyncState('behind')
    refreshProtection(t)
    return refuse(RECOVERY_BEHIND)
  }
  setSyncState('syncing')
  refreshProtection(t)
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const live = getOpenVault()
      if (!live || live.v !== 2) return { ok: true }
      const out = await postEnvelopePut({ session: token, revision: getRemoteRevision(), envelope: t.protocol.remoteEnvelopeOf(live.envelope, getRemoteRevision()) })
      if (out.ok) {
        setRemoteRevision(out.revision)
        setSyncState('synced')
        refreshProtection(t)
        return { ok: true }
      }
      setRemoteRevision(out.conflict.revision)
      const merged = await mergeRemote(t, live, out.conflict.envelope)
      if (merged) {
        await persistEnvelope(t, merged.record, { wrappers: merged.wrappers })
        publishFromRecord(t, merged.record)
        setSyncState('syncing')
      }
    }
    throw new RecoveryError(RECOVERY_CONFLICT, null)
  } catch (e) {
    if (e instanceof RecoveryError && e.status === 401) {
      setRecoverySession(null)
      setSyncState('behind', RECOVERY_SESSION_EXPIRED)
    } else {
      setSyncState('behind', message(e))
    }
    refreshProtection(t)
    return refuse(message(e))
  }
}

/** Settings' one button: earn a session with the passkey if there is none, then push. */
export async function syncNow(): Promise<Outcome> {
  const t = await tier()
  const open = getOpenVault()
  if (!open || open.v !== 2) return refuse(NEEDS_OPEN)
  const wrapper = t.protocol.passkeyWrappers(open.envelope)[0]
  if (!wrapper) return refuse(NO_PASSKEY)
  try {
    if (!getRecoverySession()) await assertWithRelayer(wrapper.credentialId)
  } catch (e) {
    setSyncState('behind', message(e))
    refreshProtection(t)
    return refuse(message(e))
  }
  return pushEnvelope()
}
