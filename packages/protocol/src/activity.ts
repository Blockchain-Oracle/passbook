//
// The record — one activity model for every surface (FR-011a / AD-14, story 1.9 AC3).
//
// ONE union, not two feeds. Global and Personal are the same rows with a different filter, and
// building them separately is how the two drift into disagreeing about the same transaction.
// A row's `mine` field is what a tab selects on, and it is computed rather than fetched: a
// note is ours when its id is one we can recompute from a channel we hold.
//
// ── WHY THE PERSONAL FEED NEEDS NOTHING PERSISTED ────────────────────────────────────────
//
// A note id is `compute_note_id(channelKey, token, index)` and a nullifier is
// `compute_nullifier(channelKey, token, index, viewingKey)`. Both are pure. The discovery walk
// hands back, per incoming channel, the channel key and the exclusive upper bound of indices it
// reached — so every id and every nullifier this account has ever produced is recomputable in
// the session, SPENT ONES INCLUDED. That is the whole trick: the walk returns only unspent
// notes, but the spent ones' nullifiers are still derivable, which is what turns a public
// `NoteUsed` stream into "you spent this".
//
// It also runs the right way round. An `EncNoteCreated` cannot be recognised as yours before
// its channel is decrypted — that was rejected upstream and is rejected here (discovery-service
// spec 13). Events ANNOTATE a registry that discovery already built; they never build one.
//
// ── THE FEE IS THE RECEIPT'S, NEVER THE POOL'S ───────────────────────────────────────────
//
// `register.ts`'s `FeeRow` carries `get_fee_amount()` — what the POOL charged for
// `apply_actions`. That is not what a transaction cost: the sequencer charged gas on top, and
// on a relayed submission the two were paid by different parties. A statement row saying "fee"
// has to mean the money that actually left, so it comes from the receipt's `actual_fee` and
// from nowhere else. When the receipt cannot be fetched the field says so — see `ActivityFee`.
//

import { compute_note_id, compute_nullifier, toFeltHex, type DiscoveredRegistry } from './discovery.js'
import {
  decodePoolEvent,
  packedNoteValue,
  type DecodedPoolEvent,
  type RawPoolEvent,
} from './pool-events.js'
import {
  FEE_NOT_READ,
  noteKey,
  type ActivityEntry,
  type ActivityFee,
  type ActivityKind,
} from './activity-entry.js'

//
// ── THE SHAPE MOVED; THE NAMES DID NOT ───────────────────────────────────────────────────
//
// `activity-entry.ts` holds the record's types and its three pure operations, because a feed
// needs them and this module cannot be imported by a browser: the two imports above reach the
// privacy SDK and `starknet` respectively. Everything that used to be declared here is
// re-exported below, so `import { ActivityEntry } from './activity.js'` still resolves and no
// existing caller had to change. Precedent: `send.ts:86` re-exports `SendStage` from
// `pipeline-stage.ts` for exactly this reason.
//
export type {
  ActivityBase,
  ActivityEntry,
  ActivityFee,
  ActivityKind,
} from './activity-entry.js'
export { FEE_NOT_READ, noteKey, personalEntries, entryById } from './activity-entry.js'

//
// ── AND THE ONE THING THE SPLIT COST, PAID FOR HERE ──────────────────────────────────────
//
// `ActivityKind` used to be `DecodedPoolEvent['kind']`, which made drift structurally impossible.
// The leaf cannot say that — naming `DecodedPoolEvent` is naming `pool-events.js`, which is the
// import the split exists to remove — so it writes the seven members out, and the coupling is
// asserted here instead, where both types are already in scope.
//
// BOTH DIRECTIONS, because each catches a different mistake. A new decoder with no member in the
// leaf fails the first (the feed would silently have no row grammar for it); a member in the leaf
// that no decoder can produce fails the second (dead branches in every switch downstream). This
// costs nothing at runtime — it is two type aliases — and it is TS2344 the moment either drifts.
//
type Assert<T extends true> = T
type Ext<A, B> = A extends B ? true : false

