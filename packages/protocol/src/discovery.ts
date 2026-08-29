//
// Discovery — what this account holds, indexer-free, as of about which block.
//
// The SDK's `ContractDiscoveryProvider` walks the pool's own view entrypoints, so the viewing
// key is used here and never transmitted (the `IndexerDiscoveryProvider` posts it to a host).
// The provider lives only under the package's `/testing` subpath; this is the ONE module that
// imports it, and the ONE edit when upstream publishes it properly.
//

import { Contract, type BigNumberish, type RpcProvider } from 'starknet'
import {
  ContractDiscoveryProvider,
  compute_note_id,
  compute_nullifier,
  type PoolContractInterface,
} from '@starkware-libs/starknet-privacy-sdk/testing'
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi'
import type { RateLimitOptions } from '@starkware-libs/starknet-privacy-sdk'
import { NET } from './constants.js'
import { deriveViewingKey } from './identity.js'
import { withFallback } from './rpc.js'
import type { ShieldedBalancePresence } from './backup-cadence.js'

// Pool consensus hashes — imported, never reimplemented (activity.ts recomputes ids/nullifiers).
export { compute_note_id, compute_nullifier }
export type { PoolContractInterface }

// ── Caller-supplied wallet data — the seam a send spends from ───────────────────────────────

export interface SendNoteData {
  id: bigint
  token: string
  amount: bigint
  /** `channelKey` is the SENDER's channel to us; `nonce` is the note's index inside it. */
  witness: { channelKey: bigint; nonce: number; r: bigint }
  /** Carried for completeness; the compiler does not read it. */
  sender?: string
}

export interface SendChannelData {
  /** The address this channel points at. */
  address: string
  publicKey: bigint
  /** Absent means "this channel needs opening". */
  key?: bigint
  /**
   * Per-token subchannel state EXACTLY as the pool has it. The SDK defaults a missing token to
   * `{tokenIndex: 0, noteNonce: 0}`, which for an existing subchannel is an index already taken.
   */
  tokens?: { token: string; tokenIndex: number; noteNonce: number }[]
}

export interface SendWalletData {
  channels: SendChannelData[]
  notes: SendNoteData[]
}

// ── Models ──────────────────────────────────────────────────────────────────────────────────

export interface DiscoveredNote {
  id: bigint
  token: string
  amount: bigint
  witness: { channelKey: bigint; nonce: number; r: bigint }
  /** Who sent it. For a change note or a self-transfer, this account. */
  sender: string
  /** True when the amount was read as plaintext (open note) rather than decrypted. */
  open: boolean
}

/** A counterparty who has opened a channel TO this account. */
export interface DiscoveredIncomingChannel {
  counterparty: string
  /** SESSION-ONLY: decrypts every note this channel ever carried, spent ones included. */
  channelKey: bigint
  /**
   * Per token, the exclusive upper bound of note indices ever written — spent ones included,
   * which is what lets the Personal feed recompute every historical id and nullifier.
   * NOT the SDK cursor (that stops at the last UNSPENT index); see `extendSpentSlots`.
   */
  noteSlots: { token: string; nextIndex: number }[]
}

/** Everything the walk learned beyond the notes. NEVER persisted. */
export interface DiscoveredRegistry {
  incoming: DiscoveredIncomingChannel[]
  outgoing: SendChannelData[]
  /** The live outgoing-channel count — the index a NEW channel must open at. */
  outgoingTotal: number
}

/**
 * A union, not a nullable: 'present'/'absent' may only come from a COMPLETED walk. A failed
 * walk has no `.notes` to sum, so a caller cannot render a confident zero over a dead RPC.
 */
export type DiscoveryResult =
  | {
      state: 'walked'
      wallet: SendWalletData
      notes: DiscoveredNote[]
      registry: DiscoveredRegistry
      /** The height read BESIDE the walk (the SDK walk cannot be pinned). "As of about N". */
      blockNumber: number
      presence: Exclude<ShieldedBalancePresence, 'unknown'>
      /** False when `get_public_key` answered zero — a different sentence from an empty book. */
      registered: boolean
    }
  | { state: 'unreachable'; presence: 'unknown'; reason: string }

// ── Felt helpers ────────────────────────────────────────────────────────────────────────────

/** Lower-case unpadded hex felt. Refuses negatives and junk (a proxy's HTML-as-200) loudly. */
export function toFeltHex(value: bigint | string | number): string {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`a felt must be a whole number, not ${value}`)
  }
  let felt: bigint
  try {
    felt = BigInt(value)
  } catch {
    throw new Error(`not a felt: ${JSON.stringify(String(value).slice(0, 64))}`)
  }
  if (felt < 0n) throw new Error(`a felt cannot be negative, and this one is: ${felt}`)
  return `0x${felt.toString(16)}`
}

