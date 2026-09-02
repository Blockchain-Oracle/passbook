//
// Vault v2: one sealed body under a random Vault Encryption Key (VEK), and N wrappers that each
// seal the VEK under a different key — a password (PBKDF2) or a passkey (WebAuthn PRF → HKDF).
// The body is what v1 sealed; only the key management changed. The header is plaintext on
// purpose, exactly as in v1: the lock screen draws it with no key.
//
// The REMOTE copy is this minus the header and minus every password wrapper: the relayer holds
// ciphertext it cannot open and passkey public state it cannot use. It lives under the same
// storage key as v1 — `parseVault` dispatches on `v`.
//
// Once a vault is v2 it stays v2. Downgrading to v1 needs a password-derived key, which a passkey
// unlock never holds; a v2 with a lone password wrapper is a legitimate shape.
//

import type { VaultResult } from './vault.js'
import { PRF_INPUT } from './recovery-wire.js'
import { buffer, fromBase64, randomBytes, subtleOrNull, toBase64, utf8 } from './vault-bytes.js'
import { readHeader, type VaultHeader } from './vault-header.js'
import { CIPHER_NAME, IV_BYTES, KDF_HASH, KDF_NAME } from './vault-kdf.js'

export const VAULT_V2 = 2
export const WRAP_INFO = 'strk20.run/vek-wrap/v1'

export interface PasswordWrapper {
  readonly kind: 'password'
  readonly id: string
  readonly kdf: { readonly name: typeof KDF_NAME; readonly hash: typeof KDF_HASH; readonly iterations: number; readonly salt: string }
  readonly iv: string
  readonly wrapped: string
}

export interface PasskeyWrapper {
  readonly kind: 'passkey'
  readonly id: string
  /** base64url, as WebAuthn spells it. Public: it is the verifier's lookup key. */
  readonly credentialId: string
  readonly hkdf: { readonly salt: string; readonly info: typeof WRAP_INFO }
  readonly prfInput: typeof PRF_INPUT
  readonly iv: string
  readonly wrapped: string
  /** What the provider reported at registration: synced, or bound to that one device. */
  readonly backedUp: boolean
  readonly addedAt: number
}

export type VekWrapper = PasswordWrapper | PasskeyWrapper

/** What sits in storage under `SESSION_KEYS.vault` when a passkey has ever been involved. */
export interface VaultV2 {
  readonly v: typeof VAULT_V2
  readonly header: VaultHeader
  /** The relayer's opaque id for the remote copy; `null` until one exists. */
  readonly vault: { readonly id: string | null }
  readonly cipher: { readonly name: typeof CIPHER_NAME; readonly iv: string }
  /** base64 AES-GCM ciphertext of a serialized accounts record, AAD-bound to the vault id. */
  readonly body: string
  readonly wrappers: readonly VekWrapper[]
}

/** The relayer's copy: no header, passkey wrappers only, and a revision for compare-and-swap. */
export interface RemoteEnvelope {
  readonly v: typeof VAULT_V2
  readonly cipher: { readonly name: typeof CIPHER_NAME; readonly iv: string }
  readonly body: string
  readonly wrappers: readonly PasskeyWrapper[]
  readonly revision: number
}

/** The body's AAD names the remote vault, so a copy cannot be replayed under another id. */
export function bodyAad(vaultId: string | null): Uint8Array {
  return utf8(`strk20.run/vault/v2/${vaultId ?? 'local'}`)
}

