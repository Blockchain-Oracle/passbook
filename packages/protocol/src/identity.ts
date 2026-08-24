import { ec, hash, stark } from 'starknet'
import {
  BACKUP_VERIFICATION_FAILED, MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION,
  WRONG_RECOVERY_CODE,
} from './backup-copy.js'

// Re-exported so a caller handling `restoreBackup`'s or `verifyBackupAgainstKey`'s errors
// finds the sentences beside the functions that produce them. Defined once, in
// `backup-copy.ts`, with every other sentence. All FOUR that this module can hand back are
// here — `BACKUP_VERIFICATION_FAILED` was missing, which made the convention look like it
// covered only the restore path when the verification path returns these too.
export {
  BACKUP_VERIFICATION_FAILED, MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION,
  WRONG_RECOVERY_CODE,
}

// Web Crypto, resolved from the global — works unchanged in the browser (FR-011 runs there)
// and in Node ≥ 20 / vitest, where `globalThis.crypto` is the WebCrypto instance. The earlier
// `node:crypto` import bound this module to Node and would not bundle for the app (AD-4).
const webcrypto: Crypto = globalThis.crypto

const KDF_ITERATIONS = 600_000            // OWASP 2023 floor for PBKDF2-SHA256
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // no I, O — misread as 1, 0

/**
 * The root **Account Key** — a locally generated Stark scalar (D33). This is NOT a wallet
 * signing key and MUST NOT be derived from any wallet signature: the pool viewing key is
 * WriteOnce-immutable, and a wallet's signature is not contractually deterministic (Ready
 * multi-signer arrays change when a guardian is added; Braavos WebAuthn is non-deterministic),
 * so a signature-derived key would strand funds on a guardian/owner change. See D18/D33.
 */
export function generateIdentity(): { privateKey: string; publicKey: string } {
  const privateKey = stark.randomAddress()
  return { privateKey, publicKey: deriveIdentityPublicKey(privateKey) }
}

export function deriveIdentityPublicKey(privateKey: string): string {
  return ec.starkCurve.getStarkKey(privateKey)
}

// The pool's canonical-key rule (deployed class, `utils.cairo:is_canonical_key`) is the STRICT
// bound `1 <= k < ORDER/2`. `MAX_VIEWING_KEY` is exactly `ORDER/2` (== the pool's `HALF_ORDER`),
// so a legal key is `1 <= k < MAX_VIEWING_KEY` — strict upper bound. Note the SDK ships an
// INCLUSIVE `assertInRange(k, 1, MAX_VIEWING_KEY)`, which admits the single illegal value
// `k == MAX_VIEWING_KEY`; we enforce the contract's strict rule here instead.
export const MAX_VIEWING_KEY = ec.starkCurve.CURVE.n / 2n

/** Throws unless `k` is a legal pool viewing key (`1 <= k < MAX_VIEWING_KEY`). */
export function assertViewingKey(k: bigint): void {
  if (k < 1n || k >= MAX_VIEWING_KEY) {
    throw new Error(`viewing key ${k} is out of range [1, ${MAX_VIEWING_KEY})`)
  }
}

/**
 * Folds an arbitrary reduced scalar (`folded % ORDER`, in `[0, ORDER)`) into a canonical
 * viewing key in `[1, MAX_VIEWING_KEY)`.
 *
 * `k` and `ORDER − k` share a public-key x-coordinate, so exactly one of the pair is normally
 * in the lower half — we return that one. But three residues have **no** legal representative
 * and MUST NOT be silently coerced (the old `?: 1n` remap produced an out-of-range key on two of
 * them — verified in the D33 deep-recon, V4): `0`, `MAX_VIEWING_KEY`, and `MAX_VIEWING_KEY + 1`
 * (the `(HALF_ORDER, HALF_ORDER+1)` pair straddles the boundary with neither side below it). On
 * those we THROW rather than register a key the pool would reject. Probability ≈ 3 · 2⁻²⁵¹ — it
 * effectively never fires on real input, but a strict assert is correct where a silent remap is a
 * latent fund-loss bug.
 */
export function canonicalizeViewingKey(reduced: bigint): bigint {
  const order = ec.starkCurve.CURVE.n
  let k = ((reduced % order) + order) % order   // normalize into [0, ORDER)
  if (k > MAX_VIEWING_KEY) k = order - k         // fold the strict upper half down
  assertViewingKey(k)                            // catches {0, MAX_VIEWING_KEY, MAX_VIEWING_KEY+1}
  return k
}