/** SDK types promise bigint but `NoteId` is `BigNumberish` at runtime — coerce at the boundary. */
function feltFromSdk(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`the SDK returned a non-integer ${field}: ${value}`)
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`the SDK returned a ${typeof value} for ${field}, which is not a felt`)
  }
  try {
    return BigInt(value)
  } catch {
    throw new Error(`the SDK returned a non-numeric ${field}: ${JSON.stringify(String(value).slice(0, 64))}`)
  }
}

// ── The pool as a PLAIN forwarding object ───────────────────────────────────────────────────

/** The eight views the SDK walk calls, plus `get_public_key`. Checked at construction. */
const POOL_ENTRYPOINTS = [
  'channel_exists',
  'get_num_of_channels',
  'get_channel_info',
  'get_subchannel_info',
  'get_outgoing_channel_info',
  'get_note',
  'nullifier_exists',
  'get_public_key',
] as const

/**
 * A plain object of forwarding methods, never `typedv2()` itself: the SDK rate limiter wraps
 * the pool in a Proxy whose `get` returns a throttled wrapper, and a typedv2 contract's
 * entrypoints are non-configurable data properties — a proxy invariant violation that surfaces
 * as an unhandled TypeError at `get_outgoing_channel_info` and reads as `unreachable`.
 * Built per provider: `withFallback` hands a fresh host per attempt.
 */
export function poolContractFor(provider: RpcProvider, poolAddress: string = NET.pool): PoolContractInterface {
  const contract = new Contract({ abi: PrivacyPoolABI, address: poolAddress, providerOrAccount: provider })
  const call = contract as unknown as Record<string, (...args: BigNumberish[]) => Promise<never>>
  const missing = POOL_ENTRYPOINTS.filter((name) => typeof call[name] !== 'function')
  if (missing.length > 0) {
    throw new Error(
      `the pool ABI does not expose ${missing.join(', ')} — this build cannot walk this pool. ` +
        'The vendored SDK ABI and the deployed class have diverged.',
    )
  }
  return {
    channel_exists: (marker) => call.channel_exists!(marker),
    get_num_of_channels: (recipient) => call.get_num_of_channels!(recipient),
    get_channel_info: (recipient, index) => call.get_channel_info!(recipient, index),
    subchannel_exists: (marker) => call.subchannel_exists!(marker),
    get_subchannel_info: (id) => call.get_subchannel_info!(id),
    get_outgoing_channel_info: (id) => call.get_outgoing_channel_info!(id),
    get_note: (noteId) => call.get_note!(noteId),
    nullifier_exists: (nullifier) => call.nullifier_exists!(nullifier),
    get_public_key: (address) => call.get_public_key!(address),
    get_enc_private_key: (address) => call.get_enc_private_key!(address),
    get_auditor_public_key: () => call.get_auditor_public_key!(),
    get_fee_amount: () => call.get_fee_amount!(),
    get_fee_collector: () => call.get_fee_collector!(),
    get_proof_validity_blocks: () => call.get_proof_validity_blocks!(),
  }
}

/** ON by default — the SDK's own numbers, applied. Unthrottled, a large account gets rate-limited mid-walk. */
export const DEFAULT_DISCOVERY_RATE_LIMIT = { concurrency: 8, maxRetries: 3, baseDelayMs: 100 } as const

/** The SDK walk over a plain forwarding pool. `client.ts` builds its discovery provider from this. */
export function contractDiscoveryFor(
  pool: PoolContractInterface,
  rateLimit: RateLimitOptions | null = DEFAULT_DISCOVERY_RATE_LIMIT,
): ContractDiscoveryProvider {
  return new ContractDiscoveryProvider(pool, rateLimit ? { rateLimit } : undefined)
}

export interface DiscoverOptions {
  /** Overrides `DEFAULT_DISCOVERY_RATE_LIMIT`. `null` walks unthrottled. */
  rateLimit?: RateLimitOptions | null
  /** A pool interface to walk instead of the live one. */
  pool?: PoolContractInterface
  /** The block height to stamp with, instead of a live read. */
  blockNumber?: number
}

// ── The walk ────────────────────────────────────────────────────────────────────────────────

/**
 * Block height FIRST from the provider that is about to walk (a stamp must never claim to
 * include something it could not have); then `get_public_key`; then the walk. Any throw is
 * `unreachable` — an empty account completes normally and says `'absent'`.
 */
export async function discoverWallet(
  address: string,
  accountKey: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
  try {
    return await withFallback(async (provider) => {
      const pool = options.pool ?? poolContractFor(provider)
      const blockNumber = options.blockNumber ?? (await provider.getBlockNumber())
      const registered = BigInt(await pool.get_public_key(address)) !== 0n
      return await walk(pool, address, viewingKey, blockNumber, registered, options)
    })
  } catch (e) {
    return { state: 'unreachable', presence: 'unknown', reason: String((e as Error)?.message ?? e) }
  }
}

