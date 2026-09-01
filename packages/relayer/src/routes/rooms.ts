// /room/send and /room/stream — the ciphertext bus. Nothing here looks inside an envelope.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { isWireEnvelope } from '../rooms.js'
import { createSseSubscriber, isPlainObject, jsonError, notFound, readJson, reply } from './shared.js'

/** Rooms one stream may multiplex — past any real sidebar, below "a slot in every room". */
export const MAX_ROOMS_PER_STREAM = 32

/** The hub's refusals, mapped to what a client should be told and do. */
const ROOM_REFUSAL_STATUS: Record<string, number> = {
  'bad-room-id': 400,
  'bad-envelope': 400,
  'envelope-too-large': 413,
  'too-many-rooms': 503,
  'room-full': 503,
  'rate-limited': 429,
  // Nobody is attached, so there is nobody to tell. Not an error — the ordinary shape of a peer
  // whose tab is shut, and the client treats it as "they are not here" rather than as a failure.
  'no-room': 404,
}

/**
 * The ceiling on the sender hint a typing ping carries.
 *
 * It is a felt as hex — 66 characters at the very most — and this host does not read it, exactly
 * as it does not read `envelope.from`. The cap is here so the field cannot become a side channel
 * for shipping a payload through a route that skips the envelope size check.
 */
const MAX_FROM_CHARS = 70

/** The ceiling on a presence beacon id. The client mints 32 hex characters; this leaves headroom. */
const MAX_BEACON_ID_CHARS = 64

export const roomRoutes = new Hono<AppEnv>()

roomRoutes.use('*', async (c, next) => {
  if (!c.var.ctx.rooms) return notFound(c)
  await next()
})

roomRoutes.post('/send', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')
  const { room, envelope } = body.value
  if (typeof room !== 'string') return jsonError(c, 400, 'room must be a string')
  if (!isWireEnvelope(envelope)) return jsonError(c, 400, 'envelope must be {v:1, iv, ct, from}')

  // Re-serialised to exactly the four fields — nothing smuggled past a shape check.
  const wire = JSON.stringify({ v: 1, iv: envelope.iv, ct: envelope.ct, from: envelope.from })
  const result = c.var.ctx.rooms!.publish(room, wire)
  if (!result.ok) return jsonError(c, ROOM_REFUSAL_STATUS[result.reason] ?? 400, result.reason)
  // Sockets that took it, not readers — zero is the ordinary shape of a shut tab.
  return reply(c, 200, { delivered: result.delivered })
})

/**
 * "Someone in this room is typing" — fanned out now, kept nowhere.
 *
 * The recipient tells our ping from their own by `from`, the same public-key hint every envelope
 * already carries; this host neither reads it nor knows which socket sent it. A ping into a room
 * with no listeners answers 404 rather than opening one, which is `signal`'s rule, not this
 * route's — see `rooms.ts`.
 */
roomRoutes.post('/typing', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')
  const { room, from } = body.value
  if (typeof room !== 'string') return jsonError(c, 400, 'room must be a string')
  if (typeof from !== 'string' || from.length === 0 || from.length > MAX_FROM_CHARS) {
    return jsonError(c, 400, 'from must be a short string')
  }

  const result = c.var.ctx.rooms!.signal(room, JSON.stringify({ t: 'typing', room, from }))
  if (!result.ok) return jsonError(c, ROOM_REFUSAL_STATUS[result.reason] ?? 400, result.reason)
  return reply(c, 200, { delivered: result.delivered })
})

/**
 * "I still have these conversations open." The whole of presence, and the whole of departure.
 *
 * One request carries every room the caller is streaming, because that is exactly the set it
 * already declared on `/stream` — N separate beacons would tell this host the same N facts N
 * times. Each carries its OWN id: the client's presence tag for that room, which this host cannot
 * compute and must not try to interpret. Two ids being equal across rooms would be a fact about
 * the caller; the client is built so they never are, and nothing here relies on it either way.
 *
 * Rooms that refuse are simply left out of the answer. A beacon is a background heartbeat and its
 * caller has nothing useful to do with a partial failure.
 */
roomRoutes.post('/here', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')
  const { beacons } = body.value
  if (!Array.isArray(beacons)) return jsonError(c, 400, 'beacons must be an array')
  if (beacons.length === 0 || beacons.length > MAX_ROOMS_PER_STREAM) {
    return jsonError(c, 400, `beacons must name 1 to ${MAX_ROOMS_PER_STREAM} rooms`)
  }

  const present: Record<string, number> = {}
  for (const beacon of beacons) {
    if (!isPlainObject(beacon)) return jsonError(c, 400, 'each beacon must be {room, id}')
    const { room, id } = beacon
    if (typeof room !== 'string') return jsonError(c, 400, 'room must be a string')
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_BEACON_ID_CHARS) {
      return jsonError(c, 400, 'id must be a short string')
    }
    const result = c.var.ctx.rooms!.here(room, id)
    if (result.ok) present[room] = result.present
  }
  return reply(c, 200, { present })
})

roomRoutes.post('/stream', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  const parsed = body.value as { room?: unknown; rooms?: unknown } | null

  // `{room}` stays the wire shape every deployed client speaks; `{rooms}` multiplexes, deduped.
  let roomIds: string[]
  if (typeof parsed?.room === 'string') {
    roomIds = [parsed.room]
  } else if (Array.isArray(parsed?.rooms) && parsed.rooms.every((r): r is string => typeof r === 'string')) {
    roomIds = [...new Set(parsed.rooms)]
  } else {
    return jsonError(c, 400, 'room must be a string, or rooms an array of strings')
  }
  if (roomIds.length === 0) return jsonError(c, 400, 'rooms must name at least one room')
  if (roomIds.length > MAX_ROOMS_PER_STREAM) {
    return jsonError(c, 400, `at most ${MAX_ROOMS_PER_STREAM} rooms per stream`)
  }

  // Attached before the stream opens so a refusal is a plain JSON answer. All-or-nothing: the
  // first refusal detaches everything already attached and names the room.
  const subscriber = createSseSubscriber()
  const attachments: Array<{ history: readonly string[]; unsubscribe: () => void }> = []
  for (const id of roomIds) {
    const attached = c.var.ctx.rooms!.subscribe(id, subscriber)
    if (!attached.ok) {
      for (const a of attachments) a.unsubscribe()
      return jsonError(c, ROOM_REFUSAL_STATUS[attached.reason] ?? 400, attached.reason, { room: id })
    }
    attachments.push(attached)
  }

  // Backlog first, per room in subscription order, then live traffic on the same socket.
  for (const a of attachments) for (const payload of a.history) subscriber.deliver(payload)
  return subscriber.open(c, () => {
    for (const a of attachments) a.unsubscribe()
  })
})
