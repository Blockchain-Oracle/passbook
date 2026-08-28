//
// The directory's SHAPE, with nothing attached to it.
//
// ── WHY THIS IS A SEPARATE FILE FROM `directory.ts` ──────────────────────────────────────
//
// `directory.ts` signs and verifies, and doing either needs `starknet` for the curve and the
// Poseidon hash. That import is correct for a signer and fatal for a form: a settings panel that
// wants to grey out a button while somebody types an invalid handle has no business dragging the
// crypto graph into its chunk.
//
// The build gate found this rather than a reviewer. `NameClaim.tsx` imported the pattern
// statically and `signClaim` dynamically, from the same module — so the dynamic import moved
// nothing and the whole SDK edge came along anyway. Rolldown named it exactly:
// `INEFFECTIVE_DYNAMIC_IMPORT`, and `build:web` refused the build.
//
// This is the fourth time the codebase has taken this split: `activity-entry.ts` out of
// `activity.ts`, `pipeline-stage.ts`, `token-scale.ts`. The rule those files record applies here
// too — THIS FILE MUST IMPORT NOTHING. An import here is a regression that compiles clean, and
// only the warning gate would eventually say so.
//
// `directory.ts` re-exports every name below, so no existing caller changes.
//

/** Lowercase handle, 3–20 of [a-z0-9_]. Enforced on BOTH sides; normalize before testing. */
export const DIRECTORY_NAME_PATTERN = /^[a-z0-9_]{3,20}$/

export function normalizeDirectoryName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** The signature over `H(name, address)`, as it travels. */
export interface ClaimSignature {
  readonly r: string
  readonly s: string
}

export interface DirectoryClaimRequest {
  readonly name: string
  readonly address: string
  readonly signature: ClaimSignature
  /** Optional profile picture as a size-capped image data URI; absence is the identicon. */
  readonly avatar?: string
}

export interface DirectoryEntry {
  readonly name: string
  readonly address: string
  /** The list is deliberately lean — avatars are fetched per-address, not shipped in bulk. */
  readonly hasAvatar: boolean
  /**
   * The X handle this entry arrived through, when it did — the relayer's own attestation that
   * the claim came in over a live X OAuth session (the `/api/x/link` leg), never a field a
   * client can assert about itself. Absent on every claim made without X.
   */
  readonly xHandle?: string
}

/**
 * `data:image/(png|jpeg|webp);base64,…` and nothing else.
 *
 * A `data:` URI rather than any URL is the security property, not a storage preference: an
 * `<img src>` pointing at a third-party host would report to that host every time anybody opened
 * a conversation with this peer, which is a tracking beacon somebody else gets to install by
 * claiming a name.
 */
export const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/

/**
 * ~9 kB of image — a 96px avatar, not a photo library.
 *
 * The relayer enforces it; the client downscales before ever hitting the cap.
 */
export const MAX_AVATAR_CHARS = 12_000
