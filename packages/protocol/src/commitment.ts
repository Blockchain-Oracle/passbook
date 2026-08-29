//
// Bearer commitments: the secret a position is claimed with, and the hash the chain stores.
//
// Kept apart from the calldata builders because this reaches `starknet.js` for Poseidon, which the
// eager browser chunk must never load: a commitment is computed ONCE, when a position is created,
// inside the lazy send graph, and everything that merely reads positions reads the stored hash.
//
// `markets.cairo` and `launch.cairo` key positions by `poseidon_hash_span(array![secret].span())`;
// if this function ever disagreed, every claim would revert `POSITION_NOT_OPEN` and the money would
// be gone. Whoever holds the secret holds the position — there is no address, no recovery, no
// second copy; `session-position-store.ts` is what makes it survive a reload.
//

import { hash } from 'starknet'

/**
 * The Stark field order, `2^251 + 17·2^192 + 1`. A secret at or above it is reduced modulo P on the
 * way into the hash, so the value that gets committed is not the value that was stored — refuse
 * instead of committing to a number nobody recorded.
 */
const STARK_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n

/** A freshly minted secret, and the commitment the chain will store for it. */
export interface PositionSecret {
  /** Bearer material. Never leaves the device except into a backup the user controls. */
  secret: string
  /** `poseidon(secret)`, as the contract computes it. Safe to publish — it IS published. */
  commitment: string
}

/**
 * `poseidon_hash_span([secret])`, byte for byte what the contracts compute.
 *
 * Throws rather than refusing, unlike the calldata builders: every caller here has already parsed
 * its input, and a commitment that silently came back wrong is worse than any stack trace.
 */
export function commitmentFor(secret: bigint | string): string {
  let value: bigint
  try {
    value = BigInt(secret)
  } catch {
    throw new Error(`${JSON.stringify(String(secret))} is not a felt, so it cannot be a secret`)
  }
  if (value <= 0n) {
    // Zero is refused by the contracts too (`ZERO_COMMITMENT`), but the reason to refuse it here is
    // sharper: a zero secret is almost always an uninitialised variable that reached this far.
    throw new Error('a position secret must be a positive felt')
  }
  if (value >= STARK_PRIME) {
    throw new Error('a position secret must be below the Stark field prime, or it is silently reduced')
  }
  return hash.computePoseidonHashOnElements([value])
}

/**
 * Mint a fresh position secret.
 *
 * 248 bits from the platform CSPRNG, which is comfortably below the field prime — so no rejection
 * sampling loop, and no chance of the reduction this module refuses elsewhere. `globalThis.crypto`
 * rather than a Node import because this runs in a browser, and
 * `getRandomValues` is what both environments have had for years.
 */
export function mintPositionSecret(): PositionSecret {
  const bytes = new Uint8Array(31)
  globalThis.crypto.getRandomValues(bytes)
  let value = 0n
  for (const b of bytes) value = (value << 8n) | BigInt(b)
  // 31 bytes can still be zero, with probability 2^-248. Cheaper to handle than to argue about.
  if (value === 0n) value = 1n
  const secret = `0x${value.toString(16)}`
  return { secret, commitment: commitmentFor(secret) }
}
