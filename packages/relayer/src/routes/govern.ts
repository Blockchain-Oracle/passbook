// POST /govern/tally-key — the Teller's one public door. Body ignored; only when Governance is writable.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { discardJson, jsonError, notFound, reply } from './shared.js'

export const governRoutes = new Hono<AppEnv>()

governRoutes.post('/tally-key', async (c) => {
  const teller = c.var.ctx.teller
  if (!teller) return notFound(c)
  await discardJson(c)
  try {
    const publicX = teller.mintKey()
    return reply(c, 200, { tallyKey: `0x${publicX.toString(16)}` })
  } catch (e) {
    console.warn(`relayer: teller ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the tally key could not be recorded; refusing to hand one out')
  }
})