/**
 * Derives the privacy-pool VIEWING key from the locally-generated root **Account Key** (D33) —
 * never from a wallet signature (see `generateIdentity`). This is the sponsor's own derivation
 * (`reference/privacy/demo/src/session.ts`) with the range fold corrected (AD-4): sign the
 * canonical `<chainId>:<poolAddress>` message with the account key, fold `(r, s)` through
 * Poseidon, reduce mod ORDER, then canonicalize into the legal range.
 *
 * WHY DERIVE RATHER THAN STORE A SECOND SECRET. The viewing key is written on-chain once and
 * irreversibly by registration — lose it and the account is orphaned. Stark-curve ECDSA is
 * deterministic (RFC-6979 in starknet.js), so deriving it from the one root key we already hold
 * means one backup covers everything (FR-013). It is bound to the pool and chain on purpose: the
 * same account key against a different pool yields an unrelated key, so one pool's indexer cannot
 * read another's notes.
 */
export function deriveViewingKey(
  accountKey: string,
  chainId: string,
  poolAddress: string,
): bigint {
  const messageHash = hash.starknetKeccak(`${chainId}:${poolAddress}`)
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, accountKey)
  const folded = BigInt(hash.computePoseidonHashOnElements([signature.r, signature.s]))
  return canonicalizeViewingKey(folded)
}

// ── The Recovery Code (AC2) ───────────────────────────────────────────────────────────────

/** Four groups of six from the 34-character alphabet. 24 characters ≈ 122 bits. */
const CODE_GROUPS = 4
const CODE_GROUP_LENGTH = 6
const CODE_LENGTH = CODE_GROUPS * CODE_GROUP_LENGTH

/**
 * The one rule for what a Recovery Code looks like, shared by the generator, the paste
 * field, the tests and the verifier.
 *
 * Exported because three places would otherwise each carry their own regex and one of them
 * would keep the old four-groups-of-four shape. The character class is `CODE_ALPHABET`
 * expressed as ranges: `I` and `O` are absent from both, and they must stay absent from
 * both — a pattern that admits a character the generator never emits turns a typo into an
 * accepted paste that then fails to decrypt.
 */
export const RECOVERY_CODE_PATTERN = /^[0-9A-HJ-NP-Z]{6}(?:-[0-9A-HJ-NP-Z]{6}){3}$/

/**
 * Whitespace plus every dash a rich-text editor might substitute for the ASCII one:
 * hyphen-minus, Armenian hyphen, Hebrew maqaf, Canadian syllabics hyphen, Mongolian soft
 * hyphen, the U+2010–U+2015 block (including the en and em dashes autocorrect loves), hyphen
 * bullet, minus sign, the two- and three-em dashes, and the small and fullwidth forms.
 */
