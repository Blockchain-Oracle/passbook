// POST /chain/stream — one poller for every tab. Body must be exactly `{}`; hello first, then deltas.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { createSseSubscriber, isPlainObject, jsonError, notFound, readJson, reply } from './shared.js'

export const chainRoutes = new Hono<AppEnv>()

/**
 * GET /chain/gas — what a proven pool transaction has actually been costing, in gas units.
 *
 * A read with nothing private in it: these are `execution_resources` off receipts anyone can fetch,
 * aggregated so a browser does not have to make twenty RPC calls to learn one number. Absent until
 * the first sample lands, and absent is not zero — the client falls back to its own constant rather
 * than believing a proven transaction is free.
 */
chainRoutes.get('/gas', (c) => {
  const measured = c.var.ctx.gasCalibration?.current()
  if (!measured) return notFound(c)
  return reply(c, 200, {
    // Strings, not bigints: this has to survive JSON.stringify like every other wire value here.
    l2Gas: measured.l2Gas.toString(),
    l1Gas: measured.l1Gas.toString(),
    l1DataGas: measured.l1DataGas.toString(),
    samples: measured.samples,
    at: measured.at,
  })
})

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
