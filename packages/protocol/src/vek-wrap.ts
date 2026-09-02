//
// The Vault Encryption Key and its wrappers. The VEK is 32 random bytes that live in memory as a
// NON-extractable AES-GCM key; a wrapper is AES-GCM over the raw bytes under a Key Encryption Key
// derived from a password (PBKDF2, the unchanged v1 derivation) or a passkey's PRF output (HKDF).
//
// Why raw bytes and not `wrapKey`: `wrapKey` needs the wrapped key extractable for its whole life
// in memory. Encrypting the bytes ourselves lets the VEK be imported non-extractable and lets the
// raw copy be zeroed microseconds after. The raw bytes exist only inside these functions.
//
// The wrapper's own metadata is the AAD, so a wrapper whose credential id or salt was edited will
// not open even with the right key.
//

import type { VaultResult } from './vault.js'
import type { PasskeyWrapper, PasswordWrapper, VekWrapper } from './vault-envelope.js'
import { buffer, fromBase64, randomBytes, subtleOrNull, toBase64, utf8, zero } from './vault-bytes.js'
import { AES_KEY_BITS, CIPHER_NAME, IV_BYTES, KDF_HASH, KDF_ITERATIONS, KDF_NAME, SALT_BYTES, deriveKey } from './vault-kdf.js'

const VEK_BYTES = 32
const HKDF_SALT_BYTES = 16

type WrapperMeta = Omit<PasswordWrapper, 'iv' | 'wrapped'> | Omit<PasskeyWrapper, 'iv' | 'wrapped'>

async function importVek(raw: Uint8Array, subtle: SubtleCrypto): Promise<CryptoKey> {
  return subtle.importKey('raw', buffer(raw), CIPHER_NAME, false, ['encrypt', 'decrypt'])
}

/** A fresh VEK. The raw bytes are returned ONCE so the caller can wrap them, then must be zeroed. */
export async function generateVek(): Promise<VaultResult<{ raw: Uint8Array; key: CryptoKey }>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  const raw = randomBytes(VEK_BYTES)
  try {
    return { ok: true, value: { raw, key: await importVek(raw, subtle) } }
  } catch {
    zero(raw)
    return { ok: false, error: 'crypto-unavailable' }
  }
}

// Sorted keys, so the AAD is the same bytes whichever end built the object.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function wrapperAad(meta: WrapperMeta): Uint8Array {
  return utf8(canonical(meta))
}

function metaOf(wrapper: VekWrapper): WrapperMeta {
  const { iv: _iv, wrapped: _wrapped, ...meta } = wrapper
  return meta
}

/** Seals the raw VEK under a KEK, returning the finished wrapper. Fresh IV per wrap. */
export async function wrapVek<M extends WrapperMeta>(rawVek: Uint8Array, kek: CryptoKey, meta: M): Promise<VaultResult<M & { iv: string; wrapped: string }>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  if (rawVek.length !== VEK_BYTES) return { ok: false, error: 'damaged' }
  const iv = randomBytes(IV_BYTES)
  try {
    const wrapped = await subtle.encrypt({ name: CIPHER_NAME, iv: buffer(iv), additionalData: buffer(wrapperAad(meta)) }, kek, buffer(rawVek))
    return { ok: true, value: { ...meta, iv: toBase64(iv), wrapped: toBase64(new Uint8Array(wrapped)) } }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/** Opens a wrapper into an in-memory VEK. The raw bytes are zeroed the moment the key is imported. */
export async function unwrapVek(wrapper: VekWrapper, kek: CryptoKey): Promise<VaultResult<CryptoKey>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  let iv: Uint8Array
  let wrapped: Uint8Array
  try {
    iv = fromBase64(wrapper.iv)
    wrapped = fromBase64(wrapper.wrapped)
  } catch {
    return { ok: false, error: 'damaged' }
  }
  if (iv.length !== IV_BYTES || wrapped.length !== VEK_BYTES + 16) return { ok: false, error: 'damaged' }
  let raw: Uint8Array | null = null
  try {
    raw = new Uint8Array(await subtle.decrypt({ name: CIPHER_NAME, iv: buffer(iv), additionalData: buffer(wrapperAad(metaOf(wrapper))) }, kek, buffer(wrapped)))
    if (raw.length !== VEK_BYTES) return { ok: false, error: 'damaged' }
    return { ok: true, value: await importVek(raw, subtle) }
  } catch {
    return { ok: false, error: wrapper.kind === 'password' ? 'wrong-password' : 'unopenable' }
  } finally {
    if (raw) zero(raw)
  }
}

// ── KEKs ─────────────────────────────────────────────────────────────────────────────────

/** Fresh PBKDF2 parameters for a NEW password wrapper. */
export function newPasswordKdf(): PasswordWrapper['kdf'] {
  return { name: KDF_NAME, hash: KDF_HASH, iterations: KDF_ITERATIONS, salt: toBase64(randomBytes(SALT_BYTES)) }
}

/** The unchanged v1 derivation, with the WRAPPER's own iteration count. */
export async function passwordKek(password: string, kdf: PasswordWrapper['kdf']): Promise<VaultResult<CryptoKey>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  let salt: Uint8Array
  try {
    salt = fromBase64(kdf.salt)
  } catch {
    return { ok: false, error: 'damaged' }
  }
  if (salt.length !== SALT_BYTES) return { ok: false, error: 'damaged' }
  try {
    return { ok: true, value: await deriveKey(password, salt, kdf.iterations, subtle) }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/** Fresh HKDF salt for a NEW passkey wrapper. Random per wrapper; the PRF input is public and shared. */
export function newHkdfSalt(): string {
  return toBase64(randomBytes(HKDF_SALT_BYTES))
}

/**
 * PRF output → HKDF-SHA256 → AES-GCM-256, non-extractable. The PRF bytes are consumed here and
 * zeroed; nothing derived from WebAuthn ever becomes key material for the Stark key (AD-20).
 */
export async function passkeyKek(prf: Uint8Array, hkdf: PasskeyWrapper['hkdf']): Promise<VaultResult<CryptoKey>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  let salt: Uint8Array
  try {
    salt = fromBase64(hkdf.salt)
  } catch {
    return { ok: false, error: 'damaged' }
  }
  try {
    const base = await subtle.importKey('raw', buffer(prf), 'HKDF', false, ['deriveKey'])
    const key = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: buffer(salt), info: buffer(utf8(hkdf.info)) },
      base,
      { name: CIPHER_NAME, length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt'],
    )
    return { ok: true, value: key }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  } finally {
    zero(prf)
  }
}
