//
// Pool events — the bounded read, and the pure decoders (AD-14, story 1.9).
//
// Two things live here, and they are separate on purpose. The READ is the only thing in this
// story that touches a chain over a range rather than at a point, so it is the only thing that
// can run away: an unbounded `getEvents` against a pool with a year of history is a request
// that either times out or returns a payload nobody sized for. The DECODERS are pure functions
// over `(keys, data)` with junk-input tables, which is the `pool.ts` convention — a wire decode
// that only ever runs inside a network call is a decode no test has run.
//
// ── WHERE THE FIELD OFFSETS COME FROM ────────────────────────────────────────────────────
//
// `packages/privacy/src/events.cairo` at the pinned deployed class, cross-checked against the
// upstream indexer's own decoder (`crates/discovery-core/src/privacy_pool/events.rs`). Cairo
// splits an event into `keys` and `data` by the `#[key]` attribute, in field-declaration order,
// with `keys[0]` always `starknet_keccak(<event name>)`. That is why `Withdrawal`'s amount is
// at `data[3]`: `enc_user_addr` is an `EncUserAddr`, which is three felts, and it is declared
// before `amount`. Getting that wrong reads an encrypted address fragment as a number of
// tokens, which is exactly the class of bug that looks fine until it is on a statement.
//
// `NoteUsed` and `OpenNoteCreated` are decoded here but are NOT in the upstream indexer's
// selector list — it parses five events, we parse seven. They are what makes a Personal feed
// possible: `NoteUsed` is the only record that a note was spent, and without it a feed shows
// every note ever received and nothing ever leaving.
//

import { hash } from 'starknet'
import { NET } from './constants.js'
import { withFallback } from './rpc.js'

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

/** Selector → name, built once. The decoder dispatches on this rather than re-hashing. */
const NAME_BY_SELECTOR: ReadonlyMap<string, PoolEventName> = new Map(
  POOL_EVENT_NAMES.map((n) => [poolEventSelector(n), n]),
)

/**
 * How many events one RPC request asks for by DEFAULT.
 *
 * 100 rather than the 1000 a host will usually allow: this runs in a browser, every page is a
 * round trip the user is waiting through, and a smaller chunk means a caller can render its
 * first page while later ones are still arriving. The precedent in this repository is
 * `reference/tipjar/app/src/hooks/useTipJar.ts`, which uses the same number against the same
 * network for the same reason.
 *
 * A CALLER THAT DOES NOT RENDER INCREMENTALLY SHOULD ASK FOR MORE, and `MAX_EVENT_CHUNK_SIZE`
 * is how far. The saving is not marginal: measured against mainnet on 2026-08-27, a week of pool
 * history is 30 round trips at this size and 6 at the ceiling — 22 seconds against 8.5.
 */
export const EVENT_CHUNK_SIZE = 100

/**
 * The largest chunk this module will ask a host for, whatever a caller requests.
 *
 * 1000 is the documented ceiling on Starknet RPC `starknet_getEvents`. Measured on 2026-08-27 the
 * public host serves around 546 events for such a request and hands back a continuation token for
 * the rest, so asking for 1000 is not a promise of 1000 — it is the difference between five pages
 * and one. Asking for more than the spec allows risks an outright refusal rather than a short
 * page, which is why this is a clamp and not a suggestion.
 */
export const MAX_EVENT_CHUNK_SIZE = 1000

/**
 * The most pages one call will walk before it stops and SAYS it stopped.
 *
 * A continuation-token loop with no cap is an unbounded read wearing a bound: the token keeps
 * coming back and the loop keeps going until something else breaks. The upstream discovery
 * service caps its own pagination at 1024; this is lower because the browser is paying. What
 * makes the cap safe rather than a silent truncation is `complete: false` on the result — a
 * feed that stopped early has to be able to say so.
 */
export const MAX_EVENT_PAGES = 64

/** One event as the RPC returned it, before any field is understood. */
export interface RawPoolEvent {
  keys: string[]
  data: string[]
  blockNumber: number
  transactionHash: string
}

