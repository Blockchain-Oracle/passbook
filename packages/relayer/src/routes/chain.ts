// POST /chain/stream — one poller for every tab. Body must be exactly `{}`; hello first, then deltas.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { createSseSubscriber, isPlainObject, jsonError, notFound, readJson } from './shared.js'

export const chainRoutes = new Hono<AppEnv>()

chainRoutes.post('/stream', async (c) => {
  const feed = c.var.ctx.chainFeed
  if (!feed) return notFound(c)

  const body = await readJson(c)
  if (!body.ok) return body.res
  // Exactly `{}`: a body that names something speaks a wire this server does not.
  if (!isPlainObject(body.value) || Object.keys(body.value).length !== 0) {
    return jsonError(c, 400, 'the chain stream takes an empty JSON object')
  }

  const subscriber = createSseSubscriber()
  const attached = feed.subscribe(subscriber)
  // Full is a 503 the browser treats as "poll for yourself" — degraded, never locked.
  if (!attached.ok) return jsonError(c, 503, 'the feed is at capacity')

  // The hello carries the whole state; live deltas ride the same socket.
  subscriber.deliver(attached.hello)
  return subscriber.open(c, attached.unsubscribe)
})
