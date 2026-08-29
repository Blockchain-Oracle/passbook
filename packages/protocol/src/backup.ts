//
// The Recovery Code and the Recovery File (envelope v2). BYTE-COMPATIBLE with every file and code
// already issued: the alphabet, the canonical code form fed to PBKDF2, the KDF parameters, the
// envelope JSON and the header canonicalization are all frozen. Web Crypto from the global.
//

import { MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION, WRONG_RECOVERY_CODE } from './backup-copy.js'
import { FELT_PRIME, isStarkPrivateKey } from './keys.js'

const webcrypto: Crypto = globalThis.crypto

const KDF_ITERATIONS = 600_000 // OWASP floor for PBKDF2-SHA256
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ' // no I, O — misread as 1, 0
const CODE_GROUPS = 4
const CODE_GROUP_LENGTH = 6
const CODE_LENGTH = CODE_GROUPS * CODE_GROUP_LENGTH

// ── The Recovery Code ─────────────────────────────────────────────────────────────────────

/** The one rule for what a code looks like. `I` and `O` are absent here AND in the alphabet. */
export const RECOVERY_CODE_PATTERN = /^[0-9A-HJ-NP-Z]{6}(?:-[0-9A-HJ-NP-Z]{6}){3}$/

// Whitespace plus every dash a rich-text editor substitutes for the ASCII one.
const DASH_FAMILY =
  /[\s\u002D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2043\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g
// Zero-width and bidi characters that ride along on a copy out of a PDF.
const INVISIBLES = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g

/** NFKC → strip dashes → strip invisibles → upper. Never maps O→0 or I→1. */
export function normalizeRecoveryCode(code: string): string {
  return code.normalize('NFKC').replace(DASH_FAMILY, '').replace(INVISIBLES, '').toUpperCase()
}

/** Regrouped `XXXXXX-XXXXXX-XXXXXX-XXXXXX`. THIS is what feeds PBKDF2 at both ends. */
export function canonicalizeRecoveryCode(code: string): string {
  const compact = normalizeRecoveryCode(code)
  if (compact.length !== CODE_LENGTH) return compact
  return Array.from({ length: CODE_GROUPS }, (_, g) =>
    compact.slice(g * CODE_GROUP_LENGTH, (g + 1) * CODE_GROUP_LENGTH),
  ).join('-')
}

// 34 × 7 = 238: bytes at or above are DISCARDED, never reduced (modulo bias is permanent).
const REJECTION_CEILING = CODE_ALPHABET.length * Math.floor(256 / CODE_ALPHABET.length)

/** Generated, never user-chosen: there is no vault behind this to backstop a weak password. */
export function generateRecoveryCode(): string {
  const chars: string[] = []
  while (chars.length < CODE_LENGTH) {
    for (const b of webcrypto.getRandomValues(new Uint8Array(32))) {
      if (b >= REJECTION_CEILING) continue
      chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]!)
      if (chars.length === CODE_LENGTH) break
    }
  }
  return Array.from({ length: CODE_GROUPS }, (_, g) =>
    chars.slice(g * CODE_GROUP_LENGTH, (g + 1) * CODE_GROUP_LENGTH).join(''),
  ).join('-')
}

async function deriveWrappingKey(code: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
  return webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

// btoa/atob: no Buffer in the app bundle. Inputs are a salt, an IV and one wrapped scalar.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// ── The Recovery File ─────────────────────────────────────────────────────────────────────

/**
 * The PLAINTEXT header. `receiveAddress` is identifying, not secret — it is how a user tells two
 * files apart. `registrationBlock` is honestly `null` before registration (backup gates it).
 */
export interface BackupHeader {
  receiveAddress?: string
  /** The block `auditorKeyAtBackupBlock` was read at. Live read — never a literal. */
  backupBlock: number
  /** `get_auditor_public_key()` as of `backupBlock`, hex felt. Live read. */
  auditorKeyAtBackupBlock: string
  registrationBlock: number | null
}

export interface CreatedBackup {
  /** The file's bytes, as JSON text. Useless without `recoveryCode`. */
  file: string
  filename: string
  recoveryCode: string
}

/** v2 binds the header as AES-GCM additionalData (v1 allowed header swap). */
export const BACKUP_ENVELOPE_VERSION = 2
/** v1 is decrypted WITHOUT additional data; a v2→v1 downgrade fails GCM auth. */
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2]
/** Attacker-chosen input: unbounded iterations are a hung tab with no error. */
export const MAX_KDF_ITERATIONS = 10_000_000
/** Checked on the ENCODED length before `atob` allocates. */
export const MAX_CIPHERTEXT_BYTES = 4096

