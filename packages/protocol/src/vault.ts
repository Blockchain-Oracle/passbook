//
// The password vault: this browser's account keys, sealed at rest (PBKDF2-SHA256 600k → AES-GCM-256).
// It WRAPS a key generated elsewhere; it never derives one — the pool's viewing key is WriteOnce.
// The header is plaintext on purpose: the lock screen draws addresses and labels, which are public.
// Crypto parameters are frozen — existing vaults must keep opening.
//

import { MIN_PASSWORD_LENGTH, type VaultError } from './password.js'
import { SESSION_KEYS, type SessionStore } from './session-store.js'

/** The vault format this build writes. A different one reads as unusable, never as absent. */
export const VAULT_VERSION = 1

const KDF_ITERATIONS = 600_000 // OWASP floor; paid once, on a screen meant to pause
const KDF_NAME = 'PBKDF2'
const KDF_HASH = 'SHA-256'
const CIPHER_NAME = 'AES-GCM'
const AES_KEY_BITS = 256
const SALT_BYTES = 16
const IV_BYTES = 12

/** The public half of a vault. Rendered by the locked screen; never secret. */
export interface VaultHeader {
  readonly active: string
  readonly accounts: readonly {
    readonly address: string
    readonly label: string | null
    readonly addedAt: number
  }[]
}

/** What sits in storage under `SESSION_KEYS.vault`. */
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
  | { kind: 'present'; vault: SealedVault }

function subtleOrNull(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

// btoa/atob: global in browsers and Node ≥ 16, so no Buffer creeps into the bundle.
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('not base64')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// By COPY: `bytes.buffer` on a view would hand WebCrypto the whole backing allocation.
function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number, subtle: SubtleCrypto): Promise<CryptoKey> {
  // Not extractable: a key the page can read back is one an XSS can read back.
  const material = await subtle.importKey('raw', buffer(new TextEncoder().encode(password)), KDF_NAME, false, ['deriveKey'])
  return subtle.deriveKey(
    { name: KDF_NAME, salt: buffer(salt), iterations, hash: KDF_HASH },
    material,
    { name: CIPHER_NAME, length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Seals under an already-derived key. A FRESH IV every time — reuse under one key is catastrophic. */
export async function sealWithKey(plaintext: string, header: VaultHeader, vaultKey: VaultKey): Promise<VaultResult<SealedVault>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }
  const iv = randomBytes(IV_BYTES)
  try {
    const sealed = await subtle.encrypt({ name: CIPHER_NAME, iv: buffer(iv) }, vaultKey.key, buffer(new TextEncoder().encode(plaintext)))
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

export function serializeVault(vault: SealedVault): string {
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
  const value = parsed as Partial<SealedVault>
  if (value.v !== VAULT_VERSION) return { kind: 'damaged', reason: `the version is ${String(value.v)}, not ${VAULT_VERSION}` }
  if (typeof value.body !== 'string' || value.body === '') return { kind: 'damaged', reason: 'the sealed body is missing' }
  if (!value.kdf || typeof value.kdf.salt !== 'string') return { kind: 'damaged', reason: 'the key-derivation parameters are missing' }
  if (!value.cipher || typeof value.cipher.iv !== 'string') return { kind: 'damaged', reason: 'the cipher parameters are missing' }
  const header = readHeader(value.header)
  if (!header) return { kind: 'damaged', reason: 'the public header is missing or malformed' }
  return { kind: 'present', vault: { ...(value as SealedVault), header } }
}

// Strict: the header is the half an attacker can edit without breaking the GCM tag.
function readHeader(value: unknown): VaultHeader | null {
  if (!value || typeof value !== 'object') return null
  const header = value as Partial<VaultHeader>
  if (typeof header.active !== 'string' || header.active === '') return null
  if (!Array.isArray(header.accounts) || header.accounts.length === 0) return null
  const accounts: VaultHeader['accounts'][number][] = []
  for (const entry of header.accounts) {
    if (!entry || typeof entry !== 'object') return null
    const account = entry as Partial<VaultHeader['accounts'][number]>
    if (typeof account.address !== 'string' || account.address === '') return null
    if (account.label !== null && typeof account.label !== 'string') return null
    if (typeof account.addedAt !== 'number' || !Number.isFinite(account.addedAt)) return null
    accounts.push({ address: account.address, label: account.label, addedAt: account.addedAt })
  }
  if (!accounts.some((a) => a.address === header.active)) return null
  return { active: header.active, accounts }
}

/** Load, save and clear a vault over any `SessionStore`. */
export interface VaultStore {
  load(): VaultRead
  save(vault: SealedVault): void
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
