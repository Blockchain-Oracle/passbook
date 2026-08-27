import { describe, it, expect } from 'vitest'

import {
  RoomHub, isWireEnvelope, MAX_ENVELOPE_BYTES, MAX_PUBLISH_PER_MINUTE,
  MAX_ROOMS, MAX_SUBSCRIBERS_PER_ROOM, ROOM_HISTORY, ROOM_IDLE_MS,
} from '../src/rooms.js'

/** A room id of the shape `protocol/src/room.ts` derives: 32 lowercase hex characters. */
function roomId(seed: string): string {
  return seed.padEnd(32, '0').slice(0, 32)
}

const ROOM = roomId('abc123')

/** A listener that records what it was handed, and can be told to break like a dead socket. */
function listener() {
  const received: string[] = []
  let ended = false
  let broken = false
  return {
    received,
    get ended() {
      return ended
    },
    break() {
      broken = true
    },
    deliver(payload: string) {
      if (broken) throw new Error('socket is gone')
      received.push(payload)
    },
    end() {
      ended = true
    },
  }
}

const ENVELOPE = JSON.stringify({ v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZQ==', from: '0x1' })

describe('fan-out', () => {
  it('delivers a published envelope to every subscriber', () => {
    const hub = new RoomHub()
    const a = listener()
    const b = listener()
    hub.subscribe(ROOM, a)
    hub.subscribe(ROOM, b)

    expect(hub.publish(ROOM, ENVELOPE)).toEqual({ ok: true, delivered: 2 })
    expect(a.received).toEqual([ENVELOPE])
    expect(b.received).toEqual([ENVELOPE])
  })

  it('does not deliver into a different room', () => {
    const hub = new RoomHub()
    const a = listener()
    hub.subscribe(ROOM, a)
    hub.publish(roomId('ffff'), ENVELOPE)
    expect(a.received).toEqual([])
  })

  it('accepts a publish into a room nobody is listening to', () => {
    // The ordinary shape of "their tab is shut". Refusing here would lose exactly the messages
    // the history buffer exists to hold.
    const hub = new RoomHub()
    expect(hub.publish(ROOM, ENVELOPE)).toEqual({ ok: true, delivered: 0 })
    const late = listener()
    const result = hub.subscribe(ROOM, late)
    expect(result.ok && result.history).toEqual([ENVELOPE])
  })

  it('drops a broken subscriber without failing the fan-out for the others', () => {
    const hub = new RoomHub()
    const dead = listener()
    const alive = listener()
    hub.subscribe(ROOM, dead)
    hub.subscribe(ROOM, alive)
    dead.break()

    expect(hub.publish(ROOM, ENVELOPE)).toEqual({ ok: true, delivered: 1 })
    expect(alive.received).toEqual([ENVELOPE])
    // And it is gone for good, not retried on every subsequent message.
    expect(hub.publish(ROOM, ENVELOPE)).toEqual({ ok: true, delivered: 1 })
    expect(hub.stats().subscribers).toBe(1)
  })

  it('stops delivering after unsubscribe but keeps the history', () => {
    const hub = new RoomHub()
    const a = listener()
    const result = hub.subscribe(ROOM, a)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    hub.publish(ROOM, ENVELOPE)
    result.unsubscribe()
    hub.publish(ROOM, ENVELOPE)
    expect(a.received).toHaveLength(1)

    const rejoin = listener()
    const second = hub.subscribe(ROOM, rejoin)
    expect(second.ok && second.history).toHaveLength(2)
  })
})

describe('history', () => {
  it('keeps only the most recent ROOM_HISTORY envelopes', () => {
    const hub = new RoomHub()
    for (let i = 0; i < ROOM_HISTORY + 10; i += 1) hub.publish(ROOM, `${i}`)

    const late = listener()
    const result = hub.subscribe(ROOM, late)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.history).toHaveLength(ROOM_HISTORY)
    expect(result.history[0]).toBe('10')
    expect(result.history.at(-1)).toBe(`${ROOM_HISTORY + 9}`)
  })

  it('hands a joiner a copy, so a later publish cannot mutate what it was given', () => {
    const hub = new RoomHub()
    hub.publish(ROOM, ENVELOPE)
    const result = hub.subscribe(ROOM, listener())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const handed = result.history
    hub.publish(ROOM, ENVELOPE)
    expect(handed).toHaveLength(1)
  })
})

describe('the limits, each of which is a refusal', () => {
  it('refuses a room id that is not the derived shape', () => {
    const hub = new RoomHub()
    for (const bad of ['', 'short', 'A'.repeat(32), `${'a'.repeat(31)}g`, 'a'.repeat(33), '../etc']) {
      expect(hub.publish(bad, ENVELOPE)).toEqual({ ok: false, reason: 'bad-room-id' })
      expect(hub.subscribe(bad, listener())).toEqual({ ok: false, reason: 'bad-room-id' })
    }
    expect(hub.stats().rooms).toBe(0)
  })

  it('refuses an envelope over the byte cap', () => {
    const hub = new RoomHub()
    const huge = 'x'.repeat(MAX_ENVELOPE_BYTES + 1)
    expect(hub.publish(ROOM, huge)).toEqual({ ok: false, reason: 'envelope-too-large' })
    // Measured in BYTES, not characters: a multi-byte payload under the character count is still
    // over the cap, which is the case a `.length` check would wave through.
    const multibyte = '€'.repeat(MAX_ENVELOPE_BYTES / 2)
    expect(hub.publish(ROOM, multibyte)).toEqual({ ok: false, reason: 'envelope-too-large' })
  })

  it('refuses an empty envelope', () => {
    expect(new RoomHub().publish(ROOM, '')).toEqual({ ok: false, reason: 'bad-envelope' })
  })

  it('rate-limits publishes into one room', () => {
    let now = 1_000_000
    const hub = new RoomHub(() => now)
    for (let i = 0; i < MAX_PUBLISH_PER_MINUTE; i += 1) {
      expect(hub.publish(ROOM, ENVELOPE).ok).toBe(true)
    }
    expect(hub.publish(ROOM, ENVELOPE)).toEqual({ ok: false, reason: 'rate-limited' })

    // The window rolls rather than resetting on the minute — a caller cannot bank a burst by
    // waiting for a clock boundary.
    now += 60_001
    expect(hub.publish(ROOM, ENVELOPE).ok).toBe(true)
  })

  it('caps subscribers on one room', () => {
    const hub = new RoomHub()
    for (let i = 0; i < MAX_SUBSCRIBERS_PER_ROOM; i += 1) {
      expect(hub.subscribe(ROOM, listener()).ok).toBe(true)
    }
    expect(hub.subscribe(ROOM, listener())).toEqual({ ok: false, reason: 'room-full' })
  })

  it('caps how many rooms can exist at once, from either door', () => {
    const hub = new RoomHub()
    for (let i = 0; i < MAX_ROOMS; i += 1) {
      expect(hub.publish(roomId(`b${i.toString(16).padStart(7, '0')}`), ENVELOPE).ok).toBe(true)
    }
    expect(hub.publish(roomId('ffffffff'), ENVELOPE)).toEqual({ ok: false, reason: 'too-many-rooms' })
    expect(hub.subscribe(roomId('ffffffff'), listener())).toEqual({ ok: false, reason: 'too-many-rooms' })
  })
})

describe('the idle sweep — the retention claim, enforced', () => {
  it('drops an idle room, its history and its listeners', () => {
    let now = 1_000_000
    const hub = new RoomHub(() => now)
    const a = listener()
    hub.subscribe(ROOM, a)
    hub.publish(ROOM, ENVELOPE)
    expect(hub.stats()).toEqual({ rooms: 1, subscribers: 1, buffered: 1 })

    now += ROOM_IDLE_MS - 1
    expect(hub.sweep()).toBe(0)

    now += 2
    expect(hub.sweep()).toBe(1)
    expect(hub.stats()).toEqual({ rooms: 0, subscribers: 0, buffered: 0 })
    expect(a.ended).toBe(true)
  })

  it('does not expire a room that is still being used', () => {
    let now = 1_000_000
    const hub = new RoomHub(() => now)
    hub.subscribe(ROOM, listener())
    for (let i = 0; i < 5; i += 1) {
      now += ROOM_IDLE_MS - 1_000
      hub.publish(ROOM, ENVELOPE)
    }
    now += 1_000
    expect(hub.sweep()).toBe(0)
    expect(hub.stats().rooms).toBe(1)
  })

  it('frees room slots, so the cap is a concurrency limit and not a lifetime one', () => {
    let now = 1_000_000
    const hub = new RoomHub(() => now)
    for (let i = 0; i < MAX_ROOMS; i += 1) {
      hub.publish(roomId(`b${i.toString(16).padStart(7, '0')}`), ENVELOPE)
    }
    now += ROOM_IDLE_MS + 1
    expect(hub.publish(roomId('ffffffff'), ENVELOPE).ok).toBe(true)
    expect(hub.stats().rooms).toBe(1)
  })
})

describe('wire narrowing', () => {
  it('accepts an envelope shape and rejects everything else', () => {
    expect(isWireEnvelope({ v: 1, iv: 'a', ct: 'b', from: '0x1' })).toBe(true)
    for (const junk of [
      null, undefined, 7, 'string', [], {},
      { v: 2, iv: 'a', ct: 'b', from: '0x1' },
      { v: 1, iv: 1, ct: 'b', from: '0x1' },
      { v: 1, iv: 'a', ct: 'b' },
    ]) {
      expect(isWireEnvelope(junk)).toBe(false)
    }
  })
})