/**
 * A resume token, bound to the host that issued it.
 *
 * A continuation token is an OPAQUE, HOST-SPECIFIC CURSOR. The two RPC hosts are independently
 * synced and index blocks separately, so a token minted by one means nothing to the other: at
 * best it is rejected, at worst it is interpreted as a different offset and the caller silently
 * receives somebody else's page of history. `withFallback` picks a host per attempt, so a token
 * handed back into a fresh call is not guaranteed to return to the node that made it.
 *
 * Carrying the host with the token makes the hazard mechanical instead of documentary: a resume
 * is pinned to its issuer, and a resume whose issuer is unreachable REFUSES rather than
 * silently re-issuing the query somewhere else.
 */
export interface EventCursor {
  token: string
  /** The `nodeUrl` of the host that minted `token`. */
  host: string
}

/** The outcome of one bounded read. */
export interface PoolEventPage {
  events: RawPoolEvent[]
  /** The range actually asked for — echoed back so a caller can page from where this stopped. */
  fromBlock: number
  toBlock: number
  /**
   * False when the page cap stopped the walk before the chain ran out.
   *
   * A feed built on `complete: false` is showing a window, not a history, and must say so.
   * Silently truncating is how "your last transaction" becomes wrong without anything failing.
   */
  complete: boolean
  pagesRead: number
  /** Where to resume when `complete` is false. `null` when the range was exhausted. */
  continuation: EventCursor | null
}

/** What a bounded read needs. `fromBlock` has no default, which is the bound. */
export interface ReadPoolEventsOptions {
  /**
   * The first block to read. REQUIRED, and that is the AD-14 rule in the type system: there is
   * no overload of this function that reads from genesis.
   */
  fromBlock: number
  /** The last block to read. Defaults to the live head, read through the same fallback. */
  toBlock?: number
  /** Which events to ask for. Defaults to all seven. */
  names?: readonly PoolEventName[]
  chunkSize?: number
  maxPages?: number
  /** Resume cursor from a previous page whose `complete` was false. Pinned to its issuing host. */
  continuation?: EventCursor
  /** Injected by tests: the paged reader, instead of a live RPC. */
  getEvents?: (request: EventRequest) => Promise<{ events: unknown[]; continuation_token?: string }>
}

/** The request shape the RPC takes, named so a test seam has something to assert on. */
export interface EventRequest {
  address: string
  from_block: { block_number: number }
  to_block: { block_number: number }
  keys: string[][]
  chunk_size: number
  continuation_token?: string
}

/**
 * Reads pool events over a bounded block range, following continuation tokens up to a cap.
 *
 * The whole loop runs inside ONE `withFallback` attempt, so every page comes from the same RPC
 * host. Paging across hosts would splice two independently-synced views together, and a
 * continuation token from one host means nothing to another — it would be handed back as an
 * opaque string and either rejected or, worse, interpreted as a different offset.
 *
 * A range whose start is above its end returns an empty, COMPLETE page rather than throwing:
 * it is the honest answer to "what happened between here and here" when the answer is nothing,
 * and it is the shape a caller hits naturally when the head has not moved since the last read.
 */
