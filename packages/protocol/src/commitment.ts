//
// Bearer commitments: the secret a position is claimed with, and the hash the chain stores.
//
// ── WHY THIS IS A SEPARATE MODULE FROM THE CALLDATA BUILDERS ──────────────────────────────
//
// `market-calldata.ts` and `launch-calldata.ts` are pure string arithmetic and a markets surface
// imports them eagerly. This file reaches `starknet.js` for Poseidon, and the build gate bans that
// graph from every emitted chunk (`build-web.mjs`'s `APP_FORBIDDEN_IN_CHUNK`). So the split is not
// tidiness — an eager import of this file fails the build.
//
// What that means in practice: a commitment is computed ONCE, at the moment a position is created,
// inside the lazy send graph, and stored alongside its secret. Everything that merely READS
// positions — the markets list, the claim panel, the wallet — reads a commitment that was already
// hashed and never needs Poseidon at all.
//
// ── THE HASH HAS TO MATCH THE CONTRACT EXACTLY ────────────────────────────────────────────
//
// `markets.cairo` and `launch.cairo` both key positions by `poseidon_hash_span(array![secret].span())`
// and look them up by re-hashing the secret a claim reveals. If this function and that one ever
// disagree, every claim reverts `POSITION_NOT_OPEN` and the position is unspendable — the money is
// simply gone, with no error anyone could act on.
//
// They agree, and it is checked rather than assumed: `commitment.test.ts` pins two vectors that
// were computed by BOTH implementations and compared. See its header for the exact procedure.
//
// ── A SECRET IS BEARER MONEY ──────────────────────────────────────────────────────────────
//
// Whoever holds the secret holds the position. There is no address on it, no recovery, and no
// second copy anywhere — losing it is exactly as bad as losing a note. `session-position-store.ts`
// is what makes it survive a reload, and it rides the same backup surface note material does.
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
