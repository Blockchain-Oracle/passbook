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
}

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