/** Unregistered accounts are walked anyway: channel storage is keyed by address, not by key slot. */
async function walk(
  pool: PoolContractInterface,
  address: string,
  viewingKey: bigint,
  blockNumber: number,
  registered: boolean,
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const rateLimit = options.rateLimit === undefined ? DEFAULT_DISCOVERY_RATE_LIMIT : options.rateLimit
  const provider = contractDiscoveryFor(pool, rateLimit)
  const self = BigInt(address)

  // What we HOLD (incoming channels, notes) and what we have OPENED (a send's channel indices).
  const [notesResult, channelsResult] = await Promise.all([
    provider.discoverNotes(self, viewingKey),
    provider.discoverChannels(self, viewingKey, 'all'),
  ])

  const notes: DiscoveredNote[] = []
  for (const [token, tokenNotes] of notesResult.notes.entries()) {
    for (const note of tokenNotes) {
      notes.push({
        id: feltFromSdk(note.id, 'note id'),
        token: toFeltHex(token),
        amount: feltFromSdk(note.amount, 'note amount'),
        witness: {
          channelKey: feltFromSdk(note.witness.channelKey, 'witness channel key'),
          nonce: note.witness.nonce,
          r: feltFromSdk(note.witness.r, 'witness salt'),
        },
        sender: toFeltHex(feltFromSdk(note.sender, 'note sender')),
        open: note.open === true,
      })
    }
  }

  const incoming: DiscoveredIncomingChannel[] = []
  for (const [counterparty, cursor] of notesResult.cursor.incomingChannels.entries()) {
    incoming.push({
      counterparty: toFeltHex(counterparty),
      channelKey: feltFromSdk(cursor.channelKey, 'incoming channel key'),
      noteSlots: [...cursor.noteIndexes.entries()].map(([token, nextIndex]) => ({
        token: toFeltHex(token),
        nextIndex,
      })),
    })
  }
  await extendSpentSlots(pool, incoming)

  const outgoing: SendChannelData[] = []
  for (const [recipient, channel] of channelsResult.channels?.entries() ?? []) {
    outgoing.push({
      address: toFeltHex(recipient),
      publicKey: feltFromSdk(channel.publicKey, 'recipient public key'),
      ...(channel.key === undefined ? {} : { key: feltFromSdk(channel.key, 'outgoing channel key') }),
      tokens: [...channel.tokens.entries()].map(([token, nonces]) => ({
        token: toFeltHex(token),
        tokenIndex: nonces.tokenIndex,
        noteNonce: nonces.noteNonce,
      })),
    })
  }

  return {
    state: 'walked',
    wallet: { channels: outgoing, notes: notes.map(toSendNote) },
    notes,
    registry: { incoming, outgoing, outgoingTotal: outgoingTotalFrom(channelsResult, outgoing.length) },
    blockNumber,
    presence: notes.length > 0 ? 'present' : 'absent',
    registered,
  }
}

/** Hang guard on a loop whose termination depends on pool storage. Far above any real subchannel. */
const MAX_SPENT_SLOT_PROBE = 2_000

/**
 * The SDK cursor advances only in `addNoteIfNotSpent`, so an all-spent account reports 0.
 * Spent notes stay in storage (a nullifier is written, the slot is not cleared), so
 * `get_note != 0` walks the bound upward to the last note ever written. Mutates in place.
 */
async function extendSpentSlots(pool: PoolContractInterface, incoming: DiscoveredIncomingChannel[]): Promise<void> {
  await Promise.all(
    incoming.flatMap((channel) =>
      channel.noteSlots.map(async (slot) => {
        const token = BigInt(slot.token)
        let index = slot.nextIndex
        while (index < slot.nextIndex + MAX_SPENT_SLOT_PROBE) {
          const note = await pool.get_note(compute_note_id(channel.channelKey, token, index))
          if (feltFromSdk(note.packed_value, 'packed note value') === 0n) break
          index += 1
        }
        slot.nextIndex = index
      }),
    ),
  )
}

/**
 * The index a NEW channel must open at (the pool reverts INDEX_NOT_SEQUENTIAL otherwise, after
 * the fee). A missing KEY is an SDK contract change and refuses; a present-but-undefined value
 * is the SDK's legitimate "no outgoing channels" and means zero. Never `?? 0` on the whole.
 */
export function outgoingTotalFrom(result: { total?: number }, discoveredChannelCount: number): number {
  if (!('total' in result)) {
    throw new Error(
      'the SDK returned no `total` for the outgoing-channel walk. That field is the index a ' +
        'new channel must open at, and guessing it reverts INDEX_NOT_SEQUENTIAL.',
    )
  }
  const total = result.total ?? 0
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`the SDK reported a nonsensical outgoing-channel count: ${String(total)}`)
  }
  if (total < discoveredChannelCount) {
    throw new Error(
      `the SDK reported ${total} outgoing channel(s) but handed back ${discoveredChannelCount}. ` +
        'Every discovered channel occupies an index, so this walk is internally inconsistent.',
    )
  }
  return total
}

/** Projects a discovered note onto the send seam, dropping `open`. */
export function toSendNote(note: DiscoveredNote): SendNoteData {
  return { id: note.id, token: note.token, amount: note.amount, witness: note.witness, sender: note.sender }
}
