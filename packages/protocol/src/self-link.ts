//
// "Is this destination an address of my own?" (story 6.7b, C11:142, EXPERIENCE:743).
//
// Imports `address.ts` and `privacy.ts`, both leaves that import nothing, so this module stays
// browser-safe. It deliberately does NOT import `activity.ts`, which owns the only other address
// comparison in the package but reaches `discovery.ts` and through it `starknet` and the SDK.
//
// ── THE THIRD STATE IS THE WHOLE POINT ────────────────────────────────────────────────────
//
// A two-state answer — match or no match — is a lie whenever the set of known own-addresses is
// empty, because "no match" then reads as "we checked and you are fine". We did not check. There
// was nothing to check against.
//
// This is not a hypothetical branch: it is the app's CURRENT and ONLY state. There is no funding
// wallet accessor anywhere in the repository (`wallet-capability.ts` is version arithmetic and has
// no production consumer), `markOwnAddress` has zero production callers, and the only stored
// address in the codebase is `identity.ts`'s optional, backup-scoped `receiveAddress`. So the
// detector ships permanently in `no-known-addresses` until a funding rail exists, and the surface
// renders NOTHING for that state — not a reassurance, not a green tick.
//
// ── WHY DEPOSIT COUNTERPARTIES CANNOT BOOTSTRAP THE SET ───────────────────────────────────
//
// It is tempting: a `Deposit` event names `user_addr`, the contract signature-authenticates it
// (`privacy.cairo:207`) and pulls the tokens from that same address (`:494-499`), so the address
// provably belongs to whoever deposited. But that establishes it is THAT USER's address, not that
// the user is US. Nothing in a public event says whose browser is reading it. `markOwnAddress`
// consumes own-address knowledge; it cannot produce it, and neither can this.
//
// ── A DESTINATION WE CANNOT PARSE IS A CORRECT NEGATIVE, NOT AN ERROR ─────────────────────
//
// The I/O matrix names the case: a Solana address pasted into a Starknet field does not match, and
// "does not match" is the right answer rather than a special case or a thrown parse failure. The
// user is mid-typing more often than they are wrong.
//

import { sameAddress } from './address.js'
import type { PrivacySeverity } from './privacy.js'

export type SelfLinkResult =
  /** Nothing to compare against. The surface renders nothing — see the header. */
  | { readonly state: 'no-known-addresses' }
  /** Compared, and it is not ours. Includes unparseable and cross-chain destinations. */
  | { readonly state: 'no-match' }
  /** Compared, and it is ours. `matched` is the known address as WE spell it, not as pasted. */
  | { readonly state: 'self-link'; readonly matched: string }

/**
 * Sending to your own funding wallet republishes the link the pool was used to break, and it is not
 * recoverable after the fact — the ladder's own definition of the top colour.
 *
 * `high`, not `blocked`: `blocked` means the action is refused, and this one never is. The user may
 * always proceed; the product's claim is informed consent, not a wall.
 */
export const SELF_LINK_SEVERITY: PrivacySeverity = 'high'

/**
 * Compare a destination against the addresses the app can PROVE are the user's.
 *
 * `known` is caller-supplied on purpose. This module has no way to discover own-addresses and must
 * not invent one; a caller that cannot supply any passes an empty array and gets the honest answer.
 *
 * The empty check comes FIRST, before the destination is even looked at. Ordering it the other way
 * would let an unparseable destination return `no-match` while the real answer is "we cannot say".
 */
export function selfLinkAgainst(destination: string, known: readonly string[]): SelfLinkResult {
  const usable = known.filter((address) => typeof address === 'string' && address.trim() !== '')
  if (usable.length === 0) return { state: 'no-known-addresses' }

  for (const address of usable) {
    if (sameAddress(destination, address)) return { state: 'self-link', matched: address }
  }
  return { state: 'no-match' }
}