const DASH_FAMILY =
  /[\s\u002D\u058A\u05BE\u1400\u1806\u2010-\u2015\u2043\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g

/**
 * Characters that occupy no width and carry no meaning here: zero-width space, non-joiner and
 * joiner, the bidi marks, the word joiner, the byte-order mark, and the soft hyphen. These
 * ride along invisibly on a copy out of a PDF or a styled web page.
 */
const INVISIBLES = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g

/**
 * Strips a pasted code down to the 24 characters that carry meaning.
 *
 * NFKC first, so the compatibility forms an IME produces fold to ASCII — a fullwidth `Ａ` is
 * the letter the user typed, and the fullwidth dash was already handled while the fullwidth
 * LETTERS were not. Then the dash family and the invisibles, then upper case.
 *
 * NOT normalized: `O`→`0` and `I`→`1`. Those characters are absent from the alphabet precisely
 * so they are never generated, so mapping them would be inventing a correction rather than
 * accepting a format variation.
 */
export function normalizeRecoveryCode(code: string): string {
  return code
    .normalize('NFKC')
    // Both sets are spelled as escapes above, because several of them are invisible or
    // indistinguishable from an ASCII hyphen in a source file.
    .replace(DASH_FAMILY, '')
    .replace(INVISIBLES, '')
    .toUpperCase()
}

/**
 * A pasted code in the exact shape the generator emits: `XXXXXX-XXXXXX-XXXXXX-XXXXXX`.
 *
 * THIS IS WHAT GOES INTO PBKDF2, at both ends, and that is the whole point. The derivation is
 * over bytes, so a lowercase paste or one whose dashes an email client rewrote derives a
 * different key and the file does not open — reported, before this existed, as the wrong-code
 * sentence. The tolerance the paste-to-confirm field had was therefore missing from the ONE
 * screen where it matters most: restoring on a new device, months later, from a code that was
 * copied out of a password manager into who knows what.
 *
 * A code that does not normalize to 24 characters is returned normalized but ungrouped. It was
 * never going to open anything, and inventing a grouping for it would only disguise that.
 * Canonicalizing an already-canonical code is a no-op, so files written before this keep
 * opening with the codes they were written with.
 */
export function canonicalizeRecoveryCode(code: string): string {
  const compact = normalizeRecoveryCode(code)
  if (compact.length !== CODE_LENGTH) return compact
  return Array.from({ length: CODE_GROUPS }, (_, g) =>
    compact.slice(g * CODE_GROUP_LENGTH, (g + 1) * CODE_GROUP_LENGTH),
  ).join('-')
}

// ── What counts as a Stark private key (one rule, one place) ──────────────────────────────

/**
 * The shape of a Stark private key as this codebase writes it: `0x` and up to 64 nibbles.
 *
 * Exported because it was hand-copied into three call sites, which is the drift this codebase
 * spends its comments warning about — `registration.ts`'s `isRegisterableKey` delegates here
 * rather than keeping a fourth copy.
 */
export const STARK_KEY_PATTERN = /^0x[0-9a-fA-F]{1,64}$/

/** The Stark field prime. A felt is strictly below it; anything at or above is not one. */
export const FELT_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n

/**
 * True when `k` is a usable Stark private key: right shape AND in `(0, ORDER)`.
 *
 * The shape check alone is not enough and the difference is a real one — `0x0` matches the
 * pattern and is not a key, and a 64-nibble value can sit above the curve order. Wrapping
 * either into a Recovery File produces a backup of something that cannot sign.
 */
export function isStarkPrivateKey(k: unknown): k is string {
  if (typeof k !== 'string' || !STARK_KEY_PATTERN.test(k)) return false
  const n = BigInt(k)
  return n > 0n && n < ec.starkCurve.CURVE.n
}

/**
 * The largest multiple of the alphabet size that fits in a byte: 34 × 7 = 238.
 *
 * Bytes at or above this are DISCARDED rather than reduced. `b % 34` over a uniform byte is
 * not uniform — 256 = 7×34 + 18, so the first 18 letters of the alphabet come up eight times
 * per 256 draws and the remaining 16 come up seven, making them ~14% more likely. That is a
 * real, if small, bite out of the code's entropy, and it is the kind of defect that is free
 * to avoid now and impossible to fix later: every code already issued keeps its bias, and
 * this code is the only copy of a secret that cannot be rotated.
 */
const REJECTION_CEILING = CODE_ALPHABET.length * Math.floor(256 / CODE_ALPHABET.length)

/**
 * Generates the Recovery Code. NEVER user-chosen — there is no vault behind this to
 * backstop a weak password, so the strength of the code is the strength of the backup.
 *
 * Exported so the format and the absence of modulo bias can be tested over many thousands
 * of draws; going through `createBackup` for that would run PBKDF2 600,000 times per sample.
 */
export function generateRecoveryCode(): string {
  const chars: string[] = []
  // Draw in batches rather than one byte at a time: with a ~7% rejection rate a batch of
  // 32 almost always finishes a 24-character code in one call, and the loop stays correct
  // (not merely lucky) because it keeps drawing until the code is full.
  while (chars.length < CODE_LENGTH) {
    for (const b of webcrypto.getRandomValues(new Uint8Array(32))) {
      if (b >= REJECTION_CEILING) continue          // biased tail — discard, never reduce
      chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]!)
      if (chars.length === CODE_LENGTH) break
    }
  }
  return Array.from({ length: CODE_GROUPS }, (_, g) =>
    chars.slice(g * CODE_GROUP_LENGTH, (g + 1) * CODE_GROUP_LENGTH).join(''),
  ).join('-')
}

async function deriveWrappingKey(
  code: string, salt: Uint8Array, iterations: number,
): Promise<CryptoKey> {
  const base = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'],
  )
  return webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

// Universal base64 (browser + Node ≥ 16 both provide btoa/atob globally) — no Node `Buffer`,
// which would not exist in the app bundle.
//
// `String.fromCharCode(...u)` spreads one argument per byte, so it is bounded by the engine's
// argument limit (~64K on V8 and JavaScriptCore). Every buffer that reaches it here is a salt,
// an IV, or the ciphertext of one Stark scalar — 16, 12 and ~82 bytes. Fine at this size and
// noted rather than assumed: the day something larger is wrapped, this needs a chunked loop.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Standard base64 with correct padding — anything else is a damaged field, not a secret. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// ── The Recovery File (AC2/AC4) ───────────────────────────────────────────────────────────

/**
 * The PLAINTEXT header of a Recovery File. Deliberately readable without the code: a user
 * holding a file and wondering which account it belongs to must be able to find out without
 * first proving they can decrypt it, and an auditor-key record nobody can read is not a
 * record.
 *
 * WHAT "NOTHING SECRET" MEANS HERE, precisely, because the two claims sitting next to each
 * other read as a contradiction. No secret goes in — the account key is in `ct` and nowhere
 * else, and nothing here helps anyone open it. But `receiveAddress` IS IDENTIFYING: it is the
 * user's public receive address, so whoever holds this file learns which account it belongs
 * to and can look that account up on-chain. That is the trade the field exists to make. A
 * user with three Recovery Files and no memory of which is which has, functionally, no
 * backup, and the address is what tells them apart. It is not secret, it is not hidden, and
 * anyone the file reaches was already holding half of a two-secret split.
 *
 * EVERY FIELD MEANS EXACTLY WHAT IT IS NAMED, which is the whole reason `registrationBlock`
 * is nullable rather than absent or zero. Backup GATES registration, so at the moment the
 * first file is written the registration block does not exist yet; a header that reported
 * the backup block there, or a placeholder `0`, would be a field holding a different thing
 * than its label says. It carries `null`, honestly, and the post-registration re-issue
 * (`reissueBackupHeader`) writes a second file with the real number once there is one.
 *
 * `auditorKeyAtBackupBlock` is likewise named for what it is. The brief wants the auditor
 * key as of the registration block; a file written before registration cannot have that, so
 * it records the key it actually read and the block it read it at. On re-issue both move
 * forward together and stay consistent with each other.
 */
