//
// The one thing standing between the browser and the relayer: a proxy that adds a header.
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────────────────
//
// The relayer holds a funded signing key, so reaching its port is itself an ability worth
// restricting, and `RELAYER_AUTH_TOKEN` is the only control that survives being put behind a
// proxy — every other check (loopback, content-type, Origin) either stops applying or stops
// meaning anything once requests arrive through one. See `packages/relayer/src/server.ts`.
//
// The browser cannot hold that token. Anything shipped to a browser is public, and a shared secret
// in a public bundle is a shared secret with the internet. So the token lives here, in a server
// environment variable, and is attached on this side of the hop. The browser posts to its own
// origin — `/api/submit`, `/api/room/send`, `/api/room/stream` — exactly as it does in `vite dev`,
// and never learns that a second host exists.
//
// ── IT FORWARDS, IT DOES NOT UNDERSTAND ──────────────────────────────────────────────────
//
// No route table, no body inspection, no opinion about what any of these calls mean. Every rule
// about what may be signed, what may be spent and what may be relayed lives in the relayer, where
// it is tested. A proxy that started making decisions would be a second, untested copy of the
// allowlist.
//
// ── THE ORIGIN HEADER IS NOT FORWARDED, AND THAT IS THE DESIGN ───────────────────────────
//
// A server-side `fetch` sends no `Origin`, which is the shape the relayer treats as a same-process
// caller. That is precisely why the token is mandatory behind a proxy rather than merely advised:
// this hop erases the browser's origin, so the Origin check can no longer refuse anything here.
//
// ── THE ROUTING NOTE THAT CANNOT LIVE IN `vercel.json` ───────────────────────────────────
//
// That file is JSON validated against a strict schema — it rejects a `//` key outright, which is
// how this paragraph ended up here. Its rewrite reads `/((?!api/).*)` rather than `/(.*)`: the app
// is a single page, so every path falls through to `index.html`, and every path must mean every
// path EXCEPT this function. Vercel already gives functions precedence over rewrites, so the
// lookahead is belt and braces — worth having because a catch-all that swallowed `/api/submit`
// would present as a relayer outage, and the cause would be nowhere near the symptom.
//
import { Readable } from 'node:stream'

//
// The ceiling on one forwarded request, in seconds.
//
// It is the STREAM that needs it. `/api/room/stream` holds a connection open for as long as
// someone has a chat window open, and a serverless function cannot outlive its own limit — so a
// long conversation gets its socket closed roughly every five minutes. That is survivable rather
// than hidden: `openRoomStream` reconnects on its own backoff and de-duplicates the backlog it is
// replayed, so a reader sees nothing. It is stated here because "the stream is permanent" would
// be false, and somebody debugging a reconnect every five minutes deserves to find this line.
//
export const config = { maxDuration: 300 }

/** Where the relayer actually runs. No default: a proxy pointed at a guess is worse than one that refuses. */
const RELAYER_ORIGIN = process.env.RELAYER_ORIGIN
const RELAYER_AUTH_TOKEN = process.env.RELAYER_AUTH_TOKEN

export default async function handler(req, res) {
  if (!RELAYER_ORIGIN) {
    // A misconfigured deployment says so in its own words rather than failing as a timeout
    // somewhere in the client. The client renders relayer-unreachable and falls back to
    // self-submit, which is the correct behaviour for a relayer that is not there.
    res.status(503).json({ error: 'this deployment has no relayer configured' })
    return
  }

  const upstreamUrl = new URL(req.url, RELAYER_ORIGIN)
  // Vercel's file-system router injects the catch-all match into the query — `/api/fee-recipient`
  // arrives here as `/api/fee-recipient?...path=fee-recipient`, the param named after the
  // `[...path]` bracket segment, dots included — and the relayer matches paths EXACTLY, query
  // string and all, so the injected param turns every proxied route into a 404. `vite dev`
  // forwards clean paths, which is why this only ever breaks in production.
  upstreamUrl.searchParams.delete('...path')
  upstreamUrl.searchParams.delete('path')
  // The nested prefixes now route through one `[leaf].js` per directory (the Hobby-plan
  // function cap), and a dynamic segment injects ITS param the same way the catch-all does.
  upstreamUrl.searchParams.delete('leaf')

  const headers = { 'content-type': 'application/json' }
  // Absent is legitimate: a relayer that was started without a token accepts requests without
  // one. Sending an empty header instead would be a token, and the wrong one.
  if (RELAYER_AUTH_TOKEN) headers['x-relayer-auth'] = RELAYER_AUTH_TOKEN

  // `req.body` is already parsed by the runtime for JSON, so the raw stream is spent — it is
  // re-serialised rather than piped. Every route here is small JSON except the submission, which
  // carries a ~300 kB proof, comfortably inside the platform's request limit.
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : JSON.stringify(req.body ?? {})

  let upstream
  try {
    upstream = await fetch(upstreamUrl, { method: req.method, headers, body })
  } catch (e) {
    res.status(502).json({ error: `the relayer could not be reached: ${String(e)}` })
    return
  }

  // Only the content type is copied through. Passing the upstream's headers wholesale would carry
  // its `connection`, `transfer-encoding` and any future header into a response this platform is
  // already framing — a class of bug that shows up as a truncated stream rather than an error.
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-store',
  })

  if (upstream.body === null) {
    res.end()
    return
  }

  // PIPED, NOT AWAITED. `await upstream.text()` would work for every route except the one that
  // matters: a stream has no end to wait for, and buffering it would deliver a room's first
  // message at the same moment as its last.
  Readable.fromWeb(upstream.body).pipe(res)
}
