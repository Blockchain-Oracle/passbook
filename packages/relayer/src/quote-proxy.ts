// Third-party HTTP proxy. Every third-party call — AVNU quotes, Circle Iris bridge polling,
// oracle/price feeds — is fetched SERVER-SIDE so the aggregator sees the relay's address, never the
// user's IP+intent. Credentials live only here, never in the client bundle. This module is the pure
// request-builder + an allowlist of proxiable upstreams; the http route wires it in.

import { utcDayKey } from './sponsorship.js'

export interface ProxyTarget {
  readonly host: string          // exact upstream host permitted
  readonly injectsCredential: boolean  // whether the server attaches a secret header/param
}

/** The only upstreams the proxy will forward to — an allowlist, not an open relay (SSRF guard). */
export const PROXY_TARGETS = {
  avnuQuotes: { host: 'starknet.api.avnu.fi', injectsCredential: false },   // quote API is keyless
  circleIris: { host: 'iris-api.circle.com', injectsCredential: false },
  // The logo studio's two upstreams (`logo.ts`) — reached by its own purpose-built handlers, not
  // the generic /quote route, but listed HERE because this record is the census of every host
  // this process talks to, and the first two `injectsCredential: true` entries are exactly what
  // the D-35a discipline reserved the flag for: the JWT and the key live in server env only.
  pinataUploads: { host: 'uploads.pinata.cloud', injectsCredential: true },
  geminiImages: { host: 'generativelanguage.googleapis.com', injectsCredential: true },
} as const satisfies Record<string, ProxyTarget>

export type ProxyTargetName = keyof typeof PROXY_TARGETS

export class UnknownProxyTarget extends Error {}

/**
 * Builds the server-side upstream request for a proxied call. Carries ONLY the app-supplied
 * path+query — never a forwarded client IP, cookie, or user identifier — so the upstream cannot
 * attribute the call to a user. A credential (if the target needs one) is attached from server
 * env HERE, never surfaced to the client.
 */
export function buildUpstreamRequest(
  target: ProxyTargetName,
  path: string,
  query: Record<string, string> = {},
  credential?: string,
): { url: string; headers: Record<string, string> } {
  const t = PROXY_TARGETS[target]
  if (!t) throw new UnknownProxyTarget(target)
  if (!path.startsWith('/')) throw new Error('proxy path must be absolute')
  const qs = new URLSearchParams(query).toString()
  const url = `https://${t.host}${path}${qs ? `?${qs}` : ''}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (t.injectsCredential && credential) headers['authorization'] = `Bearer ${credential}`
  return { url, headers }
}

/** True iff a header name would leak the client's identity and must be stripped before forwarding. */
export function isIdentityLeakingHeader(name: string): boolean {
  return /^(cookie|authorization|x-forwarded-for|x-real-ip|forwarded|referer|user-agent)$/i.test(name)
}

/** Strips every identity-leaking header from a client request before the server forwards upstream. */
export function scrubClientHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!isIdentityLeakingHeader(k)) out[k] = v
  }
  return out
}

/** How many distinct visitors one day tracks; the backstop that holds whatever the caps say. */
export const MAX_TRACKED_QUOTE_VISITORS = 50_000

/**
 * Per-visitor daily counter, IN MEMORY on purpose: quota is egress, not money, so fresh quota
 * on restart beats an unwritable disk stopping price lookups. Also the logo studio's meters.
 */
export class DailyQuoteCounter {
  private day = ''
  private dayTotal = 0
  private counts = new Map<string, number>()

  constructor(
    private readonly perVisitor: number,
    private readonly global: number,
    private readonly maxTracked = MAX_TRACKED_QUOTE_VISITORS,
  ) {}

  /** Records one use for `visitor` and reports whether it was within the caps. */
  tryConsume(visitor: string, now: number): boolean {
    const today = utcDayKey(now)
    // Forward only: a clock stepping back keeps yesterday's counters rather than minting a day.
    if (today > this.day) {
      this.day = today
      this.dayTotal = 0
      this.counts.clear()
    }
    if (this.dayTotal >= this.global) return false
    const used = this.counts.get(visitor)
    // A new visitor only gets in if there is room — a /64 has more addresses than we have memory.
    if (used === undefined && this.counts.size >= this.maxTracked) return false
    if ((used ?? 0) >= this.perVisitor) return false
    this.counts.set(visitor, (used ?? 0) + 1)
    this.dayTotal += 1
    return true
  }
}

export function createQuoteCounter(perVisitor: number, global: number, maxTracked?: number): DailyQuoteCounter {
  return new DailyQuoteCounter(perVisitor, global, maxTracked)
}