export interface BackupHeader {
  /**
   * The account's receive address, when the ceremony already knows it. Identifying but not
   * secret, and plaintext by design — it is how a user tells two Recovery Files apart. See
   * the note above.
   */
  receiveAddress?: string
  /** The block `auditorKeyAtBackupBlock` was read at. Live read — never a literal. */
  backupBlock: number
  /** `get_auditor_public_key()` as of `backupBlock`, as a hex felt. Live read. */
  auditorKeyAtBackupBlock: string
  /** The block registration landed in, or `null` while it has not happened yet. */
  registrationBlock: number | null
}

/** What `createBackup` hands the ceremony: the two secrets, plus the name to save under. */
export interface CreatedBackup {
  /** The Recovery File's bytes, as JSON text. Useless without `recoveryCode`. */
  file: string
  /** The download name. Epic 6 owns the anchor; the name is decided here so it is one name. */
  filename: string
  recoveryCode: string
}

/**
 * The envelope version this build WRITES.
 *
 * Version 2 binds the plaintext header to the ciphertext as AES-GCM additional authenticated
 * data. Version 1 did not, which meant a header could be swapped for another file's — a
 * different auditor key, a different registration block, a different receive address — and
 * the file would still decrypt, and the header would still be believed. That is precisely the
 * "every field means what it is named" rule failing at the only point an attacker controls.
 *
 * Bumping rather than silently changing `v:1`'s meaning is the spec's own pre-authorized
 * fallback ("bump to `v:2` accepting both") and it matters for one reason: a `v:1` file read
 * by a binding reader would fail authentication and be reported as a wrong recovery code. A
 * format change that accuses the user's code is the exact defect this story exists to remove.
 */
export const BACKUP_ENVELOPE_VERSION = 2

/**
 * The versions this build READS. `v:1` is accepted and decrypted WITHOUT additional data,
 * because that is how it was written; its header is therefore advisory and unauthenticated.
 *
 * A downgrade does not buy an attacker anything: rewriting a `v:2` file's version to `1`
 * makes the reader omit the additional data the ciphertext was sealed with, so GCM
 * authentication fails and nothing opens.
 */
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2]

/** A hex felt, as the header records the auditor key. Bounded so a giant string is refused. */
const HEX_FELT_PATTERN = /^0x[0-9a-fA-F]{1,64}$/

/**
 * The upper bound on `iterations` a file may ask this build to run.
 *
 * PBKDF2 is deliberately slow and the count comes out of the file, so an attacker who hands
 * a user a crafted Recovery File can choose how long their tab hangs: `iterations: 2e9` is
 * not a decryption failure, it is a browser that stops responding with no error to show. Ten
 * million is roughly sixteen times the current floor — ample room for the floor to keep
 * rising over the years, and still a bounded wait.
 */
export const MAX_KDF_ITERATIONS = 10_000_000

/** The one KDF this format has ever used. Changing it MUST bump `BACKUP_ENVELOPE_VERSION`. */
const SUPPORTED_KDF = 'PBKDF2-SHA256'

/**
 * The exact bytes the header is authenticated as.
 *
 * Canonical, with keys sorted, so that re-serialising a parsed header reproduces byte for
 * byte what was sealed — `JSON.stringify` otherwise preserves insertion order, and a reader
 * that re-emitted the keys in a different order would fail to authenticate a perfectly good
 * file. Sorting also means a REORDERED header still opens (it says the same thing) while an
 * edited, extended or truncated one does not (it does not).
 *
 * ONLY THE TOP LEVEL IS SORTED, so this is correct only for a header of flat scalars. That is
 * not a hope: `assertWritableHeader` refuses to write a nested value, so the shape this can
 * canonicalize is the only shape that can exist. Adding a nested field later means making
 * this recursive FIRST — otherwise the reordering guarantee quietly stops holding for that
 * field and the failure shows up as a good file that will not open.
 */
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

/** True for a hex felt that is actually below the field prime, not merely 64 nibbles long. */
function isHexFelt(value: unknown): value is string {
  return typeof value === 'string' && HEX_FELT_PATTERN.test(value) && BigInt(value) < FELT_PRIME
}

