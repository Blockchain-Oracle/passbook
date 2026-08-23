import { ec, hash, stark } from 'starknet'

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

function generateRecoveryCode(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16))
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
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
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/**
 * Two-secret split: the file is useless without the code, and the code is useless
 * without the file. We never see either. There is no vault to fall back on, which
 * is exactly why the code is generated rather than chosen by the user.
 */
export async function createBackup(
  privateKey: string,
): Promise<{ file: string; recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode()
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const key = await deriveWrappingKey(recoveryCode, salt, KDF_ITERATIONS)
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey),
    ),
  )
  const file = JSON.stringify(
    { v: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS,
      salt: b64(salt), iv: b64(iv), ct: b64(ct) },
    null, 2,
  )
  return { file, recoveryCode }
}

export async function restoreBackup(file: string, recoveryCode: string): Promise<string> {
  let env: { v: number; iterations: number; salt: string; iv: string; ct: string }
  try {
    env = JSON.parse(file)
  } catch {
    throw new Error('That backup file is malformed or truncated.')
  }
  if (env.v !== 1) throw new Error(`unsupported backup version ${env.v}`)
  // Use the iteration count the envelope itself recorded, not the module's current
  // KDF_ITERATIONS floor — that floor is expected to rise over time, and every backup
  // must keep opening with the count it was actually written at.
  const key = await deriveWrappingKey(recoveryCode, unb64(env.salt), env.iterations)
  try {
    const pt = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct),
    )
    return new TextDecoder().decode(pt)
  } catch {
    throw new Error('That file and recovery code do not open this key.')
  }
}