export async function readPoolEvents(options: ReadPoolEventsOptions): Promise<PoolEventPage> {
  const { fromBlock } = options

  // Every bound is validated BEFORE a provider is chosen, so a bad call costs no round trip and
  // fails with a message about the argument rather than about the network.
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(`fromBlock must be a whole block height, not ${String(fromBlock)}`)
  }
  if (options.toBlock !== undefined && (!Number.isInteger(options.toBlock) || options.toBlock < 0)) {
    throw new Error(`toBlock must be a whole block height, not ${String(options.toBlock)}`)
  }
  if (options.chunkSize !== undefined && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1)) {
    throw new Error(`chunkSize must be at least 1, not ${String(options.chunkSize)}`)
  }
  if (options.maxPages !== undefined && (!Number.isInteger(options.maxPages) || options.maxPages < 1)) {
    throw new Error(`maxPages must be at least 1, not ${String(options.maxPages)}`)
  }

  const names = options.names ?? POOL_EVENT_NAMES
  // AN EMPTY NAME LIST IS THE MOST DANGEROUS ARGUMENT THIS FUNCTION TAKES, and it looks like the
  // most harmless. It would produce `keys: [[]]`, and an empty inner array is starknet's
  // "match anything at this position" wildcard — so asking for no event types would return
  // EVERY event the pool has ever emitted, turning the bounded read into the firehose the whole
  // module exists to prevent. Refused rather than silently treated as "all seven", because a
  // caller that computed an empty list did so by mistake and wants to know.
  if (names.length === 0) {
    throw new Error(
      'readPoolEvents was asked for zero event types. An empty key filter matches every event ' +
        'the pool emits, so this is refused rather than silently read as "all of them".',
    )
  }
  const selectors = names.map(poolEventSelector)

  // Clamped to the SPEC ceiling, not to the default — a caller that asked for more than 100 was
  // making a deliberate trade (fewer round trips, no incremental render) and silently holding it
  // at the default would take the choice away while appearing to honour it.
  const chunkSize = Math.min(options.chunkSize ?? EVENT_CHUNK_SIZE, MAX_EVENT_CHUNK_SIZE)
  const maxPages = Math.min(options.maxPages ?? MAX_EVENT_PAGES, MAX_EVENT_PAGES)
  const resume = options.continuation

  return withFallback(async (provider) => {
    // A RESUME IS PINNED TO ITS ISSUER. `withFallback` may hand this closure either host, and a
    // continuation token from the other one is an opaque cursor into a different node's index —
    // rejected at best, silently a different page of history at worst. Refusing here means the
    // fallback moves on to the next host, and if the issuer never comes back the caller gets a
    // named failure instead of somebody else's rows.
    const host = provider.channel.nodeUrl
    if (resume && resume.host !== host) {
      throw new Error(
        `this continuation cursor was issued by ${resume.host} and cannot be resumed against ` +
          `${host}: a continuation token is an opaque, host-specific cursor.`,
      )
    }

    const toBlock = options.toBlock ?? (await provider.getBlockNumber())
    if (fromBlock > toBlock) {
      return { events: [], fromBlock, toBlock, complete: true, pagesRead: 0, continuation: null }
    }

    const read =
      options.getEvents ??
      ((request: EventRequest) => provider.getEvents(request as never) as Promise<{ events: unknown[]; continuation_token?: string }>)

    const events: RawPoolEvent[] = []
    let continuation = resume?.token
    let pagesRead = 0

    do {
      const page = await read({
        address: NET.pool,
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        // ONE inner array: starknet's key filter is positional, and `[[a, b, c]]` means
        // "keys[0] is any of a, b, c". `[[a], [b]]` would mean "keys[0] is a AND keys[1] is
        // b", which for these events would filter on a note id and match nothing.
        keys: [selectors],
        chunk_size: chunkSize,
        ...(continuation === undefined ? {} : { continuation_token: continuation }),
      })
      for (const raw of page.events ?? []) events.push(toRawEvent(raw))
      continuation = page.continuation_token
      pagesRead += 1
    } while (continuation && pagesRead < maxPages)

    return {
      events,
      fromBlock,
      toBlock,
      complete: !continuation,
      pagesRead,
      continuation: continuation === undefined ? null : { token: continuation, host },
    }
  })
}

/**
 * Normalizes one RPC event into the shape the decoders take.
 *
 * BOTH IDENTIFIERS ARE REQUIRED, and for the same reason. Every entry in the record is stamped
 * with its block, and an event that cannot say which block it is from would become a row
 * claiming block 0. The transaction hash carries exactly as much weight: it is half of the
 * addressable id (`<hash>-<ordinal>`) and the key the fee is joined on, so defaulting a missing
 * one to `''` would collapse every hash-less event into a single synthetic transaction whose
 * rows share ids and share whichever fee landed on it. The realistic source of either gap is a
 * pending-block event, which has no business in a settled record.
 *
 * Element types are checked rather than cast. `keys` and `data` are felts on the wire, and a
 * bare `as string[]` over an array of objects would hand the decoders values whose `BigInt`
 * conversion fails much later, inside a message about a field name rather than about the shape
 * of the response.
 */
