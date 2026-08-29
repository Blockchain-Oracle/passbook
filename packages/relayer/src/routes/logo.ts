// /logo/{pin,generate} — delegates to logo.ts's handlers, which still speak (req, res, send).
// No key, no route: each leaf 404s unless its credential is configured.
import { Hono } from 'hono'
import type { ServerResponse } from 'node:http'

import type { AppEnv } from '../context.js'
import { handleLogoGenerate, handleLogoPin } from '../logo.js'
import { notFound, readJson, reply, visitorOf, type Ctx } from './shared.js'

type LogoHandler = typeof handleLogoPin

/** The handlers only ever pass req/res to `send`, so a stand-in is safe; capture the answer. */
async function viaLegacyHandler(c: Ctx, handler: LogoHandler): Promise<Response> {
  const ctx = c.var.ctx
  const body = await readJson(c)
  if (!body.ok) return body.res
  let answer: { status: number; body: unknown } = { status: 500, body: { error: 'internal error' } }
  await handler(
    undefined as never,
    undefined as unknown as ServerResponse,
    ctx.logos!,
    visitorOf(c, ctx.visitorSalt),
    body.value,
    (_res, status, payload) => {
      answer = { status, body: payload }
    },
  )
  return reply(c, answer.status, answer.body)
}

export const logoRoutes = new Hono<AppEnv>()

logoRoutes.post('/pin', (c) => {
  if (!c.var.ctx.logos?.pinataJwt) return notFound(c)
  return viaLegacyHandler(c, handleLogoPin)
})

logoRoutes.post('/generate', (c) => {
  if (!c.var.ctx.logos?.geminiKey) return notFound(c)
  return viaLegacyHandler(c, handleLogoGenerate)
})