/** Throws unless `header` is one this build is willing to write into a file. */
function assertWritableHeader(header: BackupHeader): void {
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('refusing to write a Recovery File without a header')
  }
  const block = header.backupBlock
  if (typeof block !== 'number' || !Number.isInteger(block) || block < 0) {
    // Without this the filename becomes `passbook-recovery-block-NaN.json` and the header
    // records a block that never existed — a file that lies about itself from birth.
    throw new Error(`refusing to write a Recovery File at backup block ${String(block)}`)
  }
  if (!isHexFelt(header.auditorKeyAtBackupBlock)) {
    throw new Error(
      `refusing to write a Recovery File whose auditor key is not a felt: ${String(header.auditorKeyAtBackupBlock)}`,
    )
  }
  const reg = header.registrationBlock
  if (reg !== null && (!Number.isInteger(reg as number) || (reg as number) < 0)) {
    throw new Error(`refusing to write a Recovery File at registration block ${String(reg)}`)
  }
  if (header.receiveAddress !== undefined && !isHexFelt(header.receiveAddress)) {
    throw new Error(
      `refusing to write a Recovery File whose receive address is not a felt: ${String(header.receiveAddress)}`,
    )
  }
  // FLAT SCALARS ONLY, enforced rather than assumed — see `canonicalHeaderBytes`. The
  // authentication canonicalizes by sorting the TOP-LEVEL keys, so a nested object or array
  // would be serialized in whatever order it happened to arrive in, and the guarantee that a
  // reordered header still opens would silently stop holding the day someone adds one.
  for (const [key, value] of Object.entries(header)) {
    if (value !== null && typeof value === 'object') {
      throw new Error(
        `refusing to write a Recovery File whose header field ${JSON.stringify(key)} is not a scalar: ` +
          'the header is authenticated by canonicalizing its top-level keys, which cannot order a nested value',
      )
    }
  }
}

/**
 * The download name. Carries the backup block so a user with two files can tell which is the
 * later one without opening either — and carries nothing else, because a filename is the one
 * part of this that shows up in a screenshot, a shared folder listing and a download bar.
 *
 * NOT UNIQUE, and it is not trying to be: two files written at the same block collide, which
 * a re-issue in the registration's own block can genuinely do. The re-issue is marked so the
 * two are distinguishable, and beyond that the operating system's own `(1)` suffix is a
 * better answer than a timestamp nobody can read — but a caller that needs a guaranteed
 * unique name must make one, not assume this is one.
 */
export function backupFilename(header: BackupHeader): string {
  const reissued = header.registrationBlock !== null ? '-reissued' : ''
  return `passbook-recovery-block-${header.backupBlock}${reissued}.json`
}

/**
 * Two-secret split: the file is useless without the code, and the code is useless
 * without the file. We never see either. There is no vault to fall back on, which
 * is exactly why the code is generated rather than chosen by the user.
 *
 * `header` is REQUIRED, and it is a parameter rather than something read in here, because
 * both of its live values come from the chain and this module does no I/O. The caller reads
 * them (`readBackupHeaderContext` in `backup-gate.ts`) and gets a typed failure if the chain
 * cannot be reached — at which point no file is written at all, rather than one carrying a
 * guessed block or a stale auditor key.
 *
 * The header is SEALED WITH the key, as GCM additional data, so it cannot be edited after the
 * fact without the file ceasing to open. It stays plaintext and readable — additional data is
 * authenticated, not encrypted — which is what the header is for.
 */
