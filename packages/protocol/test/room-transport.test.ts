import { describe, it, expect, vi } from 'vitest'

import {
  roomEndpoint, sendEnvelope, openRoomStream, type RoomStreamState,
} from '../src/room-transport.js'
import type { RoomEnvelope } from '../src/room.js'

const ROOM = 'a'.repeat(32)

function envelope(iv: string, ct = 'ZmFrZQ=='): RoomEnvelope {
  return { v: 1, iv, ct, from: '0x1' }
}

/** A stream whose chunks this test controls, so a frame can be split anywhere. */
function chunkedStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const streamResponse = (chunks: string[]) =>
  ({ ok: true, status: 200, body: chunkedStream(chunks) }) as unknown as Response

/** Poll until `predicate` holds, so a test never depends on how many microtasks a read takes. */
async function until(predicate: () => boolean, ms = 2_000) {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the stream')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('roomEndpoint', () => {
  it('derives both leaves from the relayer URL the app already holds', () => {
    expect(roomEndpoint('/api/submit', 'send')).toBe('/api/room/send')
    expect(roomEndpoint('/api/submit', 'stream')).toBe('/api/room/stream')
    expect(roomEndpoint('http://127.0.0.1:8787/submit', 'send')).toBe('http://127.0.0.1:8787/room/send')
  })

  it('refuses a URL it cannot derive from, rather than posting at the submit path', () => {
    expect(() => roomEndpoint('/api/relay', 'send')).toThrow(/does not end in \/submit/)
  })
})

describe('sendEnvelope', () => {
  it('posts the room and the envelope, and reports the delivery count', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ delivered: 2 }) }) as unknown as Response,
    )
    const result = await sendEnvelope(ROOM, envelope('iv1'), { fetch: fetchImpl })

    expect(result).toEqual({ ok: true, delivered: 2 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/room/send')
    expect(JSON.parse(String(init.body))).toEqual({ room: ROOM, envelope: envelope('iv1') })
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  //
  // The case a naive client gets wrong. Nobody listening is the ordinary shape of an
  // asynchronous conversation, not a send that failed.
  //
  it('treats delivered:0 as a success', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ delivered: 0 }) }) as unknown as Response,
    )
    expect(await sendEnvelope(ROOM, envelope('iv1'), { fetch: fetchImpl })).toEqual({
      ok: true,
      delivered: 0,
    })
  })

  it('surfaces the relayer’s own refusal name', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 429, json: async () => ({ error: 'rate-limited' }) }) as unknown as Response,
    )
    expect(await sendEnvelope(ROOM, envelope('iv1'), { fetch: fetchImpl })).toEqual({
      ok: false,
      failure: { kind: 'refused', status: 429, reason: 'rate-limited' },
    })
  })

  it('falls back to the status when something that is not the relayer answered', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 502, json: async () => { throw new Error('not JSON') } }) as unknown as Response,
    )
    const result = await sendEnvelope(ROOM, envelope('iv1'), { fetch: fetchImpl })
    expect(result).toEqual({ ok: false, failure: { kind: 'refused', status: 502, reason: 'HTTP 502' } })
  })

  it('reports an unreachable host as retryable rather than as a refusal', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const result = await sendEnvelope(ROOM, envelope('iv1'), { fetch: fetchImpl })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unreachable')
  })
})

