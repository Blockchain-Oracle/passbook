// /directory/{claim,list,avatar} — the opt-in name directory. Validation and the 400/403/409/413/
// 502/503 outcomes live in directory.ts; the route only maps them to responses.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { discardJson, jsonError, notFound, readJson, reply } from './shared.js'

export const directoryRoutes = new Hono<AppEnv>()

directoryRoutes.use('*', async (c, next) => {
  if (!c.var.ctx.directory) return notFound(c)
  await next()
})

directoryRoutes.post('/claim', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  try {
    const outcome = await c.var.ctx.directory!.claim(body.value)
    return outcome.ok ? reply(c, 200, { ok: true }) : jsonError(c, outcome.status, outcome.error)
  } catch (e) {
    console.warn(`relayer: directory ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the directory could not be written; the claim was not recorded')
  }
})

// A list takes no arguments ON PURPOSE: a search here would tell this process who looks for whom.
directoryRoutes.post('/list', async (c) => {
  await discardJson(c)
  return reply(c, 200, { entries: c.var.ctx.directory!.list() })
})

directoryRoutes.post('/avatar', async (c) => {
  const body = await readJson(c)
  if (!body.ok) return body.res
  const address = (body.value as { address?: unknown } | null)?.address
  return reply(c, 200, { avatar: c.var.ctx.directory!.avatar(address) })
})
