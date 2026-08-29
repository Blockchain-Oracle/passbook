//
// Pool event decoders — pure functions over `(keys, data)` (AD-14, story 1.9).
//
// Field offsets come from `packages/privacy/src/events.cairo` at the pinned deployed class,
// cross-checked against the upstream indexer's decoder. Cairo splits an event into `keys` and
// `data` by `#[key]`, in declaration order, with `keys[0]` always `starknet_keccak(<name>)`.
// `NoteUsed` and `OpenNoteCreated` are decoded here though the upstream indexer skips them: they
// are what makes a Personal feed possible.
//

import { hash } from 'starknet'
import type { RawPoolEvent } from './pool-events.js'

/** Every pool event this story decodes. Anything else is another contract's business. */
export const POOL_EVENT_NAMES = [
  'Deposit',
  'Withdrawal',
  'EncNoteCreated',
  'NoteUsed',
  'OpenNoteCreated',
  'OpenNoteDeposited',
  'ViewingKeySet',
] as const

export type PoolEventName = (typeof POOL_EVENT_NAMES)[number]

/** `keys[0]` for an event, which is how the RPC filter and the decoder both identify it. */
export function poolEventSelector(name: PoolEventName): string {
  return `0x${hash.starknetKeccak(name).toString(16)}`
}

/** Selector → name, built once. */
const NAME_BY_SELECTOR: ReadonlyMap<string, PoolEventName> = new Map(
  POOL_EVENT_NAMES.map((n) => [poolEventSelector(n), n]),
)

/** One felt out of an event, or a classified throw naming the FIELD rather than the index. */
function felt(values: readonly string[], index: number, field: string, event: string): bigint {
  const raw = values[index]
  if (raw === undefined) {
    throw new Error(`${event} carried no ${field} (expected at position ${index})`)
  }
  try {
    return BigInt(raw)
  } catch {
    throw new Error(
      `${event} carried a non-numeric ${field}: ${JSON.stringify(String(raw).slice(0, 64))}`,
    )
  }
}

export interface DepositEvent { kind: 'deposit'; user: bigint; token: bigint; amount: bigint }
export interface WithdrawalEvent { kind: 'withdrawal'; to: bigint; token: bigint; amount: bigint }
export interface EncNoteCreatedEvent { kind: 'note-created'; noteId: bigint; packedValue: bigint }
export interface NoteUsedEvent { kind: 'note-spent'; nullifier: bigint }
export interface OpenNoteCreatedEvent { kind: 'open-note-created'; token: bigint; noteId: bigint }
export interface OpenNoteDepositedEvent {
  kind: 'open-note-deposited'
  depositor: bigint
  token: bigint
  noteId: bigint
  amount: bigint
}
export interface ViewingKeySetEvent { kind: 'registration'; user: bigint; publicKey: bigint }

export type DecodedPoolEvent =
  | DepositEvent
  | WithdrawalEvent
  | EncNoteCreatedEvent
  | NoteUsedEvent
  | OpenNoteCreatedEvent
  | OpenNoteDepositedEvent
  | ViewingKeySetEvent

/** `Deposit`: keys `[selector, user_addr, token]`, data `[amount]`. */
export function decodeDeposit(keys: readonly string[], data: readonly string[]): DepositEvent {
  return {
    kind: 'deposit',
    user: felt(keys, 1, 'user_addr', 'Deposit'),
    token: felt(keys, 2, 'token', 'Deposit'),
    amount: felt(data, 0, 'amount', 'Deposit'),
  }
}

/**
 * `Withdrawal`: keys `[selector, to_addr, token]`, data `[enc_user_addr(3), amount]`.
 * The amount is at `data[3]` because `EncUserAddr` is three felts declared before it.
 */
export function decodeWithdrawal(keys: readonly string[], data: readonly string[]): WithdrawalEvent {
  return {
    kind: 'withdrawal',
    to: felt(keys, 1, 'to_addr', 'Withdrawal'),
    token: felt(keys, 2, 'token', 'Withdrawal'),
    amount: felt(data, 3, 'amount', 'Withdrawal'),
  }
}