export async function createBackup(
  privateKey: string,
  header: BackupHeader,
): Promise<CreatedBackup> {
  if (!isStarkPrivateKey(privateKey)) {
    throw new Error('refusing to wrap something that is not a Stark private key')
  }
  assertWritableHeader(header)
  const recoveryCode = generateRecoveryCode()
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  // Canonicalized at BOTH ends. The generated code is already canonical, so this is a no-op
  // here — written anyway so the symmetry with `restoreBackup` is visible rather than a fact
  // you have to reconstruct from two files.
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

/**
 * The header for the post-registration re-issue, per Abu's provisional + re-issue ruling.
 *
 * The re-issued file is a SECOND file, not a replacement: the old one still opens the same
 * key with its old code and nothing can invalidate it (see `BACKUP_REWRAP_NO_REVOCATION` —
 * copy that implies otherwise is forbidden). This exists so the header's promise about the
 * registration block can finally be kept, not so the first file can be retired.
 *
 * Both live values move forward together: `backupBlock` and `auditorKeyAtBackupBlock` are
 * re-read at re-issue time, so the pair stays internally consistent even in the case the
 * pinning exists for — StarkWare rotating the auditor key between the two writes.
 */
export function reissueBackupHeader(
  previous: BackupHeader,
  reissue: { backupBlock: number; auditorKeyAtBackupBlock: string; registrationBlock: number },
): BackupHeader {
  return {
    ...(previous.receiveAddress !== undefined ? { receiveAddress: previous.receiveAddress } : {}),
    backupBlock: reissue.backupBlock,
    auditorKeyAtBackupBlock: reissue.auditorKeyAtBackupBlock,
    registrationBlock: reissue.registrationBlock,
  }
}

/**
 * Reads the plaintext header out of a Recovery File WITHOUT the code.
 *
 * Returns `null` for a file that has no readable header — including one written before
 * headers existed. Never throws: this runs on a file the user just dropped on a page.
 */
export function readBackupHeader(file: string): BackupHeader | null {
  try {
    const env = JSON.parse(file) as { header?: unknown }
    return parseHeader(env?.header)
  } catch {
    return null
  }
}

/**
 * Validates a parsed header, or `null`.
 *
 * EVERY field is type-checked, not just probed for presence. A header is the one part of the
 * file an attacker can hand over in whatever shape they like, and callers read these values
 * into a UI that states them as facts — `backupBlock` into a sentence about when the key was
 * escrowed, `auditorKeyAtBackupBlock` into a sentence about who can decrypt it. A header
 * carrying `backupBlock: "soon"` or an auditor key that is not a felt must read as no header
 * at all rather than flow through to a screen. (On a `v:2` file the header is additionally
 * authenticated by decryption; on `v:1` these checks are the only defence there is.)
 */
function parseHeader(value: unknown): BackupHeader | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const h = value as Record<string, unknown>
  if (!Number.isInteger(h.backupBlock) || (h.backupBlock as number) < 0) return null
  // Below the field prime, not merely 64 nibbles long: `0xff…ff` is the right LENGTH and is
  // not a felt, so a length-only check passes a value the chain could never have returned.
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

// ── Restore, and the error taxonomy that decides who gets blamed (AC2) ────────────────────

/**
 * Why a restore failed, discriminated.
 *
 * The discrimination is the feature. Before this, every failure after `JSON.parse` returned
 * the wrong-code sentence, so a truncated download told the user their Recovery Code was
 * wrong — sending them to re-type the one secret that was actually fine, and teaching them
 * to doubt a code that cannot be reissued. `undecryptable` is now the ONLY kind that says
 * anything about the code, and it is only reachable from a fully-validated envelope.
 */
export type BackupRestoreFailure =
  | 'not-json'
  | 'not-an-envelope'
  | 'unsupported-version'
  | 'undecryptable'

/** Thrown by `restoreBackup`. `message` is user-facing copy; `kind` is for branching on. */
export class BackupRestoreError extends Error {
  constructor(
    readonly kind: BackupRestoreFailure,
    message: string,
    /** What actually failed, for logs. Never shown — it is not a sentence. */
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'BackupRestoreError'
  }
}

/** The envelope fields `restoreBackup` needs, after validation has vouched for all of them. */
interface ValidatedEnvelope {
  iterations: number
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
  /** The GCM additional data, or `undefined` for a `v:1` file, which was sealed without any. */
  additionalData: Uint8Array | undefined
}

/**
 * The largest ciphertext this build will decode.
 *
 * What is actually wrapped is one Stark scalar — 66 characters, so ~82 bytes with the GCM tag.
 * Four kilobytes is fifty times that and still nothing. The bound exists for the same reason
 * `MAX_KDF_ITERATIONS` does: `ct` is attacker-chosen input, and a few hundred megabytes of
 * base64 is the same denial of service one field over — `atob` materialises the whole thing
 * before anything gets a chance to reject it.
 */
export const MAX_CIPHERTEXT_BYTES = 4096

/** Decodes a base64 field, or throws the malformed-file error naming the field. */
function decodeField(
  value: unknown, field: string, expectedBytes?: number, maxBytes?: number,
): Uint8Array {
  if (typeof value !== 'string' || !value || !BASE64_PATTERN.test(value)) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE, `${field} is not base64`,
    )
  }
  // Checked on the ENCODED length, before `atob` allocates. Base64 is 4 characters per 3
  // bytes, so this bound is generous by a third and still refuses the field long before it
  // becomes memory.
  if (maxBytes !== undefined && value.length > Math.ceil(maxBytes / 3) * 4) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE,
      `${field} is ${value.length} base64 characters, above the ${maxBytes}-byte cap`,
    )
  }
  let bytes: Uint8Array
  try {
    bytes = unb64(value)
  } catch (e) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE, `${field} did not decode: ${String(e)}`,
    )
  }
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE,
      `${field} is ${bytes.length} bytes, expected ${expectedBytes}`,
    )
  }
  return bytes
}

/**
 * Turns file text into an envelope we are willing to attempt a decryption with, or throws.
 *
 * EVERYTHING CHECKABLE IS CHECKED HERE, before the code is implicated, and the ordering is
 * the point: parse, then null, then shape, then version, then every field's type and length.
 * The previous version read `.v` straight off `JSON.parse`'s result — so the four bytes
 * `null` raised a bare TypeError out of the module — and decoded `salt` outside the try
 * while decoding `iv` and `ct` inside it, which is what turned a damaged ciphertext into an
 * accusation about the user's code.
 *
 * The residual limit, stated rather than left to be discovered: a ciphertext truncated to a
 * length that is still plausible, with an intact salt and IV, is cryptographically
 * indistinguishable from a wrong code — AES-GCM authentication fails identically either way.
 * Structure catches truncated JSON, damaged base64, wrong-length salts and IVs, and a
 * ciphertext too short to be a GCM output at all, which covers the corruption that actually
 * happens (a partial write, a partial download, an editor that "fixed" the file).
 */
