//
// What a memo says, once opened. The note it rides with is the money — so no body kind carries
// an amount that "was sent": the pool has already said it. What a body can carry is words, a
// request for money, a finished bet as its share DTO, or a voter handle — each a CLAIM the
// reader's client checks in its own words.
//

import { parsePositionShare, type PositionShare } from './position-share.js'
import { MAX_MAIL_PLAINTEXT_BYTES } from './mail-envelope.js'

export type MailBody =
  | { readonly kind: 'text'; readonly text: string }
  /** "Please send me this much." Nothing moved; the reader gets a button seeded with it. */
  | { readonly kind: 'request'; readonly amount: string; readonly symbol: string; readonly token: string; readonly text?: string }
  /**
   * A VOTER HANDLE, offered so somebody can delegate their weight to you. Handles are derived per
   * contract and cannot be looked up, so they have to be handed over; a card gives the reader a
   * button instead of a felt to copy by eye. Public by nature — the roll carries it already.
   */
  | { readonly kind: 'handle'; readonly handle: string; readonly houseId: number; readonly houseName?: string; readonly text?: string }
  /**
   * A MARKET POSITION as its share DTO and nothing more. The reader's client checks the named
   * transaction against the chain; matching evidence proves the bet happened, never who placed it.
   */
  | { readonly kind: 'market'; readonly share: PositionShare; readonly text?: string }
  /** A body from a client that speaks a kind this one does not. Rendered, never thrown. */
  | { readonly kind: 'unsupported'; readonly received: string }

/** Single-letter wire discriminators: every byte is inside the ciphertext bound. */
const WIRE = { text: 't', request: 'r', handle: 'h', market: 'm' } as const

const withText = (text: string | undefined) => (text === undefined || text.length === 0 ? {} : { b: text })

export function encodeMailBody(body: MailBody): Uint8Array {
  let wire: Record<string, unknown>
  switch (body.kind) {
    case 'text':
      wire = { k: WIRE.text, b: body.text }
      break
    case 'request':
      wire = { k: WIRE.request, a: body.amount, s: body.symbol, c: body.token, ...withText(body.text) }
      break
    case 'handle':
      wire = { k: WIRE.handle, h: body.handle, i: body.houseId, ...(body.houseName ? { n: body.houseName } : {}), ...withText(body.text) }
      break
    case 'market':
      wire = { k: WIRE.market, s: body.share, ...withText(body.text) }
      break
    case 'unsupported':
      throw new Error('an unsupported body cannot be re-encoded: it was never understood')
  }
  return new TextEncoder().encode(JSON.stringify(wire))
}

/** Bytes a body will occupy sealed, before the tag — what the composer counts against. */
export function mailBodyBytes(body: MailBody): number {
  return encodeMailBody(body).length
}

export function mailBodyFits(body: MailBody): boolean {
  return mailBodyBytes(body) <= MAX_MAIL_PLAINTEXT_BYTES
}

const optionalText = (b: unknown) => (typeof b === 'string' && b.length > 0 ? { text: b } : {})

/** Never throws: a body this client cannot read is `unsupported`, not an exception in a list. */
export function decodeMailBody(plaintext: Uint8Array): MailBody {
  let wire: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'unsupported', received: 'not-an-object' }
    wire = parsed as Record<string, unknown>
  } catch {
    return { kind: 'unsupported', received: 'not-json' }
  }
  if (wire.k === WIRE.text && typeof wire.b === 'string') return { kind: 'text', text: wire.b }
  if (wire.k === WIRE.request && typeof wire.a === 'string' && typeof wire.s === 'string' && typeof wire.c === 'string') {
    return { kind: 'request', amount: wire.a, symbol: wire.s, token: wire.c, ...optionalText(wire.b) }
  }
  if (wire.k === WIRE.handle && typeof wire.h === 'string' && wire.h.length > 0 && typeof wire.i === 'number' && Number.isInteger(wire.i) && wire.i >= 0) {
    return {
      kind: 'handle',
      handle: wire.h,
      houseId: wire.i,
      ...(typeof wire.n === 'string' && wire.n.length > 0 ? { houseName: wire.n } : {}),
      ...optionalText(wire.b),
    }
  }
  if (wire.k === WIRE.market) {
    const share = parsePositionShare(wire.s)
    return share ? { kind: 'market', share, ...optionalText(wire.b) } : { kind: 'unsupported', received: 'market' }
  }
  return { kind: 'unsupported', received: typeof wire.k === 'string' ? wire.k : 'unknown' }
}