/** `EncNoteCreated`: keys `[selector, note_id]`, data `[packed_value]`. */
export function decodeEncNoteCreated(
  keys: readonly string[],
  data: readonly string[],
): EncNoteCreatedEvent {
  return {
    kind: 'note-created',
    noteId: felt(keys, 1, 'note_id', 'EncNoteCreated'),
    packedValue: felt(data, 0, 'packed_value', 'EncNoteCreated'),
  }
}

/** `NoteUsed`: keys `[selector, nullifier]`, no data. The only record that a note was spent. */
export function decodeNoteUsed(keys: readonly string[]): NoteUsedEvent {
  return { kind: 'note-spent', nullifier: felt(keys, 1, 'nullifier', 'NoteUsed') }
}

/** `OpenNoteCreated`: keys `[selector, token, note_id]`, data `[enc_recipient_addr(3)]`. */
export function decodeOpenNoteCreated(keys: readonly string[]): OpenNoteCreatedEvent {
  return {
    kind: 'open-note-created',
    token: felt(keys, 1, 'token', 'OpenNoteCreated'),
    noteId: felt(keys, 2, 'note_id', 'OpenNoteCreated'),
  }
}

/** `OpenNoteDeposited`: keys `[selector, depositor, token, note_id]`, data `[amount]`. */
export function decodeOpenNoteDeposited(
  keys: readonly string[],
  data: readonly string[],
): OpenNoteDepositedEvent {
  return {
    kind: 'open-note-deposited',
    depositor: felt(keys, 1, 'depositor', 'OpenNoteDeposited'),
    token: felt(keys, 2, 'token', 'OpenNoteDeposited'),
    noteId: felt(keys, 3, 'note_id', 'OpenNoteDeposited'),
    amount: felt(data, 0, 'amount', 'OpenNoteDeposited'),
  }
}

/** `ViewingKeySet`: keys `[selector, user_addr, public_key]`, data `[enc_private_key(3)]`. */
export function decodeViewingKeySet(keys: readonly string[]): ViewingKeySetEvent {
  return {
    kind: 'registration',
    user: felt(keys, 1, 'user_addr', 'ViewingKeySet'),
    publicKey: felt(keys, 2, 'public_key', 'ViewingKeySet'),
  }
}

/**
 * Dispatches one raw event onto its decoder, or `null` if it is not one of ours.
 *
 * An unrecognised selector is `null` and skipped (the pool emits events this story has no row
 * for); a RECOGNISED selector whose fields do not decode throws, because that is a moved field or
 * a host answering something that is not an event, and both need to be loud.
 */
export function decodePoolEvent(event: RawPoolEvent): DecodedPoolEvent | null {
  const selector = event.keys[0]
  if (selector === undefined) return null
  let normalized: string
  try {
    normalized = `0x${BigInt(selector).toString(16)}`
  } catch {
    return null // not a felt, so not a selector, so not an event of ours
  }
  const name = NAME_BY_SELECTOR.get(normalized)
  const { keys, data } = event
  switch (name) {
    case 'Deposit': return decodeDeposit(keys, data)
    case 'Withdrawal': return decodeWithdrawal(keys, data)
    case 'EncNoteCreated': return decodeEncNoteCreated(keys, data)
    case 'NoteUsed': return decodeNoteUsed(keys)
    case 'OpenNoteCreated': return decodeOpenNoteCreated(keys)
    case 'OpenNoteDeposited': return decodeOpenNoteDeposited(keys, data)
    case 'ViewingKeySet': return decodeViewingKeySet(keys)
    default: return null
  }
}

/** The deployed pool's open-note discriminator: `packed_value >> 128 == 1`. Verified on mainnet notes. */
export const OPEN_NOTE_SALT = 1n

/** What a packed note value says without a channel key — which for an open note is everything. */
export interface PackedNote {
  open: boolean
  /** The plaintext amount for an open note; `null` for an encrypted one — never a fabricated zero. */
  amount: bigint | null
  salt: bigint
  /** True when the pool holds nothing under this id: not yet written, or spent and cleared. */
  absent: boolean
}

/** Splits a packed note value. Pure — the same bit math the SDK's discovery applies. */
export function packedNoteValue(packed: bigint): PackedNote {
  if (packed === 0n) return { open: false, amount: null, salt: 0n, absent: true }
  const salt = packed >> 128n
  const open = salt === OPEN_NOTE_SALT
  return { open, amount: open ? packed & ((1n << 128n) - 1n) : null, salt, absent: false }
}
