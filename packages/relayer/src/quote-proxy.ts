// Third-party HTTP proxy (FR-029 / AD-7 / A8, story 1.5). Every third-party call — AVNU quotes,
// Circle Iris bridge polling, oracle/price feeds — is fetched SERVER-SIDE so the aggregator sees
// the relay's address, never the user's IP+intent (a browser-direct poll leaks exactly the class
// FR-029 sells closing). Credentials live only here, never in the client bundle. This module is
// the pure request-builder + an allowlist of proxiable upstreams; the http route wires it in.

export interface ProxyTarget {
  readonly host: string          // exact upstream host permitted
  readonly injectsCredential: boolean  // whether the server attaches a secret header/param
}

/** The only upstreams the proxy will forward to — an allowlist, not an open relay (SSRF guard). */
export const PROXY_TARGETS = {
  avnuQuotes: { host: 'starknet.api.avnu.fi', injectsCredential: false },   // quote API is keyless
  circleIris: { host: 'iris-api.circle.com', injectsCredential: false },
} as const satisfies Record<string, ProxyTarget>

export type ProxyTargetName = keyof typeof PROXY_TARGETS

/**
 * A third-party call the browser still makes DIRECTLY, and what that costs the user.
 *
 * "Everything is proxied" would be the easy sentence, and it would be false. These are the
 * exceptions, enumerated so the disclosure panel can state them and so a reviewer can count
 * them: an unlisted browser-direct host is a leak nobody wrote down. `scripts/lint-secrets.mjs`
 * fails the build on a third-party host in `web/` that is not one of these, which is what keeps
 * this list from drifting out of date the first time someone adds a fetch.
 *
 * Each entry names the leak in one line. Adding an entry is a disclosure decision, not a
 * formality — if the leak cannot be described in a sentence a user would accept, route it
 * through the proxy instead.
 */
export interface ProxyException {
  /** What the browser fetches directly. */
  readonly what: string
  /** Where in the source it happens, so the claim is checkable. */
  readonly where: string
  /** One line: what the upstream learns that it would not learn through the proxy. */
  readonly leaks: string
}

export const PROXY_EXCEPTIONS: readonly ProxyException[] = [
  {
    what: 'Starknet JSON-RPC reads (starknet_call and class-hash lookups) go straight to the RPC hosts',
    where: 'web/app.js:151',
    leaks:
      'the RPC provider sees the visitor IP alongside which contracts they read, though not ' +
      'which note or key the read is about.',
  },
  {
    what: 'Explorer links open Voyager in the user’s own browser',
    where: 'web/app.js:44',
    leaks:
      'the explorer sees the visitor IP together with the transaction they clicked, so a ' +
      'link followed is a link attributed. Copy the hash instead to avoid it.',
  },
] as const

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