export function toRawEvent(raw: unknown): RawPoolEvent {
  const e = (raw ?? {}) as {
    keys?: unknown
    data?: unknown
    block_number?: unknown
    transaction_hash?: unknown
  }
  const blockNumber = e.block_number
  if (typeof blockNumber !== 'number' || !Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new Error(`a pool event arrived without a usable block number: ${JSON.stringify(blockNumber)}`)
  }
  const transactionHash = e.transaction_hash
  if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
    throw new Error(
      `a pool event in block ${blockNumber} arrived without a transaction hash: ` +
        `${JSON.stringify(transactionHash)}. It is half of every entry id and the key a fee is ` +
        'joined on, so it cannot be defaulted.',
    )
  }
  return {
    keys: feltArray(e.keys, 'keys', blockNumber),
    data: feltArray(e.data, 'data', blockNumber),
    blockNumber,
    transactionHash,
  }
}

/** An event's `keys` or `data` as felt strings, or a classified failure. Absent means empty. */
function feltArray(value: unknown, field: string, blockNumber: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`a pool event in block ${blockNumber} carried a non-array ${field}`)
  }
  return value.map((element, index) => {
    if (typeof element === 'string') return element
    // Numbers are accepted and normalized; anything else is a response that is not an event.
    if (typeof element === 'number' || typeof element === 'bigint') return `0x${BigInt(element).toString(16)}`
    throw new Error(
      `a pool event in block ${blockNumber} carried a ${typeof element} at ${field}[${index}], ` +
        'which is not a felt',
    )
  })
}

// ── The decoders. Pure, per selector, and each one exported so junk can be thrown at it. ────

/**
 * One felt out of an event's `keys` or `data`, or a classified throw.
 *
 * The message names the FIELD, not the index, because the caller reading a failure has an
 * event and a field name and no idea what offset 3 was supposed to be. `BigInt` throws a bare
 * SyntaxError on a non-numeric string — the realistic source being a proxy that rewrote an RPC
 * error into a 200 with an HTML body — and letting that escape would surface a parse error
 * from inside what the caller experiences as reading their own history.
 */
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
 *
 * The amount is at `data[3]` because `EncUserAddr` is three felts — `auditor_public_key`,
 * `ephemeral_pubkey`, `enc_user_addr` — declared before `amount` in `events.cairo`.
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
 * THE TWO OUTCOMES ARE DIFFERENT AND MUST STAY DIFFERENT, which is the upstream indexer's own
 * split (`EventParseError::UnknownSelector` versus `::Malformed`). An unrecognised selector is
 * `null` and is skipped: the pool emits governance events this story has no row for, and a feed
 * that threw on one would break on an unrelated admin action. A RECOGNISED selector whose
 * fields do not decode throws, because that is either a contract upgrade that moved a field or
 * a host returning something that is not an event, and both need to be loud.
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

/**
 * The salt an open note carries in the high 128 bits of its packed value.
 *
 * The deployed pool's discriminator, not a convention: `packed_value >> 128 == 1` is an open
 * note, anything higher is an encrypted note's salt. Verified against 12 real mainnet notes in
 * `test/discovery-live.test.ts`, where the plaintext amount this yields is checked against the
 * `OpenNoteDeposited` amounts the same notes were funded with.
 */
export const OPEN_NOTE_SALT = 1n

/** What a packed note value says without a channel key — which for an open note is everything. */
export interface PackedNote {
  open: boolean
  /**
   * The plaintext amount for an open note; `null` for an encrypted one.
   *
   * `null` rather than zero, and this is the field the whole "never a fabricated 0" rule lives
   * or dies on. An encrypted note's low 128 bits are ciphertext — reading them as an amount
   * produces a large, confident, completely wrong number, and defaulting them to zero produces
   * a row that says somebody moved nothing.
   */
  amount: bigint | null
  salt: bigint
  /** True when the pool holds nothing under this id: not yet written, or spent and cleared. */
  absent: boolean
}

/** Splits a packed note value. Pure — the same bit math `contract-discovery.js` applies. */
export function packedNoteValue(packed: bigint): PackedNote {
  if (packed === 0n) return { open: false, amount: null, salt: 0n, absent: true }
  const salt = packed >> 128n
  const open = salt === OPEN_NOTE_SALT
  return { open, amount: open ? packed & ((1n << 128n) - 1n) : null, salt, absent: false }
}
