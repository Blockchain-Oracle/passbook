// POST /quote — a third-party read made from here so the upstream sees this host, not the user.
// The target allowlist is the SSRF guard; redirects are refused; no client header is forwarded.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { PROXY_TARGETS, buildUpstreamRequest, scrubClientHeaders, type ProxyTargetName } from '../quote-proxy.js'
import { isPlainObject, jsonError, readCapped, readJson, reply, visitorOf } from './shared.js'

const PROXY_TIMEOUT_MS = 10_000
const MAX_UPSTREAM_BYTES = 512 * 1024

export const quoteRoutes = new Hono<AppEnv>()

quoteRoutes.post('/', async (c) => {
  const ctx = c.var.ctx
  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')

  const { target, path, query } = body.value
  // Credentialed hosts (Pinata, Gemini) are reachable only through their own handlers, never as a plain relay.
  if (typeof target !== 'string' || !Object.hasOwn(PROXY_TARGETS, target) || PROXY_TARGETS[target as ProxyTargetName].injectsCredential) {
    return jsonError(c, 403, `refusing to proxy to ${JSON.stringify(target)}: not an allowlisted upstream`)
  }
  if (typeof path !== 'string') return jsonError(c, 400, 'body must carry a `path` string')
  if (query !== undefined && !isPlainObject(query)) {
    return jsonError(c, 400, '`query` must be an object of string values')
  }
  // Checked, not promised: URLSearchParams would stringify an object into `[object Object]`.
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value !== 'string') {
      return jsonError(c, 400, `query value for ${JSON.stringify(key)} must be a string`)
    }
  }

  let upstream: { url: string; headers: Record<string, string> }
  try {
    upstream = buildUpstreamRequest(target as ProxyTargetName, path, (query ?? {}) as Record<string, string>)
  } catch (e) {
    return jsonError(c, 400, String(e))
  }

  // Charged after every validation and immediately before the fetch — a typo costs no quota.
  const now = Date.now()
  if (!ctx.quoteCounter.tryConsume(visitorOf(c, ctx.visitorSalt, now), now)) {
    return jsonError(c, 429, 'too many quote requests from this address today; the limit resets at 00:00 UTC')
  }

  let text: string
  let status: number
  try {
    const res = await fetch(upstream.url, {
      method: 'GET',
      headers: scrubClientHeaders(upstream.headers),
      redirect: 'error',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
    status = res.status
    text = await readCapped(res.body, MAX_UPSTREAM_BYTES)
  } catch (e) {
    return jsonError(c, 502, `proxying to ${target} failed: ${String(e)}`)
  }
  if (status < 200 || status >= 300) return jsonError(c, 502, `${target} answered ${status}`)

  // Parsed and re-serialised, never piped: the upstream does not choose our response's shape.
  try {
    return reply(c, 200, JSON.parse(text))
  } catch {
    return jsonError(c, 502, `${target} did not answer JSON`)
  }
})
