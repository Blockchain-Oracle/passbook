//
// The name directory's shared half — what both sides of the claim must agree on byte-for-byte.
//
// ── WHAT A CLAIM IS ──────────────────────────────────────────────────────────────────────
//
// A name is worth exactly as much as the proof that its holder controls the address it points
// at; a directory without that proof is a squatting service. The proof here is the one key the
// protocol already anchors on-chain: registration writes the VIEWING key's public x where anyone
// can read it (`get_public_key`), so a claim signed by the viewing key is checkable by the
// relayer against the chain with one free view call — no account signatures, no SNIP-12
// machinery, no session keys. The signature covers H(name, address), so a captured claim cannot
// be replayed to point the same name at a different address, nor a different name at this one.
//
// ── WHAT PUBLISHING MEANS, because the UI must say it before anyone claims ───────────────
//
// The directory is PUBLIC BY CONSTRUCTION. Claiming writes name → address where any client can
// fetch it — that is its entire function. The privacy stance is not "the directory is private";
// it is (a) claiming is opt-in, (b) SEARCH is private: clients fetch the whole (small) directory
// and match locally, so the relayer never learns who anyone looked for.
//
import { ec, hash, shortString } from 'starknet'

//
// THE PURE HALF LIVES IN `directory-name.ts` AND IS RE-EXPORTED HERE.
//
// The pattern, the normalizer and the wire types have no crypto edge, and a caller that only
// wants to validate a handle as somebody types it must not pull `starknet` in to do it. The
// split is `activity-entry.ts`'s, for its reason; the re-export is what keeps every existing
// import of this module working unchanged.
//
export {
  AVATAR_PATTERN,
  DIRECTORY_NAME_PATTERN,
  MAX_AVATAR_CHARS,
  normalizeDirectoryName,
  type ClaimSignature,
  type DirectoryClaimRequest,
  type DirectoryEntry,
} from './directory-name.js'

import type { ClaimSignature } from './directory-name.js'

/** The one hash both sides sign and verify: Poseidon over (name-as-short-string, address). */
export function claimMessageHash(name: string, address: string): bigint {
  return BigInt(
    hash.computePoseidonHashOnElements([shortString.encodeShortString(name), BigInt(address)]),
  )
}

/** Sign a claim with the viewing key — the key registration anchored on-chain. */
export function signClaim(name: string, address: string, viewingKey: bigint): ClaimSignature {
  const digest = claimMessageHash(name, address)
  const signature = ec.starkCurve.sign(
    `0x${digest.toString(16)}`,
    `0x${viewingKey.toString(16)}`,
  )
  return { r: `0x${signature.r.toString(16)}`, s: `0x${signature.s.toString(16)}` }
}

/**
 * Verify a claim against the x-only public key the pool stores.
 *
 * `get_public_key` returns only the x-coordinate, which names two curve points. Trying both
 * parities is correct, not sloppy: the signer holds the private key for exactly one of them,
 * and a signature that verifies against either proves control of the x the chain anchors.
 */
export function verifyClaim(
  name: string,
  address: string,
  signature: ClaimSignature,
  publicKeyX: bigint,
): boolean {
  let digest: bigint
  try {
    digest = claimMessageHash(name, address)
  } catch {
    return false
  }
  const digestHex = `0x${digest.toString(16)}`
  const x = publicKeyX.toString(16).padStart(64, '0')
  for (const parity of ['02', '03'] as const) {
    try {
      const point = ec.starkCurve.ProjectivePoint.fromHex(`${parity}${x}`)
      if (
        ec.starkCurve.verify(
          new ec.starkCurve.Signature(BigInt(signature.r), BigInt(signature.s)),
          digestHex,
          point.toHex(),
        )
      ) {
        return true
      }
    } catch {
      // An x with no point at this parity, or a malformed signature — try the other, then fail.
    }
  }
  return false
}

// ── Wire shapes ──────────────────────────────────────────────────────────────────────────

