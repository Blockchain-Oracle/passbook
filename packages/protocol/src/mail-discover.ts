//
// Mail discovery: every memo this account can read, rebuilt from the walk and the Mailbox's events.
//
// A memo is keyed by the note it rides with, and a note id is a pure function of (channel key,
// token, index). The walk already knows every channel this account is on either end of — incoming
// ones with the key recovered from the pool's channel record, outgoing ones with the key it derived
// — so every note id this account could ever have sent or received is recomputable, spent ones
// included. Join those against the posted anchors, derive the key, open the memo. No index, no
// server, no local history: a fresh device holding the viewing key sees the same threads.
//

import { compute_enc_amount_hash, compute_note_id, type DiscoveredRegistry, type DiscoveredNote } from './discovery.js'
import { decodeMailBody, type MailBody } from './mail-body.js'
import { MailUnreadable, openMail, type MailContext } from './mail-envelope.js'
import type { PostedMail } from './mail-events.js'
import { packedNoteValue } from './pool-event-decoders.js'
import { readPackedNote } from './pool.js'
import { sameFelt } from './send-plan.js'

const TWO_POW_128 = 1n << 128n

/**
 * A note amount from its packed value, for anyone holding the channel key — the pool's own
 * `(salt << 128) | (h(channel_key, token, index, salt) + amount) % 2^128` run backwards. `null`
 * when the pool holds nothing under the id (a note that reverted, or one not written yet).
 */
export function decryptNoteAmount(packed: bigint, channelKey: bigint, token: bigint, index: number): bigint | null {
  const note = packedNoteValue(packed)
  if (note.absent) return null
  if (note.open) return note.amount
  const pad = compute_enc_amount_hash(channelKey, token, index, note.salt) % TWO_POW_128
  return ((packed % TWO_POW_128) + TWO_POW_128 - pad) % TWO_POW_128
}

/** One note this account could have sent or received, as far as the memo join needs to know. */
export interface MailNoteRef {
  noteId: bigint
  direction: 'in' | 'out'
  /** The other account: the sender of an incoming note, the recipient of an outgoing one. */
  peer: string
  channelKey: bigint
  token: string
  index: number
  /** Known for held notes without a read; `null` until `get_note` is asked. */
  amount: bigint | null
}

/** The most note slots the join will recompute — the same hang guard the activity feed uses. */
export const MAX_MAIL_NOTE_SLOTS = 5_000

const key = (id: bigint) => id.toString()

/**
 * Every note id on every channel this account touches, keyed by id. Incoming channels enumerate
 * `0 ≤ index < nextIndex` (spent-extended by the walk); outgoing ones `0 ≤ index < noteNonce`,
 * which the pool keeps as the count of notes ever written on that subchannel.
 */
export function mailNoteIndex(registry: DiscoveredRegistry, held: readonly DiscoveredNote[]): Map<string, MailNoteRef> {
  let slots = 0
  for (const c of registry.incoming) for (const s of c.noteSlots) slots += s.nextIndex
  for (const c of registry.outgoing) for (const t of c.tokens ?? []) slots += t.noteNonce
  if (slots > MAX_MAIL_NOTE_SLOTS) {
    throw new Error(`this registry claims ${slots} note slots, more than the ${MAX_MAIL_NOTE_SLOTS} any real account holds`)
  }
  const heldAmount = new Map(held.map((n) => [key(n.id), n.amount]))
  const out = new Map<string, MailNoteRef>()
  for (const channel of registry.incoming) {
    for (const slot of channel.noteSlots) {
      const token = BigInt(slot.token)
      for (let index = 0; index < slot.nextIndex; index++) {
        const noteId = compute_note_id(channel.channelKey, token, index)
        out.set(key(noteId), {
          noteId,
          direction: 'in',
          peer: channel.counterparty,
          channelKey: channel.channelKey,
          token: slot.token,
          index,
          amount: heldAmount.get(key(noteId)) ?? null,
        })
      }
    }
  }
  for (const channel of registry.outgoing) {
    if (channel.key === undefined) continue
    for (const slot of channel.tokens ?? []) {
      const token = BigInt(slot.token)
      for (let index = 0; index < slot.noteNonce; index++) {
        const noteId = compute_note_id(channel.key, token, index)
        out.set(key(noteId), { noteId, direction: 'out', peer: channel.address, channelKey: channel.key, token: slot.token, index, amount: null })
      }
    }
  }
  return out
}

export type MailStatus = 'verified' | 'unreadable'

export interface MailItem {
  peer: string
  direction: 'in' | 'out'
  noteId: bigint
  token: string
  /** The note's value, read from the pool and decrypted; `null` when the pool holds no such note. */
  amount: bigint | null
  /** Opened and authenticated, or `null` when the memo did not open against this note. */
  body: MailBody | null
  status: MailStatus
  /** Why it did not open — for the row's refusal text, never rendered as content. */
  problem?: string
  blockNumber: number
  transactionHash: string
}

export interface MailThread {
  peer: string
  items: MailItem[]
  lastBlock: number
}

export interface DiscoverMailInput {
  context: MailContext
  registry: DiscoveredRegistry
  held: readonly DiscoveredNote[]
  posted: readonly PostedMail[]
  /** Injected by tests: the packed note read, instead of the live pool. */
  readPacked?: (noteId: bigint) => Promise<bigint>
}

/** Every posted memo anchored to a note this account can name, opened. Anchors that are not ours are skipped. */
export async function discoverMail(input: DiscoverMailInput): Promise<MailItem[]> {
  const index = mailNoteIndex(input.registry, input.held)
  const readPacked = input.readPacked ?? readPackedNote
  const items: MailItem[] = []
  for (const post of input.posted) {
    const ref = index.get(key(post.envelope.anchor))
    if (!ref) continue
    const token = BigInt(ref.token)
    const amount =
      ref.amount ?? decryptNoteAmount(await readPacked(ref.noteId), ref.channelKey, token, ref.index)
    const base = { peer: ref.peer, direction: ref.direction, noteId: ref.noteId, token: ref.token, amount, blockNumber: post.blockNumber, transactionHash: post.transactionHash }
    try {
      const plaintext = await openMail({ ...input.context, channelKey: ref.channelKey, noteId: ref.noteId, token }, post.envelope)
      items.push({ ...base, body: decodeMailBody(plaintext), status: 'verified' })
    } catch (e) {
      const problem = e instanceof MailUnreadable ? e.message : `the memo could not be opened: ${String(e)}`
      items.push({ ...base, body: null, status: 'unreadable', problem })
    }
  }
  items.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionHash.localeCompare(b.transactionHash))
  return items
}

/** Items grouped by peer, newest thread first. Peers are compared as felts. */
export function mailThreads(items: readonly MailItem[]): MailThread[] {
  const threads: MailThread[] = []
  for (const item of items) {
    let thread = threads.find((t) => sameFelt(t.peer, item.peer))
    if (!thread) {
      thread = { peer: item.peer, items: [], lastBlock: item.blockNumber }
      threads.push(thread)
    }
    thread.items.push(item)
    thread.lastBlock = Math.max(thread.lastBlock, item.blockNumber)
  }
  threads.sort((a, b) => b.lastBlock - a.lastBlock)
  return threads
}