/** Every event the decoders produce has a row kind. */
export type EveryDecodedEventHasAKind = Assert<Ext<DecodedPoolEvent['kind'], ActivityKind>>

/** And no row kind exists that no decoder can produce. */
export type EveryKindComesFromADecoder = Assert<Ext<ActivityKind, DecodedPoolEvent['kind']>>

/**
 * Reads `actual_fee` off a receipt, in either shape the RPC has used.
 *
 * Promoted out of `scripts/bank-sponsored-registration.ts`, where it was the one decode in the
 * cost-banking pipeline that nothing could unit-test. Starknet types 0.10.x specify
 * `{amount, unit}`; older nodes and some proxies still answer a bare felt, which carries no
 * unit at all. Both are real and both arrive here.
 *
 * A receipt that carries no readable fee returns the `unknown` variant rather than throwing:
 * this runs per row over a page of history, and one odd receipt must cost that row its fee
 * field, not the whole feed.
 */
export function actualFeeWei(receipt: unknown): ActivityFee {
  const fee = (receipt as { actual_fee?: unknown } | null | undefined)?.actual_fee
  if (isFeltish(fee)) {
    try {
      // A bare felt carries no unit. Every fee on this network is charged in FRI today, but
      // "today" is not a field value — the unit is recorded as unknown because the receipt
      // genuinely did not say, and a statement column that guesses its own units is a bug.
      return { state: 'charged', amountWei: BigInt(fee), unit: 'unknown' }
    } catch {
      return { state: 'unknown', reason: `actual_fee was not a number: ${JSON.stringify(String(fee).slice(0, 64))}` }
    }
  }
  const shaped = fee as { amount?: unknown; unit?: unknown } | null | undefined
  if (shaped?.amount === undefined || shaped.amount === null) {
    return { state: 'unknown', reason: 'the receipt carried no readable actual_fee' }
  }
  // TYPE-CHECKED BEFORE CONVERSION, because `BigInt` is more accommodating than a fee column
  // can afford: `BigInt(true)` is `1n`, so a boolean `amount` — the shape a JSON field takes
  // when something upstream serialized a flag into it — would become a confident fee of one
  // wei rather than an unknown. Objects and arrays throw and would be caught below, but the
  // boolean would not, and a silently plausible number is the worst of the three outcomes.
  if (!isFeltish(shaped.amount)) {
    return {
      state: 'unknown',
      reason: `actual_fee.amount was a ${typeof shaped.amount}, which is not a number`,
    }
  }
  try {
    return {
      state: 'charged',
      amountWei: BigInt(shaped.amount),
      unit: shaped.unit === 'FRI' || shaped.unit === 'WEI' ? shaped.unit : 'unknown',
    }
  } catch {
    return {
      state: 'unknown',
      reason: `actual_fee.amount was not a number: ${JSON.stringify(String(shaped.amount).slice(0, 64))}`,
    }
  }
}

/** The three JS types that can legitimately carry a felt. Notably NOT boolean — see above. */
function isFeltish(value: unknown): value is string | number | bigint {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
}

/** One note slot we can recognise: everything needed to identify it and say what it was. */
export interface PersonalNoteRef {
  noteId: bigint
  nullifier: bigint
  token: string
  index: number
  counterparty: string
}

/**
 * Every note id and nullifier this account can produce, keyed for lookup.
 *
 * Built per session from the registry and thrown away with it. Keys are decimal strings
 * rather than bigints because a `Map<bigint, …>` compares by identity for boxed values in
 * some engines and by value in others; the string is unambiguous everywhere.
 */
export interface PersonalKeys {
  byNoteId: Map<string, PersonalNoteRef>
  byNullifier: Map<string, PersonalNoteRef>
}