const HEX_FELT_PATTERN = /^0x[0-9a-fA-F]{1,64}$/
const SUPPORTED_KDF = 'PBKDF2-SHA256' // changing it MUST bump BACKUP_ENVELOPE_VERSION

/** Top-level keys sorted, `undefined` dropped — flat scalars only (`assertWritableHeader`). */
function canonicalHeaderBytes(header: unknown): Uint8Array {
  const canonical =
    header === undefined || header === null || typeof header !== 'object' || Array.isArray(header)
      ? JSON.stringify(header ?? null)
      : JSON.stringify(
          Object.fromEntries(
            Object.entries(header as Record<string, unknown>)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        )
  return new TextEncoder().encode(canonical)
}

function isHexFelt(value: unknown): value is string {
  return typeof value === 'string' && HEX_FELT_PATTERN.test(value) && BigInt(value) < FELT_PRIME
}

function assertWritableHeader(header: BackupHeader): void {
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('refusing to write a Recovery File without a header')
  }
  const block = header.backupBlock
  if (typeof block !== 'number' || !Number.isInteger(block) || block < 0) {
    throw new Error(`refusing to write a Recovery File at backup block ${String(block)}`)
  }
  if (!isHexFelt(header.auditorKeyAtBackupBlock)) {
    throw new Error(`refusing to write a Recovery File whose auditor key is not a felt: ${String(header.auditorKeyAtBackupBlock)}`)
  }
  const reg = header.registrationBlock
  if (reg !== null && (!Number.isInteger(reg as number) || (reg as number) < 0)) {
    throw new Error(`refusing to write a Recovery File at registration block ${String(reg)}`)
  }
  if (header.receiveAddress !== undefined && !isHexFelt(header.receiveAddress)) {
    throw new Error(`refusing to write a Recovery File whose receive address is not a felt: ${String(header.receiveAddress)}`)
  }
  // The canonicalization sorts top-level keys only, so a nested value would be unorderable.
  for (const [key, value] of Object.entries(header)) {
    if (value !== null && typeof value === 'object') {
      throw new Error(
        `refusing to write a Recovery File whose header field ${JSON.stringify(key)} is not a scalar: ` +
          'the header is authenticated by canonicalizing its top-level keys, which cannot order a nested value',
      )
    }
  }
}

/** Not unique by design — the OS `(1)` suffix beats a timestamp nobody can read. */
export function backupFilename(header: BackupHeader): string {
  const reissued = header.registrationBlock !== null ? '-reissued' : ''
  return `strk20-recovery-block-${header.backupBlock}${reissued}.json`
}

/** Two-secret split: file useless without code, code useless without file. We hold neither. */
export async function createBackup(privateKey: string, header: BackupHeader): Promise<CreatedBackup> {
  if (!isStarkPrivateKey(privateKey)) {
    throw new Error('refusing to wrap something that is not a Stark private key')
  }
  assertWritableHeader(header)
  const recoveryCode = generateRecoveryCode()
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const key = await deriveWrappingKey(canonicalizeRecoveryCode(recoveryCode), salt, KDF_ITERATIONS)
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: canonicalHeaderBytes(header) },
      key,
      new TextEncoder().encode(privateKey),
    ),
  )
  const file = JSON.stringify(
    { v: BACKUP_ENVELOPE_VERSION, kdf: SUPPORTED_KDF, iterations: KDF_ITERATIONS,
      header, salt: b64(salt), iv: b64(iv), ct: b64(ct) },
    null, 2,
  )
  return { file, filename: backupFilename(header), recoveryCode }
}

/** The plaintext header without the code. Never throws; `null` when unreadable. */
export function readBackupHeader(file: string): BackupHeader | null {
  try {
    const env = JSON.parse(file) as { header?: unknown }
    return parseHeader(env?.header)
  } catch {
    return null
  }
}

