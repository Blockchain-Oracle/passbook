//
// `POST /api/x/link` — the one leg that writes something durable: your X handle becomes your
// Passbook name, attested.
//
// The browser sends {address, signature} — the signature is the DIRECTORY CLAIM discipline
// verbatim, the viewing key signing H(name, address) where the name is the normalized handle
// from THIS function's verified session, never from the request body. This function fetches the
// X avatar server-side (the 48px `_normal` variant — already avatar-pipeline-sized, and X never
// sees the visitor's IP touch it), then crosses to the relayer over the server channel with the
// second secret. The relayer re-verifies the signature against the pool's own key before
// anything lands.
//
import { readSession } from './_lib.js'

/** X handles are 1–15 word chars; directory names are 3–20 lowercase. The overlap is the rule. */
export function nameFromHandle(handle) {
  const name = handle.toLowerCase()
  return /^[a-z0-9_]{3,20}$/.test(name) ? name : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(404).json({ error: 'not found' })
    return
  }
  const relayerOrigin = process.env.RELAYER_ORIGIN
  const bindSecret = process.env.RELAYER_XBIND_SECRET
  if (!process.env.X_SESSION_SECRET || !relayerOrigin || !bindSecret) {
    res.status(404).json({ error: 'X connect is not configured on this deployment' })
    return
  }

  const session = readSession(req)
  if (!session) {
    res.status(401).json({ error: 'no live X session — connect X first' })
    return
  }

  const { address, signature } = req.body ?? {}
  if (typeof address !== 'string' || typeof signature?.r !== 'string' || typeof signature?.s !== 'string') {
    res.status(400).json({ error: 'body must carry address and the claim signature' })
    return
  }

  const name = nameFromHandle(session.handle)
  if (!name) {
    res.status(422).json({
      error: `@${session.handle} does not fit the name rules (3–20 of a-z, 0-9, _) — claim a name by hand instead`,
    })
    return
  }

  // The avatar, fetched HERE. `_normal` is 48×48 — already inside the directory's 12k data-URI
  // cap for any real profile picture; one that still overflows simply ships no avatar.
  let avatar
  if (typeof session.avatarUrl === 'string' && session.avatarUrl.startsWith('https://pbs.twimg.com/')) {
    try {
      const picture = await fetch(session.avatarUrl, { signal: AbortSignal.timeout(10_000) })
      if (picture.ok) {
        const type = picture.headers.get('content-type') ?? ''
        const mime = /image\/(png|jpeg|webp)/.exec(type)?.[0]
        if (mime) {
          const bytes = Buffer.from(await picture.arrayBuffer())
          const dataUri = `data:${mime};base64,${bytes.toString('base64')}`
          if (dataUri.length <= 12_000) avatar = dataUri
        }
      }
    } catch {
      // No avatar is a fine avatar — the identity disc stands in.
    }
  }

  let upstream
  try {
    upstream = await fetch(new URL('/directory/x-bind', relayerOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.RELAYER_AUTH_TOKEN ? { 'x-relayer-auth': process.env.RELAYER_AUTH_TOKEN } : {}),
        'x-passbook-xbind': bindSecret,
      },
      body: JSON.stringify({
        name,
        address,
        signature,
        ...(avatar ? { avatar } : {}),
        xHandle: session.handle,
        xId: session.id,
      }),
    })
  } catch (e) {
    res.status(502).json({ error: `the relayer could not be reached: ${String(e)}` })
    return
  }

  const answer = await upstream.json().catch(() => ({}))
  res.status(upstream.status).json(upstream.ok ? { ok: true, name } : answer)
}