describe('openRoomStream', () => {
  it('delivers envelopes and reports going live', async () => {
    const received: RoomEnvelope[] = []
    const states: RoomStreamState[] = []
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        `data: ${JSON.stringify(envelope('iv1'))}\n\n`,
        `data: ${JSON.stringify(envelope('iv2'))}\n\n`,
      ]),
    )

    const handle = openRoomStream({
      room: ROOM,
      onEnvelope: (e) => received.push(e),
      onState: (s) => states.push(s),
      deps: { fetch: fetchImpl },
    })
    await until(() => received.length === 2)
    handle.close()

    expect(received.map((e) => e.iv)).toEqual(['iv1', 'iv2'])
    expect(states.slice(0, 2)).toEqual(['connecting', 'live'])
  })

  //
  // The bug this exists to catch: splitting a chunk on the frame separator without keeping the
  // remainder eats whatever straddled the boundary — which on a slow link is the long messages.
  //
  it('reassembles a frame split across chunk boundaries', async () => {
    const received: RoomEnvelope[] = []
    const whole = `data: ${JSON.stringify(envelope('iv-split'))}\n\n`
    const fetchImpl = vi.fn(async () =>
      streamResponse([whole.slice(0, 12), whole.slice(12, 30), whole.slice(30)]),
    )

    const handle = openRoomStream({ room: ROOM, onEnvelope: (e) => received.push(e), deps: { fetch: fetchImpl } })
    await until(() => received.length === 1)
    handle.close()
    expect(received[0]!.iv).toBe('iv-split')
  })

  it('ignores heartbeats and anything that is not JSON', async () => {
    const received: RoomEnvelope[] = []
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        ': hb\n\n',
        'data: not json at all\n\n',
        `data: ${JSON.stringify({ v: 1, iv: 'x' })}\n\n`,
        `data: ${JSON.stringify(envelope('iv-good'))}\n\n`,
      ]),
    )

    const handle = openRoomStream({ room: ROOM, onEnvelope: (e) => received.push(e), deps: { fetch: fetchImpl } })
    await until(() => received.length === 1)
    handle.close()
    expect(received.map((e) => e.iv)).toEqual(['iv-good'])
  })

  //
  // Every reconnect replays the relayer's backlog. Without de-duplication a flaky network renders
  // the same message once per drop, which is the most visible possible transport bug.
  //
  it('does not re-deliver a message the backlog replays after a reconnect', async () => {
    const received: RoomEnvelope[] = []
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      return call === 1
        ? streamResponse([`data: ${JSON.stringify(envelope('iv1'))}\n\n`])
        : streamResponse([
            `data: ${JSON.stringify(envelope('iv1'))}\n\n`,
            `data: ${JSON.stringify(envelope('iv2'))}\n\n`,
          ])
    })

    const handle = openRoomStream({ room: ROOM, onEnvelope: (e) => received.push(e), deps: { fetch: fetchImpl } })
    await until(() => received.length === 2, 5_000)
    handle.close()
    expect(received.map((e) => e.iv)).toEqual(['iv1', 'iv2'])
  })

  it('keeps reconnecting after a refusal, and says it is retrying', async () => {
    const received: RoomEnvelope[] = []
    const states: RoomStreamState[] = []
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call += 1
      if (call === 1) return { ok: false, status: 503, body: null } as unknown as Response
      return streamResponse([`data: ${JSON.stringify(envelope('after-retry'))}\n\n`])
    })

    const handle = openRoomStream({
      room: ROOM,
      onEnvelope: (e) => received.push(e),
      onState: (s) => states.push(s),
      deps: { fetch: fetchImpl },
    })
    await until(() => received.length === 1, 5_000)
    handle.close()

    expect(received[0]!.iv).toBe('after-retry')
    // connecting → refused → retrying → live. The tail is deliberately not asserted: this fake
    // stream ENDS after its last chunk, which is a dropped connection as far as the loop is
    // concerned, so it correctly goes back to 'retrying'. A real stream does not end.
    expect(states.slice(0, 2)).toEqual(['connecting', 'retrying'])
    expect(states).toContain('live')
  })

  it('stops reconnecting once closed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const handle = openRoomStream({ room: ROOM, onEnvelope: () => {}, deps: { fetch: fetchImpl } })
    await until(() => fetchImpl.mock.calls.length >= 1)
    handle.close()

    const after = fetchImpl.mock.calls.length
    await new Promise((r) => setTimeout(r, 700))
    // At most the attempt that was already in flight when close() landed.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(after + 1)
  })
})
