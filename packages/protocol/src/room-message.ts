//
// What travels inside a sealed envelope: the message types a thread can carry.
//
// THIS IS THE PLAINTEXT LAYER, and it exists as its own file because the crypto below it must not
// grow opinions about content. `room.ts` seals bytes; this decides what those bytes mean. The
// split is what lets a new message type ship without touching a line of key handling.
//
// TWO TYPES, AND THE SECOND ONE IS THE PRODUCT. A text message is what any chat has. A PAYMENT is
// a card in the thread that says value moved, carrying the amount and the transaction it settled
// in — so a payment reads as part of the conversation instead of a receipt from somewhere else.
//
// THE PAYMENT CARD IS A CLAIM, NOT A PROOF, and the receiving client must treat it as one. Anyone
// holding the room key can seal a card saying anything; what authenticates it is the transaction
// hash it names, which the recipient can check on chain and which their own balance will confirm.
// The card is how the sender POINTS at a payment. It is not how the payment is made, and a client
// that credits a balance from one is a client with a hole in it.
//
// FORWARD COMPATIBILITY IS AN ARM OF THE UNION, not a thrown error. A client meeting a message
// type it does not know renders a placeholder and keeps the thread readable; throwing would let
// one unknown message from a newer client break the whole conversation.
//
import { MAX_MESSAGE_BYTES } from './room.js'

export type RoomMessage =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'payment'
      /** Already formatted for display by the sender — the recipient does not re-derive scale. */
      readonly amount: string
      readonly symbol: string
      /** The token contract, so a recipient can tell two same-symbol tokens apart. */
      readonly token: string
      readonly transactionHash: string
      /** An optional note the sender attached to the payment. */
      readonly text?: string
    }
  | {
      /**
       * A post in an OPEN room — a token's Talk thread, where the key is publicly derivable
       * (`open-room.ts`) and everyone on the page reads everything. `name` is the poster's
       * CLAIMED directory handle, carried in the plaintext because an open room has no pairwise
       * key to authenticate a sender with: it is a byline, not a proof, and surfaces say so.
       */
      readonly kind: 'post'
      readonly text: string
      readonly name?: string
    }
  /** A message from a client that speaks a type this one does not. Rendered, never thrown. */
  | { readonly kind: 'unsupported'; readonly received: string }

/** The wire discriminators. Single letters: every byte here is inside the message size cap. */
const WIRE_KIND = { text: 't', payment: 'p', post: 'o' } as const

export function encodeRoomMessage(message: RoomMessage): string {
  switch (message.kind) {
    case 'text':
      return JSON.stringify({ k: WIRE_KIND.text, b: message.text })
    case 'payment':
      return JSON.stringify({
        k: WIRE_KIND.payment,
        a: message.amount,
        s: message.symbol,
        c: message.token,
        h: message.transactionHash,
        ...(message.text === undefined ? {} : { b: message.text }),
      })
    case 'post':
      return JSON.stringify({
        k: WIRE_KIND.post,
        b: message.text,
        ...(message.name === undefined ? {} : { n: message.name }),
      })
    case 'unsupported':
      // Re-encoding something we could not read would forward a payload we never validated. A
      // client that received an unsupported message has nothing to say back in its shape.
      throw new Error('an unsupported message cannot be re-encoded')
  }
}

/**
 * Read a decrypted payload, or say what could not be read.
 *
 * NEVER THROWS. Everything reaching here has already passed the authentication tag, so it came
 * from the other party — but "authentic" is not "well-formed", and a thread must survive a peer
 * on a different version.
 */
export function decodeRoomMessage(plaintext: string): RoomMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    // Not JSON at all. Earlier builds sent bare text; showing it is better than hiding it, and it
    // is already authenticated, so there is nothing unsafe about the string itself.
    return plaintext.length > 0 && plaintext.length <= MAX_MESSAGE_BYTES
      ? { kind: 'text', text: plaintext }
      : { kind: 'unsupported', received: 'unreadable' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'unsupported', received: typeof parsed }
  }

  const wire = parsed as Record<string, unknown>
  if (wire.k === WIRE_KIND.text && typeof wire.b === 'string' && wire.b.length > 0) {
    return { kind: 'text', text: wire.b }
  }
  if (
    wire.k === WIRE_KIND.payment &&
    typeof wire.a === 'string' &&
    typeof wire.s === 'string' &&
    typeof wire.c === 'string' &&
    typeof wire.h === 'string'
  ) {
    return {
      kind: 'payment',
      amount: wire.a,
      symbol: wire.s,
      token: wire.c,
      transactionHash: wire.h,
      ...(typeof wire.b === 'string' && wire.b.length > 0 ? { text: wire.b } : {}),
    }
  }
  if (wire.k === WIRE_KIND.post && typeof wire.b === 'string' && wire.b.length > 0) {
    return {
      kind: 'post',
      text: wire.b,
      ...(typeof wire.n === 'string' && wire.n.length > 0 ? { name: wire.n } : {}),
    }
  }
  return { kind: 'unsupported', received: typeof wire.k === 'string' ? wire.k : 'unknown' }
}
