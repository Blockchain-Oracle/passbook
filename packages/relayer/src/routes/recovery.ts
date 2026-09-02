// /recovery/{register,auth}/{options,verify} and /recovery/envelope/{put,delete} — passkey wallet
// continuity. Validation lives in `recovery-body.ts`, outcomes in `recovery.ts`; the route only
// maps them to responses. No body, challenge or credential id is ever logged here.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import type { Outcome } from '../recovery.js'
import {
  parseAuthOptionsBody,
  parseAuthVerifyBody,
  parseEnvelopeDeleteBody,
  parseEnvelopePutBody,
  parseRegisterOptionsBody,
  parseRegisterVerifyBody,
} from './recovery-body.js'
import { isPlainObject, jsonError, notFound, readJson, reply, visitorOf, type Ctx } from './shared.js'

export const recoveryRoutes = new Hono<AppEnv>()

recoveryRoutes.use('*', async (c, next) => {
  if (!c.var.ctx.recovery) return notFound(c)
  await next()
})

const OPTIONS_CAP = 'too many passkey requests from this address today; the limit resets at 00:00 UTC'

function answer<T>(c: Ctx, outcome: Outcome<T>): Response {
  return outcome.ok ? reply(c, 200, outcome.value) : jsonError(c, outcome.status, outcome.error, outcome.extra)
}

/** The shared prologue: JSON object, then the hand parser — a shape error is a 400 with its sentence. */
async function parsed<T>(c: Ctx, parse: (raw: unknown) => T): Promise<{ ok: true; value: T } | { ok: false; res: Response }> {
  const body = await readJson(c)
  if (!body.ok) return body
  if (!isPlainObject(body.value)) return { ok: false, res: jsonError(c, 400, 'body must be a JSON object') }
  try {
    return { ok: true, value: parse(body.value) }
  } catch (e) {
    return { ok: false, res: jsonError(c, 400, e instanceof Error ? e.message : String(e)) }
  }
}

/** Charged after validation and before a challenge is minted — a typo costs no quota. */
function chargeOptions(c: Ctx): Response | null {
  const ctx = c.var.ctx
  const now = Date.now()
  return ctx.recovery!.optionsCounter.tryConsume(visitorOf(c, ctx.visitorSalt, now), now) ? null : jsonError(c, 429, OPTIONS_CAP)
}

recoveryRoutes.post('/register/options', async (c) => {
  const body = await parsed(c, parseRegisterOptionsBody)
  if (!body.ok) return body.res
  const capped = chargeOptions(c)
  if (capped) return capped
  return answer(c, await c.var.ctx.recovery!.registerOptions(body.value))
})

recoveryRoutes.post('/register/verify', async (c) => {
  const body = await parsed(c, parseRegisterVerifyBody)
  if (!body.ok) return body.res
  try {
    return answer(c, await c.var.ctx.recovery!.registerVerify(body.value))
  } catch (e) {
    console.warn(`relayer: recovery ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the passkey could not be recorded; nothing was registered')
  }
})

recoveryRoutes.post('/auth/options', async (c) => {
  const body = await parsed(c, parseAuthOptionsBody)
  if (!body.ok) return body.res
  const capped = chargeOptions(c)
  if (capped) return capped
  return answer(c, await c.var.ctx.recovery!.authOptions(body.value))
})

recoveryRoutes.post('/auth/verify', async (c) => {
  const body = await parsed(c, parseAuthVerifyBody)
  if (!body.ok) return body.res
  try {
    return answer(c, await c.var.ctx.recovery!.authVerify(body.value))
  } catch (e) {
    console.warn(`relayer: recovery ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the passkey was verified but could not be recorded; try again')
  }
})

recoveryRoutes.post('/envelope/put', async (c) => {
  const body = await parsed(c, parseEnvelopePutBody)
  if (!body.ok) return body.res
  try {
    return answer(c, c.var.ctx.recovery!.putEnvelope(body.value))
  } catch (e) {
    console.warn(`relayer: recovery ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the sealed copy could not be written; the previous copy stands')
  }
})

recoveryRoutes.post('/envelope/delete', async (c) => {
  const body = await parsed(c, parseEnvelopeDeleteBody)
  if (!body.ok) return body.res
  try {
    return answer(c, c.var.ctx.recovery!.deleteEnvelope(body.value))
  } catch (e) {
    console.warn(`relayer: recovery ledger write failed: ${String(e)}`)
    return jsonError(c, 500, 'the sealed copy could not be deleted')
  }
})
