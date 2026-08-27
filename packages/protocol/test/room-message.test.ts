import { describe, it, expect } from 'vitest'

import { decodeRoomMessage, encodeRoomMessage, type RoomMessage } from '../src/room-message.js'
import { MAX_MESSAGE_BYTES } from '../src/room.js'

const PAYMENT: RoomMessage = {
  kind: 'payment',
  amount: '5.00',
  symbol: 'USDC',
  token: '0x33068f6',
  transactionHash: '0xabc',
}

describe('round trips', () => {
  it('carries a text message', () => {
    expect(decodeRoomMessage(encodeRoomMessage({ kind: 'text', text: 'hello' }))).toEqual({
      kind: 'text',
      text: 'hello',
    })
  })

  it('carries a payment card, with and without a note', () => {
    expect(decodeRoomMessage(encodeRoomMessage(PAYMENT))).toEqual(PAYMENT)
    const withNote = { ...PAYMENT, text: 'for lunch' }
    expect(decodeRoomMessage(encodeRoomMessage(withNote))).toEqual(withNote)
  })

  it('keeps unicode intact', () => {
    const text = '¥1,000 送金しました 🔐'
    expect(decodeRoomMessage(encodeRoomMessage({ kind: 'text', text }))).toEqual({ kind: 'text', text })
  })

  it('stays comfortably inside the envelope cap for a full-length message', () => {
    const text = 'x'.repeat(MAX_MESSAGE_BYTES - 100)
    expect(encodeRoomMessage({ kind: 'text', text }).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES)
  })
})

describe('a peer on another version', () => {
  it('renders an unknown kind as a placeholder rather than breaking the thread', () => {
    const result = decodeRoomMessage(JSON.stringify({ k: 'z', b: 'from the future' }))
    expect(result).toEqual({ kind: 'unsupported', received: 'z' })
  })

  it('treats a bare string as text — earlier builds sent one', () => {
    expect(decodeRoomMessage('just text')).toEqual({ kind: 'text', text: 'just text' })
  })

  it('never throws on anything it is handed', () => {
    for (const junk of ['', '{', 'null', '7', '[]', '{"k":"p"}', '{"k":"t"}', '{"k":"t","b":""}']) {
      expect(() => decodeRoomMessage(junk)).not.toThrow()
      expect(decodeRoomMessage(junk).kind).not.toBe(undefined)
    }
  })

  it('refuses a partial payment card rather than rendering a payment with holes', () => {
    // Missing the transaction hash: the one field that makes the card checkable.
    const result = decodeRoomMessage(JSON.stringify({ k: 'p', a: '5', s: 'USDC', c: '0x1' }))
    expect(result.kind).toBe('unsupported')
  })

  it('refuses to re-encode something it could not read', () => {
    expect(() => encodeRoomMessage({ kind: 'unsupported', received: 'z' })).toThrow(/cannot be re-encoded/)
  })
})
