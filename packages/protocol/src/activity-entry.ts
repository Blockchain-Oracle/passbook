//
// The record's SHAPE, with nothing attached to it (story 6.6).
//
// ── WHY THIS IS A SEPARATE FILE FROM `activity.ts` ────────────────────────────────────────
//
// `activity.ts` builds the record, and building it needs the chain: it imports `discovery.js` for
// `compute_note_id` / `compute_nullifier` (the privacy SDK) and `pool-events.js` for the decoders
// (which reaches `starknet` for `starknetKeccak`, and `rpc.js` for the bounded read). Every one of
// those is correct for a builder and fatal for a renderer — measured on this exact bundler in 6.4
// and again in 6.5, where importing one chain-touching module put 227-268 kB of curve arithmetic
// into a browser that wanted a string.
//
// But a FEED does not build the record. It reads one someone else built, filters it two ways and
// looks a row up by id — three pure array operations that had no way to reach the browser because
// they lived beside the SDK import. So the types and the pure half move here, `activity.ts`
// re-exports every name it used to own, and no existing caller changes.
//
// This is the third time: `pipeline-stage.ts` (6.5) and `token-scale.ts` (6.4) are the same split
// for the same reason. THIS FILE MUST IMPORT NOTHING. An import here is a 268 kB regression that
// compiles clean, and `scripts/build-web.mjs` is what would eventually say so.
//

/**
 * What a transaction actually cost, or an honest refusal to say.
 *
 * THERE IS NO ZERO IN THIS TYPE BY ACCIDENT. A missing receipt and a genuinely free action are
 * different facts, and the `unknown` variant exists so the second can never be manufactured out
 * of the first. A statement handed to a bookkeeper with a fabricated 0 in the fee column is
 * worse than one with a blank.
 */
export type ActivityFee =
  | {
      state: 'charged'
      /** In the unit's smallest denomination. `FRI` is STRK-wei; `WEI` is ETH-wei. */
      amountWei: bigint
      unit: 'FRI' | 'WEI' | 'unknown'
    }
  | { state: 'unknown'; reason: string }

/** The fee value for a row whose receipt we never got. Shared so the reason cannot drift. */
export const FEE_NOT_READ: ActivityFee = {
  state: 'unknown',
  reason: 'the receipt for this transaction was not read',
}

/**
 * Every kind of row the record holds. One per decodable pool event.
 *
 * WRITTEN OUT RATHER THAN DERIVED, and that is the one thing this split costs. It used to be
 * `DecodedPoolEvent['kind']`, which cannot follow the types here — `pool-events.ts` is exactly
 * what this file exists not to import. So `activity.ts` carries a two-directional compile-time
 * assertion that these seven members are still precisely the decoder's seven. Adding an event
 * type without adding it here is TS2344 there, which is the loud version of the drift a derived
 * type prevented for free.
 */
export type ActivityKind =
  | 'deposit'
  | 'withdrawal'
  | 'note-created'
  | 'note-spent'
  | 'open-note-created'
  | 'open-note-deposited'
  | 'registration'

/** What every row carries, whatever kind it is. */
export interface ActivityBase {
  /**
   * The addressable id — what `/activity/<id>` resolves.
   *
   * `<transactionHash>-<ordinal>`, where the ordinal is the row's position among ALL pool
   * events of that transaction. One `apply_actions` emits several events, so the hash alone is
   * not unique.
   *
   * ── THE ID-STABILITY CONTRACT, WHICH CALLERS HAVE TO HOLD UP ────────────────────────────
   *
   * A bookmarked `/activity/<id>` has to resolve to the same row next week, so the ordinal is
   * counted over EVERY event the transaction emitted, decodable or not. Counting only the rows
   * this build knows how to render would mean that teaching it one more event type silently
   * renumbers every row after it in that transaction — every bookmark, every link, every
   * reference in a support thread, pointing at its neighbour.
   *
   * The other half is the caller's: `buildActivity` must be given WHOLE TRANSACTIONS. Feeding
   * it one page at a time restarts ordinals at each page boundary, so a transaction split
   * across two pages produces two rows with the same id. Merge pages first; `buildActivity`
   * refuses input where a transaction's events are not contiguous, which is the detectable
   * half of that mistake.
   */
  id: string
  /** The row's position among all events of its transaction. The numeric half of `id`. */
  ordinal: number
  blockNumber: number
  transactionHash: string
  /** True when this row belongs to the account whose registry built the feed. */
  mine: boolean
  /** What actually left the wallet for this transaction. Per transaction, not per row. */
  fee: ActivityFee
  /** The token this row moved, when the event names one. */
  token: string | null
  /**
   * The exact amount, or `null` when the chain did not publish one in a form we can read.
   *
   * `null` is load-bearing on `note-created`: an encrypted note's amount is ciphertext to
   * everyone but its owner, so a Global feed shows the row and not the number. For a row that
   * is `mine`, the amount is filled in from the discovered note when one matches.
   */
  amount: bigint | null
  /** The other party, when the event names one. Never inferred. */
  counterparty: string | null
  /** The note this row is about, in mono on the detail page. `null` where there is no note. */
  noteCommitment: string | null
}

export type ActivityEntry = ActivityBase & (
  | { kind: 'deposit' }
  | { kind: 'withdrawal' }
  | { kind: 'note-created'; open: boolean }
  | { kind: 'note-spent'; nullifier: string }
  | { kind: 'open-note-created' }
  | { kind: 'open-note-deposited' }
  | { kind: 'registration'; publicKey: string }
)

/**
 * The one spelling a note id is keyed by, for every map in the record.
 *
 * A note id has three faces — `0x2867e2…`, `0x02867e2…` and the decimal a `bigint` stringifies
 * to — and a `Map` keyed by one silently misses all lookups spelled another way. The failure is
 * invisible: rows simply stop matching and the Personal feed quietly empties. So every note-id
 * key goes through here, on the way in AND on the way out, and callers building an
 * `amountsByNoteId` may use whichever spelling they have.
 */
export function noteKey(id: bigint | string | number): string {
  return BigInt(id).toString()
}