export function newWrapperId(): string {
  return toBase64(randomBytes(9)).replace(/\+/g, '-').replace(/\//g, '_')
}

/** Seals the accounts record under the VEK. A FRESH IV every time — reuse under one key is catastrophic. */
export async function sealEnvelope(
  plaintext: string,
  header: VaultHeader,
  vek: CryptoKey,
  vaultId: string | null,
  wrappers: readonly VekWrapper[],
): Promise<VaultResult<VaultV2>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  const iv = randomBytes(IV_BYTES)
  try {
    const sealed = await subtle.encrypt(
      { name: CIPHER_NAME, iv: buffer(iv), additionalData: buffer(bodyAad(vaultId)) },
      vek,
      buffer(utf8(plaintext)),
    )
    return {
      ok: true,
      value: {
        v: VAULT_V2,
        header,
        vault: { id: vaultId },
        cipher: { name: CIPHER_NAME, iv: toBase64(iv) },
        body: toBase64(new Uint8Array(sealed)),
        wrappers,
      },
    }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/** Structure is checked before the key is tried, so `unopenable` means the key, not the bytes. */
export async function openEnvelope(
  env: { readonly cipher: VaultV2['cipher']; readonly body: string },
  vek: CryptoKey,
  vaultId: string | null,
): Promise<VaultResult<string>> {
  if (env.cipher?.name !== CIPHER_NAME) return { ok: false, error: 'unsupported-version' }
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  let iv: Uint8Array
  let body: Uint8Array
  try {
    iv = fromBase64(env.cipher.iv)
    body = fromBase64(env.body)
  } catch {
    return { ok: false, error: 'damaged' }
  }
  if (iv.length !== IV_BYTES || body.length <= IV_BYTES) return { ok: false, error: 'damaged' }
  try {
    const opened = await subtle.decrypt({ name: CIPHER_NAME, iv: buffer(iv), additionalData: buffer(bodyAad(vaultId)) }, vek, buffer(body))
    return { ok: true, value: new TextDecoder().decode(opened) }
  } catch {
    return { ok: false, error: 'unopenable' }
  }
}

// ── Wrapper bookkeeping: pure, the caller re-seals when the vault id changes ─────────────

export function withWrapper(env: VaultV2, wrapper: VekWrapper): VaultV2 {
  return { ...env, wrappers: [...env.wrappers.filter((w) => w.id !== wrapper.id), wrapper] }
}

export function withoutWrapper(env: VaultV2, id: string): VaultV2 {
  return { ...env, wrappers: env.wrappers.filter((w) => w.id !== id) }
}

export function passkeyWrappers(env: { readonly wrappers: readonly VekWrapper[] }): PasskeyWrapper[] {
  return env.wrappers.filter((w): w is PasskeyWrapper => w.kind === 'passkey')
}

export function passwordWrapper(env: { readonly wrappers: readonly VekWrapper[] }): PasswordWrapper | null {
  return env.wrappers.find((w): w is PasswordWrapper => w.kind === 'password') ?? null
}

/** The upload: no header, no password wrapper. */
export function remoteEnvelopeOf(env: VaultV2, revision: number): RemoteEnvelope {
  return { v: VAULT_V2, cipher: env.cipher, body: env.body, wrappers: passkeyWrappers(env), revision }
}

/** A fresh device's local vault: the remote copy plus the header rebuilt from the opened record. */
export function localVaultFromRemote(remote: RemoteEnvelope, header: VaultHeader, vaultId: string): VaultV2 {
  return { v: VAULT_V2, header, vault: { id: vaultId }, cipher: remote.cipher, body: remote.body, wrappers: remote.wrappers }
}

export function serializeVaultV2(env: VaultV2): string {
  return JSON.stringify(env)
}

// ── Readers: strict, because every field here is editable without breaking a GCM tag ─────

function isB64(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

// The field bag is all-`unknown` on purpose: every value is checked, none is trusted by its type.
interface WrapperFields {
  kind?: unknown
  id?: unknown
  iv?: unknown
  wrapped?: unknown
  kdf?: { name?: unknown; hash?: unknown; iterations?: unknown; salt?: unknown } | null
  credentialId?: unknown
  hkdf?: { salt?: unknown; info?: unknown } | null
  prfInput?: unknown
  backedUp?: unknown
  addedAt?: unknown
}

function readWrapper(value: unknown): VekWrapper | null {
  if (!value || typeof value !== 'object') return null
  const w = value as WrapperFields
  if (typeof w.id !== 'string' || w.id === '' || !isB64(w.iv) || !isB64(w.wrapped)) return null
  if (w.kind === 'password') {
    const kdf = w.kdf
    if (!kdf || kdf.name !== KDF_NAME || kdf.hash !== KDF_HASH || !isB64(kdf.salt)) return null
    if (typeof kdf.iterations !== 'number' || !Number.isInteger(kdf.iterations) || kdf.iterations < 1) return null
    return { kind: 'password', id: w.id, kdf: { name: KDF_NAME, hash: KDF_HASH, iterations: kdf.iterations, salt: kdf.salt }, iv: w.iv, wrapped: w.wrapped }
  }
  if (w.kind === 'passkey') {
    if (typeof w.credentialId !== 'string' || w.credentialId === '') return null
    if (!w.hkdf || !isB64(w.hkdf.salt) || w.hkdf.info !== WRAP_INFO) return null
    if (w.prfInput !== PRF_INPUT || typeof w.backedUp !== 'boolean') return null
    if (typeof w.addedAt !== 'number' || !Number.isFinite(w.addedAt)) return null
    return {
      kind: 'passkey',
      id: w.id,
      credentialId: w.credentialId,
      hkdf: { salt: w.hkdf.salt, info: WRAP_INFO },
      prfInput: PRF_INPUT,
      iv: w.iv,
      wrapped: w.wrapped,
      backedUp: w.backedUp,
      addedAt: w.addedAt,
    }
  }
  return null
}

function readWrappers(value: unknown): VekWrapper[] | null {
  if (!Array.isArray(value)) return null
  const wrappers: VekWrapper[] = []
  for (const entry of value) {
    const wrapper = readWrapper(entry)
    if (!wrapper) return null
    wrappers.push(wrapper)
  }
  return wrappers
}

function readCipher(value: unknown): VaultV2['cipher'] | null {
  const cipher = value as Partial<VaultV2['cipher']> | null
  if (!cipher || cipher.name !== CIPHER_NAME || !isB64(cipher.iv)) return null
  return { name: CIPHER_NAME, iv: cipher.iv }
}

/** Anything present but malformed is `damaged`, NEVER absent — absent would mint a second identity. */
export function parseVaultV2(value: unknown): { kind: 'present'; vault: VaultV2 } | { kind: 'damaged'; reason: string } {
  const v = value as Partial<VaultV2>
  if (v.v !== VAULT_V2) return { kind: 'damaged', reason: `the version is ${String(v.v)}, not ${VAULT_V2}` }
  if (!isB64(v.body)) return { kind: 'damaged', reason: 'the sealed body is missing' }
  const cipher = readCipher(v.cipher)
  if (!cipher) return { kind: 'damaged', reason: 'the cipher parameters are missing' }
  const header = readHeader(v.header)
  if (!header) return { kind: 'damaged', reason: 'the public header is missing or malformed' }
  const id = v.vault?.id
  if (id !== null && (typeof id !== 'string' || id === '')) return { kind: 'damaged', reason: 'the vault id is malformed' }
  const wrappers = readWrappers(v.wrappers)
  if (!wrappers || wrappers.length === 0) return { kind: 'damaged', reason: 'no key wrapper can open the sealed body' }
  return { kind: 'present', vault: { v: VAULT_V2, header, vault: { id }, cipher, body: v.body, wrappers } }
}

/** Both ends parse the upload with this: the relayer before storing, the browser before opening. */
export function parseRemoteEnvelope(value: unknown): RemoteEnvelope | null {
  if (!value || typeof value !== 'object') return null
  const e = value as Partial<RemoteEnvelope>
  if (e.v !== VAULT_V2 || !isB64(e.body)) return null
  const cipher = readCipher(e.cipher)
  if (!cipher) return null
  const wrappers = readWrappers(e.wrappers)
  if (!wrappers || wrappers.length === 0 || wrappers.some((w) => w.kind !== 'passkey')) return null
  if (!Number.isInteger(e.revision) || (e.revision as number) < 0) return null
  return { v: VAULT_V2, cipher, body: e.body, wrappers: wrappers as PasskeyWrapper[], revision: e.revision as number }
}
