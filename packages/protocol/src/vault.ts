//
// The password vault: this browser's account keys, sealed at rest (PBKDF2-SHA256 600k → AES-GCM-256).
// It WRAPS a key generated elsewhere; it never derives one — the pool's viewing key is WriteOnce.
// The header is plaintext on purpose: the lock screen draws addresses and labels, which are public.
// Crypto parameters are frozen — existing vaults must keep opening.
//
// v1 (this file) seals the body directly under the password key. v2 (`vault-envelope.ts`) seals
// it under a random VEK that a password and/or a passkey wrap. Both sit under one storage key and
// `parseVault` tells them apart by `v`; a password-only wallet stays v1 for as long as it exists.
//

import { MIN_PASSWORD_LENGTH, type VaultError } from './password.js'
import { SESSION_KEYS, type SessionStore } from './session-store.js'
import { buffer, fromBase64, randomBytes, subtleOrNull, toBase64, utf8 } from './vault-bytes.js'
import { parseVaultV2, VAULT_V2, type VaultV2 } from './vault-envelope.js'
import { readHeader, type VaultHeader } from './vault-header.js'
import { CIPHER_NAME, deriveKey, IV_BYTES, KDF_HASH, KDF_ITERATIONS, KDF_NAME, SALT_BYTES } from './vault-kdf.js'

export { deriveKey } from './vault-kdf.js'
export { readHeader, type VaultHeader } from './vault-header.js'

/** The password-only format this build writes. A different one reads as unusable, never as absent. */
export const VAULT_VERSION = 1

/** What sits in storage under `SESSION_KEYS.vault` for a password-only wallet. */
export interface SealedVault {
  readonly v: typeof VAULT_VERSION
  readonly kdf: {
    readonly name: typeof KDF_NAME
    readonly hash: typeof KDF_HASH
    readonly iterations: number
    readonly salt: string
  }
  readonly cipher: { readonly name: typeof CIPHER_NAME; readonly iv: string }
  readonly header: VaultHeader
  /** base64 AES-GCM ciphertext of a serialized accounts record. */
  readonly body: string
}

/** Either format. Narrow on `v` — the header is the same shape in both. */
export type StoredVault = SealedVault | VaultV2

export type VaultResult<T> = { ok: true; value: T } | { ok: false; error: VaultError }

/**
 * The derived key, held for an unlocked session so every re-seal is one AES-GCM encrypt instead of
 * 600k PBKDF2 rounds. Non-extractable, so it is a SAFER thing to hold than the password string.
 * The salt is carried (a new salt is a new key); the IV is fresh on every seal.
 */
export interface VaultKey {
  readonly key: CryptoKey
  readonly salt: string
  readonly iterations: number
}

export interface OpenedVault {
  readonly plaintext: string
  readonly vaultKey: VaultKey
}

/** `absent` and `damaged` are different facts — a damaged vault must never boot as fresh. */
export type VaultRead =
  | { kind: 'absent' }
  | { kind: 'damaged'; reason: string }
  | { kind: 'present'; vault: StoredVault }