/**
 * The most note slots one registry may ask this module to recompute.
 *
 * A hang guard, not a protocol limit, and the number is measured rather than picked. One slot
 * is `compute_note_id` plus `compute_nullifier` — two curve-grade hashes — which benchmarks at
 * about 1ms in this SDK on ordinary hardware. So this cap is roughly five seconds of blocking
 * work in the worst case, which is the most a session can spend without the tab appearing to
 * hang, and it still sits two orders of magnitude above any real account's note count.
 *
 * Raising it is a decision about how long a user may be frozen, not a formality: at 50,000 the
 * same loop is the better part of a minute with no yield.
 */
export const MAX_RECOMPUTABLE_NOTE_SLOTS = 5_000

/**
 * Recomputes every historical note id and nullifier from a discovered registry.
 *
 * Walks `0 <= index < nextIndex` for each token of each incoming channel, which covers spent
 * notes as well as held ones — `nextIndex` is where the walk stopped finding notes, not where
 * it stopped finding UNSPENT ones.
 *
 * The viewing key is needed for the nullifier and not for the id, which is exactly why a
 * nullifier proves ownership and a note id does not: ids are public in `EncNoteCreated`.
 */
export function personalKeysFrom(registry: DiscoveredRegistry, viewingKey: bigint): PersonalKeys {
  const byNoteId = new Map<string, PersonalNoteRef>()
  const byNullifier = new Map<string, PersonalNoteRef>()

  // COUNTED IN FULL BEFORE A SINGLE HASH IS TAKEN. Checking the budget incrementally, inside
  // the walk, is the version that looks careful and is not: a registry sized just under the cap
  // still pays the whole budget in curve-grade hashing before anything refuses, so the guard
  // fires only after the delay it exists to prevent. Summing first makes an over-cap registry
  // fail in microseconds.
  //
  // `nextIndex` is not ours — it comes from the SDK's walk over pool storage — and each slot
  // costs two hashes with no yield, so a `nextIndex` of a few million is a browser tab that
  // stops responding rather than an error anyone can see. The cap is a hang guard and not a
  // protocol limit: it sits far above any real account, and reaching it means something is
  // wrong with the walk, which is worth saying out loud.
  let slots = 0
  for (const channel of registry.incoming) {
    for (const slot of channel.noteSlots) {
      if (!Number.isInteger(slot.nextIndex) || slot.nextIndex < 0) {
        throw new Error(
          `the registry reported a nonsensical note index for token ${slot.token}: ${String(slot.nextIndex)}`,
        )
      }
      slots += slot.nextIndex
    }
  }
  if (slots > MAX_RECOMPUTABLE_NOTE_SLOTS) {
    throw new Error(
      `this registry claims ${slots} note slots, more than the ${MAX_RECOMPUTABLE_NOTE_SLOTS} ` +
        'any real account holds — refusing to recompute rather than hanging the session.',
    )
  }

  for (const channel of registry.incoming) {
    for (const slot of channel.noteSlots) {
      const token = BigInt(slot.token)
      for (let index = 0; index < slot.nextIndex; index++) {
        const ref: PersonalNoteRef = {
          noteId: compute_note_id(channel.channelKey, token, index),
          nullifier: compute_nullifier(channel.channelKey, token, index, viewingKey),
          token: slot.token,
          index,
          counterparty: channel.counterparty,
        }
        byNoteId.set(noteKey(ref.noteId), ref)
        byNullifier.set(noteKey(ref.nullifier), ref)
      }
    }
  }
  return { byNoteId, byNullifier }
}

/** What `buildActivity` may be told, beyond the events themselves. */
export interface BuildActivityOptions {
  /** Absent means every row is Global — `mine` is `false` everywhere, never guessed. */
  personal?: PersonalKeys
  /** Amounts for notes we hold, keyed by note id, so a matched row can show its value. */
  amountsByNoteId?: Map<string, bigint>
  /** Fees by transaction hash. A hash with no entry gets `FEE_NOT_READ`, never a zero. */
  feesByTransaction?: Map<string, ActivityFee>
}

