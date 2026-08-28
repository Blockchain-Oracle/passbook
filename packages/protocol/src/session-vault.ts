//
// The password that encrypts this browser's account keys at rest (Abu's ruling 2026-08-28).
//
// ── THIS REVERSES `session-key.ts`'s PLAINTEXT DECISION, AND ANSWERS ITS ARGUMENT ─────────
//
// That file's header refuses a password, and the refusal is well made, so it is worth stating
// exactly which sentence stopped being true rather than quietly shipping past it. The argument
// was: "a user-chosen password means a SECOND SECRET TO LOSE, protecting a first secret whose
// entire design goal is that losing it is unrecoverable."
//
// The premise there is that the password would be the only thing standing between the user and
// their account. It is not, and it was not even then: `backup-gate.ts` GATES registration on a
// completed Recovery Code + Recovery File ceremony, so by the time any account exists there is
// already an offline artifact that restores it. A forgotten password therefore costs an import,
// not an account. The password is a LOCK ON THE DOOR of a house whose deed is in a drawer.
//
// The other half of that header stands unamended and is honoured here: DO NOT DERIVE THE KEY
// FROM ANYTHING NON-DETERMINISTIC. This wraps a key that was generated independently; it never
// produces one. `backup-gate.ts` states why that direction is the only safe one (a re-registered
// authenticator yields different material, and the pool's WriteOnce viewing key cannot be
// replaced) and the same reasoning binds a password: change it, and the same account key must
// come back out.
//
// ── THE HEADER IS PLAINTEXT ON PURPOSE ────────────────────────────────────────────────────
//
// The locked screen renders an identity disc, a short address and a list of accounts to choose
// between. Every one of those is PUBLIC — an address is what you hand to somebody so they can pay
// you — and sealing them would mean the app could not draw its own lock screen without first
// asking for the password it is about to prompt for. So the vault is a public header beside a
// sealed body, and the split is exactly the public/secret line drawn everywhere else in this
// package: addresses, labels and timestamps out; account keys in.
//
// What this leaks to an origin attacker is the set of addresses this browser holds. That is
// already leaked by every balance read the app makes, so the header costs nothing that was not
// on the wire anyway.
//
// ── AND IT IS A LEAF ──────────────────────────────────────────────────────────────────────
//
// The one import is `session-store.js`, which itself imports only `session-copy.js` — strings.
// Nothing here reaches `identity.ts` or `session-accounts.ts`: both pull `starknet`, and
// `scripts/build-web.mjs` rejects that graph from the eager chunk by name. The vault is WebCrypto
// and JSON, so it stays weightless and the boot path can ask "is there a vault?" without dragging
// the SDK in behind the question. That is also why `VaultHeader` is declared structurally here
// rather than derived from `StoredAccounts` — the type would be free, the import would not.
//

import { SESSION_KEYS, type SessionStore } from './session-store.js'

/** The vault format this build writes. A different one reads as unusable rather than as absent. */
export const VAULT_VERSION = 1

/**
 * PBKDF2 rounds.
 *
 * OWASP's current floor for PBKDF2-HMAC-SHA256 is 600,000, and this sits on it rather than at
 * ZK Freighter's 210,000. The cost is real and it is paid in the right place: roughly half a
 * second on a laptop and up to ~1.5 s on a slow phone, ONCE, on a screen whose entire job is to
 * be a deliberate pause. The attacker's cost is the same multiple, against a secret a human
 * chose — which is precisely the case where the work factor is the only defence there is.
 */
const KDF_ITERATIONS = 600_000

const KDF_NAME = 'PBKDF2'
const KDF_HASH = 'SHA-256'
const CIPHER_NAME = 'AES-GCM'
const AES_KEY_BITS = 256
const SALT_BYTES = 16
const IV_BYTES = 12

/**
 * The shortest password this will seal.
 *
 * Eight, not twelve, and the reason is that the threat model here is a stolen laptop and a
 * curious housemate rather than an offline cracking rig with the ciphertext in hand — and for the
 * rig, 600,000 rounds is doing more work than four extra characters would. A minimum long enough
 * to be annoying is a minimum people write on a sticky note.
 */
export const MIN_PASSWORD_LENGTH = 8

