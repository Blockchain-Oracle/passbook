//
// "Is this destination an address of my own?" (story 6.7b, C11:142, EXPERIENCE:743).
//
// Imports `address.ts`, a leaf that imports nothing, so this module stays browser-safe. It deliberately does NOT import `activity.ts`, which owns the only other address
// comparison in the package but reaches `discovery.ts` and through it `starknet` and the SDK.
//
// ── THE THIRD STATE IS THE WHOLE POINT ────────────────────────────────────────────────────
//
// A two-state answer — match or no match — is a lie whenever the set of known own-addresses is
// empty, because "no match" then reads as "we checked and you are fine". We did not check. There
// was nothing to check against.
//
// It was, until 2026-08-28, the app's ONLY state: there was no funding wallet accessor anywhere in
// the repository, so the detector shipped permanently in `no-known-addresses`. That paragraph is
// kept in the past tense rather than deleted, because the state it describes is still the common
// one — most sessions never connect a wallet — and the rule it justifies has not moved.
//
// The rail exists now (`apps/web/src/shell/funding-wallet.ts`), and `routes/send.tsx` feeds this
// the connected wallet's address. What has NOT changed: the surface renders NOTHING for
// `no-known-addresses` and nothing for `no-match` — not a reassurance, not a green tick. A visitor
// with no wallet connected is a visitor whose destination nobody checked, and saying "no match"
// there would be a claim about a comparison that never ran.
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

export type SelfLinkResult =
  /** Nothing to compare against. The surface renders nothing — see the header. */
  | { readonly state: 'no-known-addresses' }
  /** Compared, and it is not ours. Includes unparseable and cross-chain destinations. */
  | { readonly state: 'no-match' }
  /** Compared, and it is ours. `matched` is the known address as WE spell it, not as pasted. */
  | { readonly state: 'self-link'; readonly matched: string }

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