/** Seals under an already-derived key. A FRESH IV every time — reuse under one key is catastrophic. */
export async function sealWithKey(plaintext: string, header: VaultHeader, vaultKey: VaultKey): Promise<VaultResult<SealedVault>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  const iv = randomBytes(IV_BYTES)
  try {
    const sealed = await subtle.encrypt({ name: CIPHER_NAME, iv: buffer(iv) }, vaultKey.key, buffer(utf8(plaintext)))
    return {
      ok: true,
      value: {
        v: VAULT_VERSION,
        kdf: { name: KDF_NAME, hash: KDF_HASH, iterations: vaultKey.iterations, salt: vaultKey.salt },
        cipher: { name: CIPHER_NAME, iv: toBase64(iv) },
        header,
        body: toBase64(new Uint8Array(sealed)),
      },
    }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/** The path a NEW password takes: fresh salt, full derivation. */
export async function sealVault(plaintext: string, header: VaultHeader, password: string): Promise<VaultResult<SealedVault>> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'password-too-short' }
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  const salt = randomBytes(SALT_BYTES)
  try {
    const key = await deriveKey(password, salt, KDF_ITERATIONS, subtle)
    return sealWithKey(plaintext, header, { key, salt: toBase64(salt), iterations: KDF_ITERATIONS })
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/**
 * Structure is checked BEFORE the password is tried, which is what makes `wrong-password`
 * trustworthy: GCM reports a bad key and a flipped bit identically.
 */
export async function openVault(vault: SealedVault, password: string): Promise<VaultResult<OpenedVault>> {
  if (vault.v !== VAULT_VERSION) return { ok: false, error: 'unsupported-version' }
  if (vault.kdf?.name !== KDF_NAME || vault.kdf.hash !== KDF_HASH) return { ok: false, error: 'unsupported-version' }
  if (vault.cipher?.name !== CIPHER_NAME) return { ok: false, error: 'unsupported-version' }

  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }

  let salt: Uint8Array
  let iv: Uint8Array
  let body: Uint8Array
  try {
    salt = fromBase64(vault.kdf.salt)
    iv = fromBase64(vault.cipher.iv)
    body = fromBase64(vault.body)
  } catch {
    return { ok: false, error: 'damaged' }
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || body.length <= IV_BYTES) return { ok: false, error: 'damaged' }
  if (!Number.isInteger(vault.kdf.iterations) || vault.kdf.iterations < 1) return { ok: false, error: 'damaged' }

  try {
    // The record's OWN iteration count — raising the constant must not lock existing users out.
    const key = await deriveKey(password, salt, vault.kdf.iterations, subtle)
    const opened = await subtle.decrypt({ name: CIPHER_NAME, iv: buffer(iv) }, key, buffer(body))
    return {
      ok: true,
      value: {
        plaintext: new TextDecoder().decode(opened),
        vaultKey: { key, salt: vault.kdf.salt, iterations: vault.kdf.iterations },
      },
    }
  } catch {
    return { ok: false, error: 'wrong-password' }
  }
}

export function serializeVault(vault: StoredVault): string {
  return JSON.stringify(vault)
}

/** `null` → absent; anything present but malformed → `damaged`, NEVER absent. */
export function parseVault(raw: string | null): VaultRead {
  if (raw === null) return { kind: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { kind: 'damaged', reason: `it is not JSON: ${String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'damaged', reason: 'it is not an object' }
  const version = (parsed as { v?: unknown }).v
  if (version === VAULT_V2) return parseVaultV2(parsed)
  if (version !== VAULT_VERSION) {
    // A version this build has never heard of is a NEWER build's vault — say so, not "corrupt".
    const newer = typeof version === 'number' && version > VAULT_V2
    return { kind: 'damaged', reason: newer ? `it was locked by a newer strk20.run (format ${version})` : `the version is ${String(version)}, not ${VAULT_VERSION}` }
  }
  const value = parsed as Partial<SealedVault>
  if (typeof value.body !== 'string' || value.body === '') return { kind: 'damaged', reason: 'the sealed body is missing' }
  if (!value.kdf || typeof value.kdf.salt !== 'string') return { kind: 'damaged', reason: 'the key-derivation parameters are missing' }
  if (!value.cipher || typeof value.cipher.iv !== 'string') return { kind: 'damaged', reason: 'the cipher parameters are missing' }
  const header = readHeader(value.header)
  if (!header) return { kind: 'damaged', reason: 'the public header is missing or malformed' }
  return { kind: 'present', vault: { ...(value as SealedVault), header } }
}

/** Load, save and clear a vault over any `SessionStore`. */
export interface VaultStore {
  load(): VaultRead
  save(vault: StoredVault): void
  clear(): void
}

export function sessionVaultStore(store: SessionStore): VaultStore {
  return {
    load: () => {
      let raw: string | null
      try {
        raw = store.read(SESSION_KEYS.vault)
      } catch (e) {
        // A read that THREW is not an absent vault — absent would mint a second identity.
        return { kind: 'damaged', reason: `could not read the stored vault: ${String(e)}` }
      }
      return parseVault(raw)
    },
    save: (vault) => store.write(SESSION_KEYS.vault, serializeVault(vault)),
    clear: () => store.remove(SESSION_KEYS.vault),
  }
}

/**
 * The mirror FIRST, then the record. Deleting the record first could leave a bare mirror on a
 * failure between the two, and a bare mirror boots the wallet with no password at all.
 */
export function clearPlaintextKeys(store: SessionStore): void {
  store.remove(SESSION_KEYS.accountKey)
  store.remove(SESSION_KEYS.accounts)
}
