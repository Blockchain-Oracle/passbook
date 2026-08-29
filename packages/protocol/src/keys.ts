//
// The root Account Key and the viewing key derived from it. Browser-safe: `starknet` only, no
// `node:crypto`. Every algorithm here is compatibility-critical — the viewing key is WriteOnce on
// mainnet, so a changed derivation orphans every registered account. Do not "improve" it.
//

import { ec, hash, stark } from 'starknet'

/**
 * The root Account Key: a locally generated Stark scalar. NEVER derived from a wallet signature —
 * wallet signatures are not contractually deterministic (Ready multisig arrays, Braavos WebAuthn),
 * and the pool's viewing key cannot be replaced once written.
 */
export function generateIdentity(): { privateKey: string; publicKey: string } {
  const privateKey = stark.randomAddress()
  return { privateKey, publicKey: deriveIdentityPublicKey(privateKey) }
}

export function deriveIdentityPublicKey(privateKey: string): string {
  return ec.starkCurve.getStarkKey(privateKey)
}

// The pool's canonical-key rule is the STRICT bound `1 <= k < ORDER/2` (`HALF_ORDER`). The SDK's own
// `assertInRange` is inclusive and admits the one illegal value `k == MAX_VIEWING_KEY`.
export const MAX_VIEWING_KEY = ec.starkCurve.CURVE.n / 2n

/** Throws unless `k` is a legal pool viewing key (`1 <= k < MAX_VIEWING_KEY`). */
export function assertViewingKey(k: bigint): void {
  if (k < 1n || k >= MAX_VIEWING_KEY) {
    throw new Error(`viewing key ${k} is out of range [1, ${MAX_VIEWING_KEY})`)
  }
}

/**
 * Folds a reduced scalar into `[1, MAX_VIEWING_KEY)`. `k` and `ORDER − k` share a public-key x, so
 * the lower one is returned. The residues `{0, MAX, MAX+1}` have NO legal representative and throw
 * (p ≈ 3·2⁻²⁵¹) — a silent remap here was a latent fund-loss bug.
 */
export function canonicalizeViewingKey(reduced: bigint): bigint {
  const order = ec.starkCurve.CURVE.n
  let k = ((reduced % order) + order) % order
  if (k > MAX_VIEWING_KEY) k = order - k
  assertViewingKey(k)
  return k
}

/**
 * The viewing key: sign `<chainId>:<poolAddress>` with the account key (RFC-6979, deterministic),
 * Poseidon the `(r, s)` pair, canonicalize. Bound to chain + pool on purpose. One backup covers it.
 */
export function deriveViewingKey(accountKey: string, chainId: string, poolAddress: string): bigint {
  const messageHash = hash.starknetKeccak(`${chainId}:${poolAddress}`)
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, accountKey)
  const folded = BigInt(hash.computePoseidonHashOnElements([signature.r, signature.s]))
  return canonicalizeViewingKey(folded)
}

/** The shape of a Stark private key as this codebase writes it. The one copy. */
export const STARK_KEY_PATTERN = /^0x[0-9a-fA-F]{1,64}$/

/** The Stark field prime. A felt is strictly below it. */
export const FELT_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n

/** Right shape AND in `(0, ORDER)` — `0x0` matches the pattern and is not a key. */
export function isStarkPrivateKey(k: unknown): k is string {
  if (typeof k !== 'string' || !STARK_KEY_PATTERN.test(k)) return false
  const n = BigInt(k)
  return n > 0n && n < ec.starkCurve.CURVE.n
}
