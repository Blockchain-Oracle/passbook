//
// The directory's SHAPE, with nothing attached to it. `directory.ts` signs and verifies, which
// needs `starknet` for the curve and Poseidon; a form that greys out a button while somebody types
// an invalid handle must not drag that into its chunk. THIS FILE MUST IMPORT NOTHING.
//
// `directory.ts` re-exports every name below, so no existing caller changes.
//

/** Lowercase handle, 3–20 of [a-z0-9_-]. Enforced on BOTH sides; normalize before testing. */
export const DIRECTORY_NAME_PATTERN = /^[a-z0-9_-]{3,20}$/

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