/**
 * Turns decoded pool events into the record.
 *
 * PURE, and takes its fees as data rather than fetching them. A builder that fetched receipts
 * would be a builder no test could run over an interesting history, and the fetch is the part
 * that has nothing to decide.
 *
 * Rows come out newest-first, because that is the only order a feed is ever read in, and ties
 * within a block break on transaction hash then ordinal so the order is total and stable —
 * two rows from the same block must not swap places between two renders of the same data.
 */
export function buildActivity(
  events: readonly RawPoolEvent[],
  options: BuildActivityOptions = {},
): ActivityEntry[] {
  assertWholeTransactions(events)

  // Normalized ONCE, at the boundary, rather than at each lookup: the caller may key their
  // amounts by hex, by a padded hex, or by the decimal a bigint stringifies to, and a map
  // keyed one way silently misses every lookup spelled another.
  const amountsByNoteId = new Map<string, bigint>()
  for (const [id, amount] of options.amountsByNoteId ?? []) amountsByNoteId.set(noteKey(id), amount)

  const ordinalByTransaction = new Map<string, number>()
  const entries: ActivityEntry[] = []

  for (const raw of events) {
    // COUNTED BEFORE DECODABILITY IS CONSIDERED. Skipping undecodable events here would make
    // every id after them shift the day this build learns one more event type.
    const ordinal = ordinalByTransaction.get(raw.transactionHash) ?? 0
    ordinalByTransaction.set(raw.transactionHash, ordinal + 1)

    const decoded = decodePoolEvent(raw)
    if (decoded === null) continue // a pool event this story has no row for
    entries.push(toEntry(decoded, raw, ordinal, { ...options, amountsByNoteId }))
  }

  entries.sort(
    (a, b) =>
      b.blockNumber - a.blockNumber ||
      a.transactionHash.localeCompare(b.transactionHash) ||
      // NUMERIC, not the composed id string. `'0xtx-10' < '0xtx-2'` lexicographically, so the
      // tenth event of an `apply_actions` would sort above the second — and a batch emitting
      // ten decodable events is an ordinary send with change notes, not a corner case.
      a.ordinal - b.ordinal,
  )
  return entries
}

/**
 * Refuses an event stream whose transactions are interleaved or split.
 *
 * The detectable half of the id-stability contract. A well-formed `getEvents` stream is ordered
 * by block and then by transaction, so one transaction's events are contiguous; a hash that
 * reappears after a different hash means pages were concatenated out of order, or merged
 * wrongly, and the ordinals this builder assigns would not match the ones a correct merge
 * produces. The undetectable half — a transaction whose tail is simply missing because the
 * caller built from one page — is why the contract is also written on `ActivityBase.id`.
 */
export function assertWholeTransactions(events: readonly RawPoolEvent[]): void {
  const closed = new Set<string>()
  let current: string | undefined
  for (const event of events) {
    if (event.transactionHash === current) continue
    if (closed.has(event.transactionHash)) {
      throw new Error(
        `transaction ${event.transactionHash} appears in two separate runs of this event ` +
          'stream. buildActivity needs whole transactions in order — merge your pages before ' +
          'building, or entry ids will not be stable.',
      )
    }
    if (current !== undefined) closed.add(current)
    current = event.transactionHash
  }
}

