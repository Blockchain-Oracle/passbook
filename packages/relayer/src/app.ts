// The HTTP surface: four gates in order, then the route modules mounted at both spellings.
//
// This process holds a funded key, so reaching the port is itself an ability worth limiting:
//   1. `content-type: application/json` is the CSRF control — a cross-origin <form> cannot send
//      it, and anything that can is preflighted against a server that answers NO CORS headers.
//      So the Origin gate can only REFUSE a non-browser caller; it never grants a browser one.
//   2. `x-relayer-auth` is the one control that survives a proxy, where every caller arrives
//      Origin-less. Content-type is not authentication.
//   3. The allowlist (inside /submit) decides what may be signed, before the key is touched.
//   4. The approve ceiling is drawn from the LIVE fee, per submission.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { matchedRoutes } from 'hono/route'
import { getConnInfo } from '@hono/node-server/conninfo'

import type { AppEnv, RelayerContext } from './context.js'
import { SEND_CAP_NOTICE } from './sponsorship.js'
import { ALLOWANCE_SPENT_NOTICE } from '../../protocol/src/relayer-wire.js'
import { allowanceRoutes } from './routes/allowance.js'
import { submitRoutes } from './routes/submit.js'
import { quoteRoutes } from './routes/quote.js'
import { feeRecipientRoutes } from './routes/fee-recipient.js'
import { faucetRoutes } from './routes/faucet.js'
import { directoryRoutes } from './routes/directory.js'
import { roomRoutes } from './routes/rooms.js'
import { chainRoutes } from './routes/chain.js'
import { logoRoutes } from './routes/logo.js'
import { governRoutes } from './routes/govern.js'

// A proven submission carries a ~309 KB base64 proof blob; one megabyte is ~3x headroom. Raise
// it knowingly if a legitimate prove ever outgrows it — never soften the refusal.
export const MAX_BODY_BYTES = 1_000_000

export interface AppOptions {
  /** Browser origins not refused. Empty means only callers that send no Origin header. */
  allowedOrigins?: ReadonlySet<string>
  /** Required on every request as `x-relayer-auth` when set. Mandatory behind any proxy. */
  authToken?: string
}

/**
 * Which address a request is metered under.
 *
 * Its own function because the rule is a security decision and deserves to be readable and
 * testable on its own: the forwarded header counts ONLY when the request also carries a valid
 * token, because the token is known to our proxy and to nothing else. An attacker may write the
 * header all they like; without the token it is ignored and they are metered on the socket they
 * actually opened.
 */
export function resolveClientIp(input: {
  claimed: string | undefined
  presentedToken: string | undefined
  authToken: string | undefined
  socket: () => string | undefined
}): string {
  const proxied = input.authToken !== undefined && tokenMatches(input.authToken, input.presentedToken)
  if (proxied && input.claimed) return input.claimed
  return input.socket() || 'unknown'
}

/** Constant-time compare over equal-length digests, so neither length nor bytes leak. */
function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (typeof presented !== 'string') return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(presented).digest()
  return timingSafeEqual(a, b)
}

/** Refuses at construction the two misconfigurations that would otherwise serve silently wrong. */
function checkedContext(ctx: RelayerContext): RelayerContext {
  if (ctx.sponsorship && !ctx.sendBudget) {
    throw new Error(
      'a sponsorship budget was configured without a send budget, which would leave every ' +
        'plain submission unmetered while registrations stay capped. Pass both, or neither.',
    )
  }
  if (ctx.sendBudget && ctx.sendBudget.notice !== SEND_CAP_NOTICE) {
    throw new Error(
      'the send budget was built without SEND_CAP_NOTICE, so a refused send would be shown copy ' +
        'about sponsored registrations. Construct it with the send notice.',
    )
  }
  if (ctx.accountAllowance && ctx.accountAllowance.notice !== ALLOWANCE_SPENT_NOTICE) {
    throw new Error(
      'the account allowance was built without ALLOWANCE_SPENT_NOTICE, so a user who spent the ' +
        'transactions we cover would be told their account creation was paused. Construct it ' +
        'with the allowance notice.',
    )
  }
  // Never hash with an empty salt: that makes every visitor id a precomputable plain hash.
  return {
    ...ctx,
    visitorSalt: ctx.visitorSalt || ctx.sponsorship?.salt || randomBytes(32).toString('hex'),
  }
}

