//
// "Is this destination an address of my own?" Browser-safe: imports only `address.ts`.
//
// The third state is the whole point. A two-state answer is a lie whenever the set of known
// own-addresses is empty — "no match" then reads as "we checked and you are fine", and we did not
// check. The surface renders NOTHING for `no-known-addresses` and for `no-match`: not a
// reassurance, not a green tick. Deposit counterparties cannot bootstrap the set (a public event
// proves whose address it is, not that the user is us), and an unparseable destination is a
// correct negative, not an error — the user is mid-typing more often than they are wrong.
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
