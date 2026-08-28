//
// The X OAuth toolkit shared by the /api/x/* functions. Underscore-prefixed, so the platform
// does not serve it as a route.
//
// WHY THIS LIVES ON VERCEL AND NOT THE RELAYER: the forwarder (`api/[...path].js`) copies only
// the content type — cookies and redirects are dropped BY DESIGN, and OAuth is nothing but
// cookies and redirects. These functions own the browser-facing dance; the one durable write
// (the handle→address binding) crosses to the relayer server-to-server in `link.js`, under the
// second secret the browser never holds.
//
// The shapes are yosuku's, transplanted (`reference/yosuku/app/api/claim/x/*` — proven in
// production): PKCE S256, state in httpOnly cookies, a confidential→public client fallback on
// the token exchange, and an HMAC-signed session so the callback's answer survives statelessly.
//
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto'

export const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize'
export const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
export const ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url'
export const SCOPES = 'users.read tweet.read'

/** 30 days. The session is "who is signed in in this browser", not the durable binding. */
const SESSION_TTL_S = 30 * 24 * 3600

export const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const genVerifier = () => b64url(randomBytes(32))
export const genState = () => b64url(randomBytes(16))
export const codeChallenge = (verifier) => b64url(createHash('sha256').update(verifier).digest())

/**
 * The public origin THIS request arrived on — the callback must be registered at exactly this
 * origin in the X developer app, and the app's registered URL is the source of truth the user
 * configures; this only reconstructs it.
 */
export function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `${proto}://${host}`
}

export function readCookies(req) {
  const header = req.headers.cookie ?? ''
  const out = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function cookie(name, value, { maxAge, clear = false } = {}) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/api/x',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : maxAge}`,
  ]
  return attrs.join('; ')
}

/**
 * Sessions are `b64url(payload).hmac`. REFUSES TO WORK WITHOUT THE SECRET — a fallback literal
 * here would let anyone mint a session for any handle, which is yosuku's comment and ours.
 */
function sessionSecret() {
  const secret = process.env.X_SESSION_SECRET
  if (!secret) throw new Error('X_SESSION_SECRET is not set — refusing to sign or read sessions')
  return secret
}

export function signSession(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S }))
  const mac = createHmac('sha256', sessionSecret()).update(body).digest('hex')
  return `${body}.${mac}`
}

export function readSession(req) {
  const raw = readCookies(req).x_sess
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('hex')
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/**
 * The token exchange, with the confidential→public fallback: a confidential X app wants basic
 * auth; a public one wants `client_id` in the body; the error for using the wrong one is a 401
 * `invalid_client`, so the fallback keys off exactly that. (Yosuku hit this in production.)
 */
export async function exchangeCode(code, verifier, redirectUri) {
  const clientId = process.env.X_CLIENT_ID
  const clientSecret = process.env.X_CLIENT_SECRET
  const base = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }

  if (clientSecret) {
    const confidential = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams(base).toString(),
    })
    if (confidential.ok) return confidential.json()
    const text = await confidential.text().catch(() => '')
    if (confidential.status !== 401 && !text.includes('invalid_client')) {
      throw new Error(`token exchange answered ${confidential.status}`)
    }
    // Fall through to the public-client shape.
  }

  const publicClient = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...base, client_id: clientId }).toString(),
  })
  if (!publicClient.ok) throw new Error(`token exchange answered ${publicClient.status}`)
  return publicClient.json()
}