function parseHeader(value: unknown): BackupHeader | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const h = value as Record<string, unknown>
  if (!Number.isInteger(h.backupBlock) || (h.backupBlock as number) < 0) return null
  if (!isHexFelt(h.auditorKeyAtBackupBlock)) return null
  if (h.registrationBlock !== null) {
    if (!Number.isInteger(h.registrationBlock) || (h.registrationBlock as number) < 0) return null
  }
  if (h.receiveAddress !== undefined && !isHexFelt(h.receiveAddress)) return null
  return {
    ...(h.receiveAddress !== undefined ? { receiveAddress: h.receiveAddress as string } : {}),
    backupBlock: h.backupBlock as number,
    auditorKeyAtBackupBlock: h.auditorKeyAtBackupBlock,
    registrationBlock: h.registrationBlock as number | null,
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────────────────

/** `undecryptable` is the ONLY kind that blames the code, reachable only from a valid envelope. */
export type BackupRestoreFailure = 'not-json' | 'not-an-envelope' | 'unsupported-version' | 'undecryptable'

export class BackupRestoreError extends Error {
  constructor(readonly kind: BackupRestoreFailure, message: string, readonly detail?: string) {
    super(message)
    this.name = 'BackupRestoreError'
  }
}

interface ValidatedEnvelope {
  iterations: number
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
  additionalData: Uint8Array | undefined
}

const malformed = (detail: string) => new BackupRestoreError('not-an-envelope', MALFORMED_BACKUP_FILE, detail)

function decodeField(value: unknown, field: string, expectedBytes?: number, maxBytes?: number): Uint8Array {
  if (typeof value !== 'string' || !value || !BASE64_PATTERN.test(value)) throw malformed(`${field} is not base64`)
  if (maxBytes !== undefined && value.length > Math.ceil(maxBytes / 3) * 4) {
    throw malformed(`${field} is ${value.length} base64 characters, above the ${maxBytes}-byte cap`)
  }
  let bytes: Uint8Array
  try {
    bytes = unb64(value)
  } catch (e) {
    throw malformed(`${field} did not decode: ${String(e)}`)
  }
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw malformed(`${field} is ${bytes.length} bytes, expected ${expectedBytes}`)
  }
  return bytes
}

/** Parse → null/array → version (BEFORE field types) → every field. Nothing blames the code. */
function validateEnvelope(file: string): ValidatedEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(file)
  } catch (e) {
    throw new BackupRestoreError('not-json', MALFORMED_BACKUP_FILE, String(e))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw malformed(`top level is ${parsed === null ? 'null' : typeof parsed}`)
  }
  const env = parsed as Record<string, unknown>
  if (typeof env.v !== 'number' || !Number.isInteger(env.v) || env.v < 1) {
    throw malformed(`v is ${env.v === undefined ? 'absent' : String(env.v)}`)
  }
  if (!SUPPORTED_BACKUP_VERSIONS.includes(env.v)) {
    throw new BackupRestoreError('unsupported-version', UNSUPPORTED_BACKUP_VERSION, `envelope version ${String(env.v)}`)
  }
  if (env.kdf !== undefined && env.kdf !== SUPPORTED_KDF) {
    throw new BackupRestoreError('unsupported-version', UNSUPPORTED_BACKUP_VERSION, `kdf is ${String(env.kdf)}`)
  }
  const iterations = env.iterations
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < 1) {
    throw malformed(`iterations is ${String(iterations)}`)
  }
  if (iterations > MAX_KDF_ITERATIONS) throw malformed(`iterations is ${iterations}, above the ${MAX_KDF_ITERATIONS} cap`)
  const salt = decodeField(env.salt, 'salt', 16)
  const iv = decodeField(env.iv, 'iv', 12)
  const ct = decodeField(env.ct, 'ct', undefined, MAX_CIPHERTEXT_BYTES)
  // A 16-byte GCM tag with no plaintext behind it cannot be a wrapped key.
  if (ct.length <= 16) throw malformed(`ct is ${ct.length} bytes, too short to be an AES-GCM ciphertext and tag`)
  return { iterations, salt, iv, ct, additionalData: env.v === 1 ? undefined : canonicalHeaderBytes(env.header) }
}

/** Opens a file with its code. Uses the file's OWN iteration count. */
export async function restoreBackup(file: string, recoveryCode: string): Promise<string> {
  const env = validateEnvelope(file)
  if (typeof recoveryCode !== 'string' || normalizeRecoveryCode(recoveryCode).length === 0) {
    throw new BackupRestoreError(
      'undecryptable', WRONG_RECOVERY_CODE,
      `no recovery code was supplied (${recoveryCode === undefined ? 'undefined' : typeof recoveryCode})`,
    )
  }
  const canonical = canonicalizeRecoveryCode(recoveryCode)
  const key = await deriveWrappingKey(canonical, env.salt, env.iterations)
  try {
    const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: env.iv, additionalData: env.additionalData }, key, env.ct)
    return new TextDecoder().decode(pt)
  } catch {
    throw new BackupRestoreError(
      'undecryptable', WRONG_RECOVERY_CODE,
      `AES-GCM authentication failed: v${env.additionalData ? '2 (header bound)' : '1 (no header binding)'}, ` +
        `${env.iterations} iterations, ${env.ct.length}-byte ct, code canonicalized to ${canonical.length} characters` +
        `${RECOVERY_CODE_PATTERN.test(canonical) ? '' : ' (NOT a well-formed recovery code)'}`,
    )
  }
}
