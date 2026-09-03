//
// The Mailbox's `Posted` events — the only place a memo exists once it has left the browser.
//
// The pool does not emit invoke calldata, so the Mailbox emits the envelope itself, keyed by the
// note id it rides with. Reading them is one bounded scan of our own contract from the block it
// was deployed in: a helper that has posted a few thousand memos is still a few round trips, and
// direct RPC is the path a fresh device recovers from with no service in between.
//

import { hash } from 'starknet'
import { envelopeFromFelts, type MailEnvelope } from './mail-envelope.js'
import { readPoolEvents, type EventCursor, type RawPoolEvent } from './pool-events.js'

export const MAILBOX_POSTED_SELECTOR = `0x${hash.starknetKeccak('Posted').toString(16)}`

/** One memo as posted: the envelope plus where it landed. */
export interface PostedMail {
  envelope: MailEnvelope
  blockNumber: number
  transactionHash: string
}

/**
 * `Posted { #[key] anchor, version, nonce, byte_len, body: Span<felt252> }`:
 * keys `[selector, anchor]`, data `[version, nonce, byte_len, body_len, ...body]`.
 * Returns `null` for anything else, including a well-keyed event whose body does not add up.
 */
export function decodePostedEvent(event: RawPoolEvent): PostedMail | null {
  if (event.keys.length !== 2 || BigInt(event.keys[0]!) !== BigInt(MAILBOX_POSTED_SELECTOR)) return null
  try {
    const felts = [event.keys[1]!, ...event.data].map((f) => BigInt(f))
    return { envelope: envelopeFromFelts(felts), blockNumber: event.blockNumber, transactionHash: event.transactionHash }
  } catch {
    return null
  }
}

export interface MailEventPage {
  posted: PostedMail[]
  fromBlock: number
  toBlock: number
  complete: boolean
  continuation: EventCursor | null
}

export interface ReadMailEventsOptions {
  mailbox: string
  /** The Mailbox's deploy block, from the deployment record: no memo can predate it. */
  fromBlock: number
  toBlock?: number
  continuation?: EventCursor
  chunkSize?: number
  maxPages?: number
}

/** Every memo the Mailbox has posted in the range, decoded. Malformed events are dropped, not thrown. */
export async function readMailEvents(options: ReadMailEventsOptions): Promise<MailEventPage> {
  const page = await readPoolEvents({
    address: options.mailbox,
    selectors: [MAILBOX_POSTED_SELECTOR],
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    continuation: options.continuation,
    chunkSize: options.chunkSize ?? 1000,
    maxPages: options.maxPages,
  })
  const posted: PostedMail[] = []
  for (const raw of page.events) {
    const decoded = decodePostedEvent(raw)
    if (decoded) posted.push(decoded)
  }
  return { posted, fromBlock: page.fromBlock, toBlock: page.toBlock, complete: page.complete, continuation: page.continuation }
}
