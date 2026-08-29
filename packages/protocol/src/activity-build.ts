//
// Building the record: personal keys from a discovered registry, and events into entries.
//
// A note id is `compute_note_id(channelKey, token, index)` and a nullifier is
// `compute_nullifier(channelKey, token, index, viewingKey)`. Both are pure, so every id and every
// nullifier this account has ever produced is recomputable in the session, SPENT ONES INCLUDED —
// which is what turns a public `NoteUsed` stream into "you spent this". Events ANNOTATE a registry
// that discovery already built; they never build one.
//
// The two hashes are the SDK's own (pool consensus rules), imported and never reimplemented. The
// registry arrives as a structural type so this module does not reach `discovery.ts`.
//

import { compute_note_id, compute_nullifier } from '@starkware-libs/starknet-privacy-sdk/testing'
import { decodePoolEvent, packedNoteValue, type DecodedPoolEvent, type RawPoolEvent } from './pool-events.js'
import { FEE_NOT_READ, noteKey, type ActivityEntry, type ActivityFee } from './activity-entry.js'

/** The slice of a discovered registry this module reads. `DiscoveredRegistry` satisfies it. */
export interface PersonalRegistry {
  readonly incoming: readonly {
    readonly counterparty: string
    readonly channelKey: bigint
    readonly noteSlots: readonly { readonly token: string; readonly nextIndex: number }[]
  }[]
}

/** One note slot we can recognise: everything needed to identify it and say what it was. */
export interface PersonalNoteRef {
  noteId: bigint
  nullifier: bigint
  token: string
  index: number
  counterparty: string
}

/** Every note id and nullifier this account can produce, keyed by decimal string (unambiguous everywhere). */
export interface PersonalKeys {
  byNoteId: Map<string, PersonalNoteRef>
  byNullifier: Map<string, PersonalNoteRef>
}

/**
 * The most note slots one registry may ask this module to recompute. A hang guard: one slot is
 * two curve-grade hashes (~1ms), so this is ~5 s of blocking work in the worst case.
 */
export const MAX_RECOMPUTABLE_NOTE_SLOTS = 5_000

/** A felt as `0x` hex. */
const toFeltHex = (value: bigint): string => `0x${value.toString(16)}`

/**
 * Recomputes every historical note id and nullifier from a discovered registry. Walks
 * `0 <= index < nextIndex` per token per incoming channel — spent notes as well as held ones.
 */
export function personalKeysFrom(registry: PersonalRegistry, viewingKey: bigint): PersonalKeys {
  const byNoteId = new Map<string, PersonalNoteRef>()
  const byNullifier = new Map<string, PersonalNoteRef>()

  // Counted in full BEFORE a single hash is taken, so an over-cap registry fails in microseconds.
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
 * Turns decoded pool events into the record. PURE — fees arrive as data. Rows come out
 * newest-first with a total, stable order (block desc, hash, ordinal).
 */
export function buildActivity(
  events: readonly RawPoolEvent[],
  options: BuildActivityOptions = {},
): ActivityEntry[] {
  assertWholeTransactions(events)

  // Normalized ONCE at the boundary: callers key amounts by hex, padded hex or decimal.
  const amountsByNoteId = new Map<string, bigint>()
  for (const [id, amount] of options.amountsByNoteId ?? []) amountsByNoteId.set(noteKey(id), amount)

  const ordinalByTransaction = new Map<string, number>()
  const entries: ActivityEntry[] = []

  for (const raw of events) {
    // Counted BEFORE decodability, so ids do not shift when a new event type is learned.
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
      // NUMERIC, not the composed id string: `'0xtx-10' < '0xtx-2'` lexicographically.
      a.ordinal - b.ordinal,
  )
  return entries
}

/**
 * Refuses an event stream whose transactions are interleaved or split — pages concatenated out
 * of order would give ordinals a correct merge does not.
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
      // A public address puts money in; `mine` is decided by `markOwnAddress`, not here.
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
        // An open note publishes its amount; an encrypted one we hold gets the discovered amount;
        // one we spent stays `null` rather than becoming a zero.
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
        // The nullifier is the ONLY thing a spend publishes; the rest comes from recognising it.
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
