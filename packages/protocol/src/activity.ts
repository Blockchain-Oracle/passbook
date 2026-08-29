//
// The record — one activity model for every surface (FR-011a / AD-14, story 1.9 AC3).
//
// ONE union, not two feeds: Global and Personal are the same rows with a different filter, and a
// row's `mine` is computed — a note is ours when its id recomputes from a channel we hold
// (`activity-build.ts`). The fee is the RECEIPT's `actual_fee`, never the pool's `get_fee_amount()`:
// a statement row saying "fee" has to mean the money that actually left.
//
// The types and pure operations live in `activity-entry.ts` (browser-safe leaf) and are
// re-exported here so `import { ActivityEntry } from './activity.js'` still resolves.
//

import { asAddress, maybeAddress } from './address.js'
import type { DecodedPoolEvent } from './pool-events.js'
import type { ActivityEntry, ActivityKind } from './activity-entry.js'

export type {
  ActivityBase,
  ActivityEntry,
  ActivityFee,
  ActivityKind,
} from './activity-entry.js'
export { FEE_NOT_READ, noteKey } from './activity-entry.js'
export * from './activity-build.js'

// `ActivityKind` is written out in the leaf; the coupling to the decoders is asserted here in
// both directions so neither can drift (TS2344 the moment one does).
type Assert<T extends true> = T
type Ext<A, B> = A extends B ? true : false

/** Every event the decoders produce has a row kind. */
export type EveryDecodedEventHasAKind = Assert<Ext<DecodedPoolEvent['kind'], ActivityKind>>

/** And no row kind exists that no decoder can produce. */
export type EveryKindComesFromADecoder = Assert<Ext<ActivityKind, DecodedPoolEvent['kind']>>

/**
 * Marks the rows that name a public address of ours — deposits, withdrawals and registration.
 *
 * SEPARATE FROM THE NOTE MATCHING: note rows are ours cryptographically; these are ours by a
 * public comparison anyone watching could make. The address is refused up front (`asAddress`
 * throws); a malformed counterparty is one bad row and simply cannot be shown to be ours.
 */
export function markOwnAddress(entries: readonly ActivityEntry[], address: string): ActivityEntry[] {
  const self = asAddress(address)
  return entries.map((entry) => {
    if (entry.mine) return entry
    const names =
      entry.kind === 'deposit' || entry.kind === 'withdrawal' || entry.kind === 'registration'
    if (!names || entry.counterparty === null) return entry
    const other = maybeAddress(entry.counterparty)
    return other !== null && other === self ? { ...entry, mine: true } : entry
  })
}