/** The public half of a vault. Rendered by the locked screen; never secret. See the header. */
export interface VaultHeader {
  /** The address that will be active when the vault opens. */
  readonly active: string
  /** Every account inside, by its public facts only. */
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

/**
 * Why a vault operation did not work.
 *
 * `wrong-password` and `damaged` are DIFFERENT and the difference is the whole point of having
 * an enum here. AES-GCM's authentication tag fails identically for a bad key and for a flipped
 * bit, so decryption alone cannot tell them apart — but the structural checks that run BEFORE
 * decryption can, and they are what let the UI say "that password is wrong, try again" instead of
 * "your wallet is corrupt", which is a sentence that makes people panic and reinstall.
 */
export type VaultError =
  | 'crypto-unavailable'
  | 'damaged'
  | 'password-too-short'
  | 'unsupported-version'
  | 'wrong-password'

export type VaultResult<T> = { ok: true; value: T } | { ok: false; error: VaultError }

/** What a successful `openVault` hands back: the record, and the means to re-seal it cheaply. */
export interface OpenedVault {
  /** The serialized accounts record that was sealed. */
  readonly plaintext: string
  /** Hold this for the unlocked session; pass it to `sealWithKey` on every write. */
  readonly vaultKey: VaultKey
}

/** What was in storage. `absent` and `damaged` are different facts — see `session-store.ts`. */
export type VaultRead =
  | { kind: 'absent' }
  | { kind: 'damaged'; reason: string }
  | { kind: 'present'; vault: SealedVault }

/** The sentence each failure gets in the UI. Exported so the copy cannot drift from the enum. */
export const VAULT_ERROR_TEXT: Record<VaultError, string> = {
  'crypto-unavailable':
    'This browser will not do the encryption Passbook needs. That usually means the page is not on a secure origin.',
  damaged:
    'The locked wallet in this browser could not be read. Your Recovery File still opens this account.',
  'password-too-short': `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  'unsupported-version':
    'This wallet was locked by a newer version of Passbook. Update the page, or open it with your Recovery File.',
  'wrong-password': 'That password does not open this wallet.',
}

function subtleOrNull(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

//
// Universal base64, matching `identity.ts:262`'s choice and for its reason: `btoa`/`atob` are
// global in browsers and in Node ≥ 16, so no `Buffer` import creeps in and the module stays
// runnable in both places without a shim.
//
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Throws on anything that is not well-formed base64 — callers turn that into `damaged`. */
function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('not base64')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * `Uint8Array` → `ArrayBuffer`, by COPY.
 *
 * WebCrypto wants a buffer, and handing it `bytes.buffer` directly is a bug waiting for the first
 * array that is a view onto a larger allocation — it would encrypt the whole backing store rather
 * than the slice. A copy is cheap at these sizes and cannot be wrong.
 */
function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    'raw',
    buffer(new TextEncoder().encode(password)),
    KDF_NAME,
    // NOT extractable. The derived material never needs to leave WebCrypto, and a key the page
    // can read back is one an XSS can read back.
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    { name: KDF_NAME, salt: buffer(salt), iterations, hash: KDF_HASH },
    material,
    { name: CIPHER_NAME, length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * An opened vault's derived key, held for the length of an unlocked session.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE PASSWORD ───────────────────────────────────────
 *
 * The record is re-sealed on EVERY write — a renamed account, a switch, an added identity — and
 * `sealVault` costs 600,000 PBKDF2 rounds, which is roughly half a second. Paying that to rename
 * an account would make the app feel broken, and the obvious repair (hold the password in a
 * module variable and re-derive) pays it anyway.
 *
 * So the unlock derives ONCE and what it hands back is the `CryptoKey`, non-extractable, plus the
 * salt and iteration count needed to write a vault the same password will still open. Re-sealing
 * is then one AES-GCM encrypt: instant.
 *
 * IT IS NOT A WEAKER SECRET THAN THE PASSWORD — it is a stronger one to hold. A non-extractable
 * `CryptoKey` cannot be read out of the page by any script; the password, as a string, can. An
 * unlocked session already holds the account key itself in memory, so the exposure here is
 * strictly bounded by what is already exposed.
 *
 * THE SALT IS CARRIED, NOT REDRAWN. A new salt would mean a new derived key, which is the whole
 * cost this type exists to avoid. The IV is still fresh on every seal — see `sealWithKey`.
 */
export interface VaultKey {
  readonly key: CryptoKey
  readonly salt: string
  readonly iterations: number
}

/**
 * Seals a record under an already-derived key.
 *
 * A FRESH IV EVERY TIME, and this is the one place in the file where getting it wrong would be
 * catastrophic rather than merely broken. Reusing an IV under one AES-GCM key leaks the XOR of the
 * two plaintexts and destroys the authentication guarantee entirely — and this function is called
 * repeatedly under a key that by design does NOT change, which is exactly the setting where a
 * cached IV would look like a harmless optimisation.
 */
export async function sealWithKey(
  plaintext: string,
  header: VaultHeader,
  vaultKey: VaultKey,
): Promise<VaultResult<SealedVault>> {
  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }

  const iv = randomBytes(IV_BYTES)
  try {
    const sealed = await subtle.encrypt(
      { name: CIPHER_NAME, iv: buffer(iv) },
      vaultKey.key,
      buffer(new TextEncoder().encode(plaintext)),
    )
    return {
      ok: true,
      value: {
        v: VAULT_VERSION,
        kdf: {
          name: KDF_NAME,
          hash: KDF_HASH,
          iterations: vaultKey.iterations,
          salt: vaultKey.salt,
        },
        cipher: { name: CIPHER_NAME, iv: toBase64(iv) },
        header,
        body: toBase64(new Uint8Array(sealed)),
      },
    }
  } catch {
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/**
 * Seals a serialized accounts record under a password. The path a NEW password takes.
 *
 * A fresh salt here, because a new password deserves new derivation parameters — and because this
 * is the only function that draws one, `sealWithKey` above can carry the salt forward without
 * anybody wondering whether it should have redrawn it.
 */
export async function sealVault(
  plaintext: string,
  header: VaultHeader,
  password: string,
): Promise<VaultResult<SealedVault>> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'password-too-short' }

  const subtle = subtleOrNull()
  if (!subtle) return { ok: false, error: 'crypto-unavailable' }

  const salt = randomBytes(SALT_BYTES)
  try {
    const key = await deriveKey(password, salt, KDF_ITERATIONS, subtle)
    return sealWithKey(plaintext, header, {
      key,
      salt: toBase64(salt),
      iterations: KDF_ITERATIONS,
    })
  } catch {
    // Encryption failing is not a user error and there is no password to blame. The only honest
    // report is that this browser's crypto did not do what it advertised.
    return { ok: false, error: 'crypto-unavailable' }
  }
}

/**
 * Opens a vault, returning the serialized record that was sealed.
 *
 * THE STRUCTURE IS CHECKED BEFORE THE PASSWORD IS TRIED, and that ordering is what makes
 * `wrong-password` trustworthy. AES-GCM reports a bad key and a corrupted ciphertext through the
 * same thrown exception, so a function that decrypts first can only ever say "one of those two
 * things happened" — and the version the user reads would have to hedge. Validating the envelope
 * up front means everything that reaches the decrypt call is well-formed, so a failure there is
 * the password and can be reported as the password.
 */
export async function openVault(
  vault: SealedVault,
  password: string,
): Promise<VaultResult<OpenedVault>> {
  if (vault.v !== VAULT_VERSION) return { ok: false, error: 'unsupported-version' }
  if (vault.kdf?.name !== KDF_NAME || vault.kdf.hash !== KDF_HASH) {
    return { ok: false, error: 'unsupported-version' }
  }
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

  // Lengths are part of the envelope, not of the secret. A short IV or a body too small to hold
  // a GCM tag is a damaged record however good the password is.
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || body.length <= IV_BYTES) {
    return { ok: false, error: 'damaged' }
  }
  if (!Number.isInteger(vault.kdf.iterations) || vault.kdf.iterations < 1) {
    return { ok: false, error: 'damaged' }
  }

  try {
    // The record's OWN iteration count, not this build's constant — otherwise raising
    // KDF_ITERATIONS would lock every existing user out of their own vault.
    const key = await deriveKey(password, salt, vault.kdf.iterations, subtle)
    const opened = await subtle.decrypt({ name: CIPHER_NAME, iv: buffer(iv) }, key, buffer(body))
    return {
      ok: true,
      value: {
        plaintext: new TextDecoder().decode(opened),
        // The derived key travels back out so the session can re-seal without paying the KDF
        // again. See `VaultKey` for why holding this is safer than holding the password.
        vaultKey: { key, salt: vault.kdf.salt, iterations: vault.kdf.iterations },
      },
    }
  } catch {
    return { ok: false, error: 'wrong-password' }
  }
}

/** Serializes a vault for storage. */
export function serializeVault(vault: SealedVault): string {
  return JSON.stringify(vault)
}

/**
 * Reads a vault out of storage.
 *
 * `null` in is `absent` out; anything present but malformed is `damaged`, NEVER `absent`. That
 * distinction is `session-store.ts`'s rule and it matters more here than anywhere: an `absent`
 * verdict on a damaged vault would send the boot path down the "this is a fresh browser" branch
 * and mint a second identity on top of an account whose ciphertext is sitting right there.
 */
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
  if (value.v !== VAULT_VERSION) {
    return { kind: 'damaged', reason: `the version is ${String(value.v)}, not ${VAULT_VERSION}` }
  }
  if (typeof value.body !== 'string' || value.body === '') {
    return { kind: 'damaged', reason: 'the sealed body is missing' }
  }
  if (!value.kdf || typeof value.kdf.salt !== 'string') {
    return { kind: 'damaged', reason: 'the key-derivation parameters are missing' }
  }
  if (!value.cipher || typeof value.cipher.iv !== 'string') {
    return { kind: 'damaged', reason: 'the cipher parameters are missing' }
  }

  const header = readHeader(value.header)
  if (!header) return { kind: 'damaged', reason: 'the public header is missing or malformed' }

  return { kind: 'present', vault: { ...(value as SealedVault), header } }
}

/**
 * Validates the public header.
 *
 * Strict, because this is the half an attacker can edit without breaking the GCM tag — it is
 * OUTSIDE the sealed body by design. A tampered header cannot hand over a key, but it can put a
 * wrong address on the lock screen, so nothing shaped incorrectly is read back. `active` must
 * name one of the accounts for the same reason `parseStoredAccounts` insists on it.
 */
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

/** Load, save and clear a vault over any `SessionStore`. The seam the shell's boot wires. */
export interface VaultStore {
  load(): VaultRead
  save(vault: SealedVault): void
  /** Removes the vault. Used when the user turns the password off — see `clearPassword`. */
  clear(): void
}

export function sessionVaultStore(store: SessionStore): VaultStore {
  return {
    load: () => {
      let raw: string | null
      try {
        raw = store.read(SESSION_KEYS.vault)
      } catch (e) {
        // A read that THREW is not an absent vault. Reporting it as absent would send the boot
        // path down the fresh-browser branch and mint a second identity on top of a sealed one.
        return { kind: 'damaged', reason: `could not read the stored vault: ${String(e)}` }
      }
      return parseVault(raw)
    },

    save: (vault) => {
      store.write(SESSION_KEYS.vault, serializeVault(vault))
    },

    clear: () => {
      store.remove(SESSION_KEYS.vault)
    },
  }
}

/**
 * The two plaintext keys a sealed browser must not keep, in the order they have to go.
 *
 * THE MIRROR FIRST, THEN THE RECORD, and the ordering is the whole reason this is a named export
 * rather than two `remove` calls at a call site. `sessionAccountStore.save` writes the record and
 * then mirrors the active key into `accountKey`, so a build that reads only the mirror still boots.
 * Deleting the RECORD first would, on a failure between the two removes, leave a browser holding a
 * bare mirror — which is exactly the shape `session-key.ts` boots from, so the next load would open
 * the wallet with no password at all, silently, from the one key we meant to destroy.
 *
 * Removing the mirror first fails the other way: worst case the record survives, the vault also
 * exists, and the browser still asks for a password on the next load because the boot path checks
 * the vault first. A redundant plaintext copy is bad; an unlocked wallet is worse.
 */
export function clearPlaintextKeys(store: SessionStore): void {
  store.remove(SESSION_KEYS.accountKey)
  store.remove(SESSION_KEYS.accounts)
}

/**
 * A coarse strength read, for the meter beside the field.
 *
 * FOUR BUCKETS FROM LENGTH AND VARIETY, and deliberately not a zxcvbn-style dictionary score:
 * that library is ~800 kB against a 2.4 MB eager budget the build gate enforces, for a number
 * whose only job is to make somebody type a bit more. What it must never do is BLOCK — the meter
 * advises, `MIN_PASSWORD_LENGTH` is the only rule, and a user who wants a weak password on their
 * own laptop is allowed one.
 */
export type PasswordStrength = 'too-short' | 'weak' | 'fair' | 'strong'

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too-short'

  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password))

  // Length carries more weight than variety, which is the direction the research points and the
  // opposite of what most meters reward: a long lowercase passphrase beats a short one with a
  // digit and a bang stapled to the end.
  if (password.length >= 16 || (password.length >= 12 && variety >= 3)) return 'strong'
  if (password.length >= 12 || variety >= 3) return 'fair'
  return 'weak'
}