function validateEnvelope(file: string): ValidatedEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(file)
  } catch (e) {
    throw new BackupRestoreError('not-json', MALFORMED_BACKUP_FILE, String(e))
  }
  // `JSON.parse('null')` succeeds and yields null; `JSON.parse('[]')` yields an array. Both
  // are valid JSON and neither is an envelope, so both are caught before any field is read.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE, `top level is ${parsed === null ? 'null' : typeof parsed}`,
    )
  }
  const env = parsed as Record<string, unknown>
  // A POSITIVE INTEGER `v` is what makes this a version claim. Anything else is some other
  // JSON the user dropped by mistake, and reporting it as "written by a newer version of this
  // app, do not delete it" would be telling them a shopping list is a Recovery File. `NaN`,
  // `0`, `-1` and `1.5` are all `typeof 'number'` and none of them is a version.
  if (typeof env.v !== 'number' || !Number.isInteger(env.v) || env.v < 1) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE,
      `v is ${env.v === undefined ? 'absent' : String(env.v)}`,
    )
  }
  // Version is checked BEFORE the field types, so a future envelope with a different shape
  // is reported as "newer than this build" rather than as corrupt. Telling a user their only
  // copy is corrupt when it is merely newer is how a good file gets deleted.
  if (!SUPPORTED_BACKUP_VERSIONS.includes(env.v)) {
    throw new BackupRestoreError(
      'unsupported-version', UNSUPPORTED_BACKUP_VERSION, `envelope version ${String(env.v)}`,
    )
  }
  // The KDF is read rather than assumed. A file naming a function we do not implement must
  // not be fed to PBKDF2 anyway and then reported as a wrong code — the code would have been
  // right, and the derivation was never going to match. Any change to the KDF bumps
  // BACKUP_ENVELOPE_VERSION; this field exists so a mismatch is caught even if someone
  // forgets to.
  if (env.kdf !== undefined && env.kdf !== SUPPORTED_KDF) {
    throw new BackupRestoreError(
      'unsupported-version', UNSUPPORTED_BACKUP_VERSION, `kdf is ${String(env.kdf)}`,
    )
  }
  const iterations = env.iterations
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < 1) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE, `iterations is ${String(iterations)}`,
    )
  }
  // The iteration count is attacker-chosen input. Unbounded, it is a denial of service with
  // no error message: the tab stops responding inside PBKDF2 and the user is left with a
  // Recovery File that "hangs". Over the cap is a refusal, not a slow success.
  if (iterations > MAX_KDF_ITERATIONS) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE,
      `iterations is ${iterations}, above the ${MAX_KDF_ITERATIONS} cap`,
    )
  }
  const salt = decodeField(env.salt, 'salt', 16)
  const iv = decodeField(env.iv, 'iv', 12)
  const ct = decodeField(env.ct, 'ct', undefined, MAX_CIPHERTEXT_BYTES)
  // AES-GCM appends a 16-byte tag, so a ciphertext of 16 bytes or fewer carries no plaintext
  // at all and cannot be a wrapped key. Refusing it here keeps the wrong-code sentence for
  // files that could genuinely have opened with a different code.
  if (ct.length <= 16) {
    throw new BackupRestoreError(
      'not-an-envelope', MALFORMED_BACKUP_FILE,
      `ct is ${ct.length} bytes, too short to be an AES-GCM ciphertext and tag`,
    )
  }
  return {
    iterations,
    salt,
    iv,
    ct,
    // `v:1` was written without additional data; `v:2` binds the header exactly as it appears
    // in the file, so any edit to it — including deleting it — changes the bytes GCM checks.
    additionalData: env.v === 1 ? undefined : canonicalHeaderBytes(env.header),
  }
}

/**
 * Opens a Recovery File with its Recovery Code, returning the account key.
 *
 * Reads both envelope versions (see `SUPPORTED_BACKUP_VERSIONS`). On a `v:2` file the header
 * is authenticated as part of the decryption, so a file that opens is a file whose header has
 * not been touched since it was written.
 */
