import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { createRelayerServer, type RelayerServerOptions, type SubmitCalls } from '../src/server.js'
import { RoomHub } from '../src/rooms.js'

const ROOM = 'a'.repeat(32)
const OTHER_ROOM = 'b'.repeat(32)
const ENVELOPE = { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZQ==', from: '0x1' }

/** Never called: no test here submits anything, and a room route that signs is a bug. */
const NEVER_SUBMIT = vi.fn<SubmitCalls>(async () => {
  throw new Error('a room route must never reach the signer')
})

const running: Array<() => Promise<void>> = []

afterEach(async () => {
  while (running.length > 0) await running.pop()!()
  NEVER_SUBMIT.mockClear()
})

async function start(extra: Partial<RelayerServerOptions> = {}) {
  const server = createRelayerServer({
    submit: NEVER_SUBMIT,
    resolveApproveCeiling: async () => 0n,
    rooms: new RoomHub(),
    ...extra,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  running.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return port
}

function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    req.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

/**
 * Open a stream and keep it open, collecting `data:` payloads as they arrive.
 *
 * The one thing this harness must not do is wait for the response to END — that is the whole
 * point of the route, and a test written with the ordinary request helper above would hang until
 * its timeout and then report a transport bug that does not exist.
 */
function openStream(port: number, room: string, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const events: string[] = []
  let status = 0
  let raw = ''
  const req = http.request({ host: '127.0.0.1', port, path: '/room/stream', method: 'POST', headers }, (res) => {
    status = res.statusCode ?? 0
    res.on('data', (chunk) => {
      raw += String(chunk)
      // SSE frames end with a blank line. Split on it and keep any partial frame for the next
      // chunk — a stream test that assumes one write is one frame passes by luck.
      const frames = raw.split('\n\n')
      raw = frames.pop() ?? ''
      for (const frame of frames) {
        if (frame.startsWith('data: ')) events.push(frame.slice('data: '.length))
      }
    })
  })
  // `close()` below destroys this request on purpose — that is the disconnect under test — and a
  // destroyed client request emits ECONNRESET. Unhandled, it surfaces as an uncaught exception
  // attributed to whatever test happened to be running.
  req.on('error', () => {})
  req.end(JSON.stringify({ room }))

  return {
    events,
    get status() {
      return status
    },
    /** Resolve once `count` payloads have landed, or reject rather than hang forever. */
    async waitFor(count: number, ms = 2_000) {
      const deadline = Date.now() + ms
      while (events.length < count) {
        if (Date.now() > deadline) throw new Error(`only ${events.length} of ${count} events arrived`)
        await new Promise((r) => setTimeout(r, 10))
      }
    },
    close() {
      req.destroy()
    },
  }
}

/** Give the server a moment to notice a socket that was just destroyed. */
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('the room routes, behind the same gates as everything else', () => {
  it('404s both routes on a relayer configured with no hub', async () => {
    const port = await start({ rooms: undefined })
    expect((await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })).status).toBe(404)
    expect((await post(port, '/room/stream', { room: ROOM })).status).toBe(404)
  })

  it('refuses without the content-type that separates a web page from this port', async () => {
    const port = await start()
    const res = await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE }, { 'content-type': 'text/plain' })
    expect(res.status).toBe(415)
  })

  it('refuses without the auth token when one is configured', async () => {
    const port = await start({ authToken: 'the-secret' })
    expect((await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })).status).toBe(401)
    expect((await post(port, '/room/stream', { room: ROOM })).status).toBe(401)

    const allowed = await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE }, {
      'content-type': 'application/json',
      'x-relayer-auth': 'the-secret',
    })
    expect(allowed.status).toBe(200)
  })

  it('refuses a cross-origin caller', async () => {
    const port = await start()
    const res = await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE }, {
      'content-type': 'application/json',
      origin: 'https://not-us.example',
    })
    expect(res.status).toBe(403)
  })

  it('answers both path spellings, so a proxy rewrite is not required', async () => {
    const port = await start()
    expect((await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })).status).toBe(200)
    expect((await post(port, '/api/room/send', { room: ROOM, envelope: ENVELOPE })).status).toBe(200)
  })

  it('never reaches the signer', async () => {
    const port = await start()
    await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })
    expect(NEVER_SUBMIT).not.toHaveBeenCalled()
  })
})

describe('POST /room/send', () => {
  it('rejects a body that is not an object, a bad room, or a non-envelope', async () => {
    const port = await start()
    expect((await post(port, '/room/send', '7')).status).toBe(400)
    expect((await post(port, '/room/send', { envelope: ENVELOPE })).status).toBe(400)
    expect((await post(port, '/room/send', { room: 'nope', envelope: ENVELOPE })).status).toBe(400)
    expect((await post(port, '/room/send', { room: ROOM, envelope: { v: 2 } })).status).toBe(400)
  })

  it('reports how many sockets took it, and zero is not an error', async () => {
    const port = await start()
    const res = await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ delivered: 0 })
  })

  it('forwards only the four envelope fields, never whatever else was in the body', async () => {
    const port = await start()
    const stream = openStream(port, ROOM)
    await settle()

    await post(port, '/room/send', {
      room: ROOM,
      envelope: { ...ENVELOPE, smuggled: 'x'.repeat(500), from: '0x1' },
    })
    await stream.waitFor(1)
    expect(JSON.parse(stream.events[0]!)).toEqual(ENVELOPE)
    stream.close()
  })
})

describe('POST /room/stream', () => {
  it('delivers a live message to a subscriber', async () => {
    const port = await start()
    const stream = openStream(port, ROOM)
    await settle()

    const sent = await post(port, '/room/send', { room: ROOM, envelope: ENVELOPE })
    expect(JSON.parse(sent.body)).toEqual({ delivered: 1 })

    await stream.waitFor(1)
    expect(JSON.parse(stream.events[0]!)).toEqual(ENVELOPE)
    expect(stream.status).toBe(200)
    stream.close()
  })

  it('replays the backlog on subscribe, then keeps going on the same socket', async () => {
    const port = await start()
    await post(port, '/room/send', { room: ROOM, envelope: { ...ENVELOPE, ct: 'b25l' } })
    await post(port, '/room/send', { room: ROOM, envelope: { ...ENVELOPE, ct: 'dHdv' } })

    const stream = openStream(port, ROOM)
    await stream.waitFor(2)
    await settle()
    await post(port, '/room/send', { room: ROOM, envelope: { ...ENVELOPE, ct: 'dGhyZWU=' } })
    await stream.waitFor(3)

    expect(stream.events.map((e) => JSON.parse(e).ct)).toEqual(['b25l', 'dHdv', 'dGhyZWU='])
    stream.close()
  })

  it('does not leak a message into another room', async () => {
    const port = await start()
    const stream = openStream(port, ROOM)
    await settle()
    await post(port, '/room/send', { room: OTHER_ROOM, envelope: ENVELOPE })
    await settle()
    expect(stream.events).toEqual([])
    stream.close()
  })

  it('drops the subscriber when its socket goes away', async () => {
    const hub = new RoomHub()
    const port = await start({ rooms: hub })
    const stream = openStream(port, ROOM)
    await settle()
    expect(hub.stats().subscribers).toBe(1)

    stream.close()
    await settle()
    expect(hub.stats().subscribers).toBe(0)
    // And the room's history survives the disconnect — that is what it is for.
    expect(hub.stats().rooms).toBe(1)
  })

  it('rejects a stream request with no room', async () => {
    const port = await start()
    expect((await post(port, '/room/stream', {})).status).toBe(400)
  })
})