function toEntry(
  decoded: DecodedPoolEvent,
  raw: RawPoolEvent,
  ordinal: number,
  options: BuildActivityOptions,
): ActivityEntry {
  const base = {
    id: `${raw.transactionHash}-${ordinal}`,
    ordinal,
    blockNumber: raw.blockNumber,
    transactionHash: raw.transactionHash,
    fee: options.feesByTransaction?.get(raw.transactionHash) ?? FEE_NOT_READ,
    mine: false,
    token: null as string | null,
    amount: null as bigint | null,
    counterparty: null as string | null,
    noteCommitment: null as string | null,
  }

  switch (decoded.kind) {
    case 'deposit':
      // A deposit names a PUBLIC address putting money in, so `mine` cannot be decided from
      // the note registry here. It is left false and the caller that knows its own address
      // decides — see `markOwnAddress`.
      return { ...base, kind: 'deposit', token: toFeltHex(decoded.token), amount: decoded.amount, counterparty: toFeltHex(decoded.user) }

    case 'withdrawal':
      return { ...base, kind: 'withdrawal', token: toFeltHex(decoded.token), amount: decoded.amount, counterparty: toFeltHex(decoded.to) }

    case 'note-created': {
      const ref = options.personal?.byNoteId.get(noteKey(decoded.noteId))
      const packed = packedNoteValue(decoded.packedValue)
      return {
        ...base,
        kind: 'note-created',
        open: packed.open,
        mine: ref !== undefined,
        noteCommitment: toFeltHex(decoded.noteId),
        token: ref?.token ?? null,
        // An open note publishes its amount; an encrypted one publishes nothing. When the
        // note is ours and we hold it, the discovered amount fills the gap — and when we
        // spent it, it stays `null` rather than becoming a zero.
        amount: packed.amount ?? options.amountsByNoteId?.get(noteKey(decoded.noteId)) ?? null,
        counterparty: ref?.counterparty ?? null,
      }
    }

    case 'note-spent': {
      const ref = options.personal?.byNullifier.get(noteKey(decoded.nullifier))
      return {
        ...base,
        kind: 'note-spent',
        nullifier: toFeltHex(decoded.nullifier),
        mine: ref !== undefined,
        // The nullifier is the ONLY thing a spend publishes. Everything else on this row
        // comes from recognising it, and stays null when we did not.
        noteCommitment: ref === undefined ? null : toFeltHex(ref.noteId),
        token: ref?.token ?? null,
        amount: ref === undefined ? null : (options.amountsByNoteId?.get(noteKey(ref.noteId)) ?? null),
        counterparty: ref?.counterparty ?? null,
      }
    }

    case 'open-note-created':
      return { ...base, kind: 'open-note-created', token: toFeltHex(decoded.token), noteCommitment: toFeltHex(decoded.noteId) }

    case 'open-note-deposited':
      return {
        ...base,
        kind: 'open-note-deposited',
        token: toFeltHex(decoded.token),
        amount: decoded.amount,
        counterparty: toFeltHex(decoded.depositor),
        noteCommitment: toFeltHex(decoded.noteId),
      }

    case 'registration':
      return { ...base, kind: 'registration', publicKey: toFeltHex(decoded.publicKey), counterparty: toFeltHex(decoded.user) }
  }
}

/**
 * Marks the rows that name a public address of ours — deposits, withdrawals and registration.
 *
 * SEPARATE FROM THE NOTE MATCHING, because it is a different kind of knowledge. Note rows are
 * ours because we can recompute their ids, which is cryptographic. These rows are ours because
 * a public address in the event equals an address we are looking at, which is a comparison
 * anyone could make — including anyone watching. Fusing the two would let a Personal feed imply
 * that the address rows are as unlinkable as the note rows, and they are not.
 */
export function markOwnAddress(entries: readonly ActivityEntry[], address: string): ActivityEntry[] {
  // THE ADDRESS IS REFUSED UP FRONT, the rows are not. A caller handing this a malformed address
  // has a bug worth surfacing — every row would be mismarked — so that throws. A malformed
  // COUNTERPARTY is different: it is one bad row inside a page of real history, and taking the
  // whole feed down because one event carried something unparseable is the wrong trade. That
  // row simply cannot be shown to be ours, which is the honest answer for it.
  let self: bigint
  try {
    self = BigInt(address)
  } catch {
    throw new Error(`not an address: ${JSON.stringify(String(address).slice(0, 64))}`)
  }
  return entries.map((entry) => {
    if (entry.mine) return entry
    const names =
      entry.kind === 'deposit' || entry.kind === 'withdrawal' || entry.kind === 'registration'
    if (!names || entry.counterparty === null) return entry
    try {
      return BigInt(entry.counterparty) === self ? { ...entry, mine: true } : entry
    } catch {
      return entry
    }
  })
}