export async function restoreBackup(file: string, recoveryCode: string): Promise<string> {
  const env = validateEnvelope(file)
  // An absent or empty code is not a wrong code, it is a caller that has not collected one.
  // Without this it reaches `importKey` and comes back as a raw WebCrypto error with no kind
  // attached — an untyped exception escaping the one function whose entire job is to classify.
  if (typeof recoveryCode !== 'string' || normalizeRecoveryCode(recoveryCode).length === 0) {
    throw new BackupRestoreError(
      'undecryptable', WRONG_RECOVERY_CODE,
      `no recovery code was supplied (${recoveryCode === undefined ? 'undefined' : typeof recoveryCode})`,
    )
  }
  // Canonicalized, so a lowercase paste or one whose dashes an email client rewrote derives
  // the same key. See `canonicalizeRecoveryCode` — this is the screen where it matters most.
  const canonical = canonicalizeRecoveryCode(recoveryCode)
  // Use the iteration count the envelope itself recorded, not the module's current
  // KDF_ITERATIONS floor — that floor is expected to rise over time, and every backup
  // must keep opening with the count it was actually written at.
  const key = await deriveWrappingKey(canonical, env.salt, env.iterations)
  try {
    const pt = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: env.iv, additionalData: env.additionalData }, key, env.ct,
    )
    return new TextDecoder().decode(pt)
  } catch {
    // The ONLY place the code is blamed, and by this point the envelope has been fully
    // validated — so "this file did not open with this code" is the honest reading.
    //
    // A tampered `v:2` header also lands here, and that is the right place for it: the file
    // and the code together did not produce the key, and we cannot tell the user WHICH half
    // someone else edited. What matters is that we do not hand back a key alongside a header
    // that lies about it.
    //
    // The detail says what was actually attempted, because this is the hardest branch to
    // debug and it was the only one arriving with empty logs: a GCM authentication failure
    // reports nothing about WHY, so a report of "it says my code is wrong" is otherwise
    // indistinguishable from a tampered header, a v:1/v:2 mix-up, or a code whose shape never
    // canonicalized. None of this is user-facing; `message` stays the one sentence.
    throw new BackupRestoreError(
      'undecryptable', WRONG_RECOVERY_CODE,
      `AES-GCM authentication failed: v${env.additionalData ? '2 (header bound)' : '1 (no header binding)'}, ` +
        `${env.iterations} iterations, ${env.ct.length}-byte ct, ` +
        `code canonicalized to ${canonical.length} characters` +
        `${RECOVERY_CODE_PATTERN.test(canonical) ? '' : ' (NOT a well-formed recovery code)'}`,
    )
  }
}

// ── Verifying an existing backup against the live identity (AC5) ──────────────────────────

/** Why a periodic verification did not pass. `different-key` is the one decryption cannot see. */
export type BackupVerificationFailure = BackupRestoreFailure | 'different-key'

export type BackupVerification =
  | { ok: true }
  | { ok: false; reason: BackupVerificationFailure; message: string }

/**
 * The sentence for each way a verification can fail. Per-kind, not one catch-all.
 *
 * The catch-all was `BACKUP_VERIFICATION_FAILED` — "Make a new one now" — for everything, and
 * on the unsupported-version branch that is actively harmful: the file is INTACT and opens
 * fine in a newer build, and telling its owner to replace it invites them to delete the only
 * copy of a key that cannot be reissued. That branch says "do not delete it" instead. A
 * damaged file gets the damage sentence for the same reason: it is what is true.
 *
 * Only `undecryptable` and `different-key` keep the verification-failure line, and those are
 * exactly the two that mean "this is not a working backup of this account".
 */
function verificationMessageFor(reason: BackupVerificationFailure): string {
  switch (reason) {
    case 'unsupported-version':
      return UNSUPPORTED_BACKUP_VERSION
    case 'not-json':
    case 'not-an-envelope':
      return MALFORMED_BACKUP_FILE
    case 'undecryptable':
    case 'different-key':
      return BACKUP_VERIFICATION_FAILED
  }
}

/**
 * The periodic check, as one operation: decrypt the file with the code AND confirm the key
 * inside is the key this account is actually using.
 *
 * BOTH HALVES, in one function, because either alone is a check that passes when it should
 * not. Decrypt-success alone marks a backup of a PREVIOUS identity as verified — exactly the
 * situation after a sweep to a new key, where the user's old Recovery File still opens
 * perfectly and protects nothing they now own. Comparing without decrypting proves only that
 * we remember our own key. A surface that only had `restoreBackup` would reach for the first
 * of those, so the composed check is the one that is exported and the one the cadence's
 * `onVerificationPassed` / `onVerificationFailed` are documented against.
 *
 * Never throws. The comparison is numeric, so `0x0a…` and `0xA…` are the same key.
 */
export async function verifyBackupAgainstKey(
  file: string,
  recoveryCode: string,
  expectedAccountKey: string,
): Promise<BackupVerification> {
  let recovered: string
  try {
    recovered = await restoreBackup(file, recoveryCode)
  } catch (e) {
    const kind = e instanceof BackupRestoreError ? e.kind : 'undecryptable'
    return { ok: false, reason: kind, message: verificationMessageFor(kind) }
  }
  let same: boolean
  try {
    same = BigInt(recovered) === BigInt(expectedAccountKey)
  } catch {
    same = recovered === expectedAccountKey
  }
  return same
    ? { ok: true }
    : { ok: false, reason: 'different-key', message: verificationMessageFor('different-key') }
}