const MOUNTS = [
  ['submit', submitRoutes],
  ['allowance', allowanceRoutes],
  ['quote', quoteRoutes],
  ['fee-recipient', feeRecipientRoutes],
  ['faucet', faucetRoutes],
  ['directory', directoryRoutes],
  ['room', roomRoutes],
  ['chain', chainRoutes],
  ['logo', logoRoutes],
  ['govern', governRoutes],
] as const

export function createApp(context: RelayerContext, options: AppOptions = {}): Hono<AppEnv> {
  const ctx = checkedContext(context)
  const { allowedOrigins = new Set<string>(), authToken } = options
  const app = new Hono<AppEnv>()

  app.use(
    createMiddleware<AppEnv>(async (c, next) => {
      c.set('ctx', ctx)
      //
      // ── WHOSE ADDRESS THIS IS, AND WHY IT IS NOT ALWAYS THE SOCKET'S ─────────────────────
      //
      // This used to be the socket address unconditionally, on the grounds that
      // `x-forwarded-for` is a header anyone can write — true, and the right rule for a relayer
      // reachable directly. It became wrong the moment a proxy went in front: every request then
      // arrives from ONE Vercel egress address, so every user shares one bucket, and a
      // per-visitor cap of 1 means the first person to use the app each day locks out everyone
      // else until 00:00 UTC. A control that refuses "too much and never too little" stops being
      // conservative when too much is everybody.
      //
      // `x-strk20-client-ip` is trusted, but only alongside a valid `x-relayer-auth`, and the
      // gate below is what enforces that ordering. The token is known to our proxy and to nothing
      // else, so a request carrying one demonstrably came through it. An unauthenticated caller
      // can still write the header; it is ignored, and they are metered on the socket they
      // actually connected from.
      //
      // WITH NO TOKEN CONFIGURED the header is never trusted, whatever it says. A deployment that
      // forgot its token is exactly the one that must not accept a caller's word for who they are.
      //
      c.set(
        'clientIp',
        resolveClientIp({
          claimed: c.req.header('x-strk20-client-ip'),
          presentedToken: c.req.header('x-relayer-auth'),
          authToken,
          // Read lazily: a valid proxy header answers without touching the socket, and a socket
          // that cannot be read is an 'unknown' bucket rather than a 500 on every request.
          socket: () => {
            try {
              return getConnInfo(c).remote.address
            } catch {
              return undefined
            }
          },
        }),
      )
      await next()
    }),
  )

  // GATE ORDER IS THE CONTROL: route exists → content-type → Origin → auth → handler.
  app.use(async (c, next) => {
    // Only this file's `use` handlers match as ALL; a real route matched means the path exists.
    if (!matchedRoutes(c).some((r) => r.method !== 'ALL')) return c.json({ error: 'not found' }, 404)
    // Skipped for GET only because a GET has no body to declare a type for (fee-recipient).
    if (c.req.method !== 'GET') {
      const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (contentType !== 'application/json') {
        return c.json({ error: 'content-type must be application/json' }, 415)
      }
    }
    const origin = c.req.header('origin')
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return c.json({ error: `refusing a request from origin ${origin}` }, 403)
    }
    if (authToken !== undefined && !tokenMatches(authToken, c.req.header('x-relayer-auth'))) {
      return c.json({ error: 'missing or invalid x-relayer-auth' }, 401)
    }
    await next()
  })

  // After the gates, so an oversized body still meets the same door in the same order.
  app.use(bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'request body too large' }, 400) }))

  app.notFound((c) => c.json({ error: 'not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message || 'request refused' }, err.status)
    // Last line of defence: nothing may escape a handler as an unhandled rejection.
    console.warn(`relayer: unhandled request failure: ${String(err)}`)
    return c.json({ error: 'internal error' }, 500)
  })

  // Both spellings: the browser posts same-origin `/api/...`; a proxy may or may not strip it.
  for (const [path, routes] of MOUNTS) {
    app.route(`/${path}`, routes)
    app.route(`/api/${path}`, routes)
  }
  return app
}
