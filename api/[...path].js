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
// origin — `/api/submit`, `/api/chain/stream` — exactly as it does in `vite dev`,
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
// how this paragraph ended up here. Two rewrites, and the order is the point.
//
// `/api/:path+` → this function, FIRST. Vercel's file-system router compiles `[...path].js` to
// `^/api/([^/]+)$` — one segment — and then answers everything deeper with a flat 404. So this
// catch-all did not catch all: `/api/allowance/0x…` and `/api/faucet/0x…` were refused at the
// edge and never reached the relayer, which is why the sponsored counter rendered nothing in
// production and could not have rendered anything. The workaround before this was one stub file
// per nested prefix, each re-exporting this handler, added whenever somebody noticed another
// route was dead — five of them, and a sixth needed for every new path. The rewrite makes the
// name true and they are deleted; it also puts this deployment back to a single function, which
// the Hobby-plan cap those stubs were fighting will thank us for.
//
// `/((?!api/).*)` → `index.html`, second: the app is a single page, so every path falls through
// to it, and every path must mean every path EXCEPT this function. Vercel already gives functions
// precedence over rewrites, so the lookahead is belt and braces — worth having because a catch-all
// that swallowed `/api/submit` would present as a relayer outage, and the cause would be nowhere
// near the symptom.
//
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

//
// The ceiling on one forwarded request, in seconds.
//
// It is the STREAM that needs it. The chain feed holds a connection open for as long as a tab
// is open, and a serverless function cannot outlive its own limit — so a long session gets its
// socket closed roughly every five minutes. That is survivable rather than hidden: the feed
// client reconnects on its own backoff and falls back to its own reads, so a reader sees nothing.
// It is stated here because "the stream is permanent" would be false, and somebody debugging a
// reconnect every five minutes deserves to find this line.
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
  // `path` is the same injection under the explicit `/api/:path+` rewrite in `vercel.json`, which
  // names the parameter itself. `leaf` was the name the per-directory stubs used; they are gone,
  // and it stays deleted because a stale param would be forwarded silently and 404 the route.
  upstreamUrl.searchParams.delete('path')
  upstreamUrl.searchParams.delete('leaf')

  const headers = { 'content-type': 'application/json' }
  // Absent is legitimate: a relayer that was started without a token accepts requests without
  // one. Sending an empty header instead would be a token, and the wrong one.
  if (RELAYER_AUTH_TOKEN) headers['x-relayer-auth'] = RELAYER_AUTH_TOKEN

  //
  // ── WHO IS ASKING, CARRIED ACROSS THE HOP ─────────────────────────────────────────────────
  //
  // The relayer meters per visitor on the SOCKET address, deliberately, because
  // `x-forwarded-for` is a header anyone can write. That rule is right for a directly reachable
  // relayer and wrong once this proxy exists: every request now arrives from one Vercel egress
  // address, so every user on the internet shares one bucket. With `RELAYER_FAUCET_PER_VISITOR`
  // at 1 that does not merely fail to stop an attacker — the first person to use the app each
  // day consumes the only unit and everyone after them is refused until 00:00 UTC.
  //
  // So the real client address rides in a header of our own, and the relayer trusts it for one
  // reason: this hop is the only party that knows `RELAYER_AUTH_TOKEN`. A request that carries a
  // valid token demonstrably came through here, and a request without one is not trusted with
  // it. That is why the relayer keys the trust to the token rather than to the header's presence
  // — see `packages/relayer/src/app.ts`.
  //
  // `x-forwarded-for` is a LIST, appended to by each hop, and the client is the first entry.
  // Taking the last would take Vercel's own address and rebuild the bug this fixes.
  //
  const forwarded = req.headers['x-forwarded-for']
  const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  if (RELAYER_AUTH_TOKEN && clientIp) headers['x-strk20-client-ip'] = clientIp

  // `req.body` is already parsed by the runtime for JSON, so the raw stream is spent — it is
  // re-serialised rather than piped. Every route here is small JSON except the submission, which
  // carries a ~300 kB proof, comfortably inside the platform's request limit.
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : JSON.stringify(req.body ?? {})

  //
  // ── A CLOSED BROWSER TAB HAS TO CLOSE THE UPSTREAM CONNECTION TOO ────────────────────────
  //
  // Without this the hop is one-way: the visitor's socket goes away, and this function carries on
  // holding its own connection to the relayer until the platform kills it at `maxDuration`. Two
  // things follow, and the second is the expensive one.
  //
  // The relayer counts feed SUBSCRIBERS and caps them (`MAX_FEED_SUBSCRIBERS`). An abandoned
  // stream keeps its slot for up to five minutes, so a person who reloads a few times in a minute
  // can fill slots they are no longer using. The stream is also cut and reopened roughly every
  // five minutes by design, which means the leak is not an edge case — it is the ordinary lifecycle.
  //
  // WHAT THIS DOES NOT FIX, MEASURED RATHER THAN ASSUMED. It does not make a departure visible to
  // the relayer. This platform's edge holds the browser's connection and hands the function its
  // own; a visitor closing a tab does not reliably close anything this process can observe, so
  // `res` may emit no `close` at all until `maxDuration`. Two runs against production confirmed
  // it: a departed client was still counted as attached 145 seconds later. Nothing in this system
  // infers anything about a person from socket liveness.
  //
  // `res` emits `close` both when the client disappears and when a normal response finishes;
  // aborting after a completed fetch is a no-op, so one listener covers both without a flag.
  //
  const aborter = new AbortController()
  res.on('close', () => aborter.abort())

  let upstream
  try {
    upstream = await fetch(upstreamUrl, { method: req.method, headers, body, signal: aborter.signal })
  } catch (e) {
    // An abort here is the visitor leaving before the relayer answered — nobody to tell, and
    // writing to a closed response would throw on top of it.
    if (aborter.signal.aborted) return
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

  // PIPED, NOT BUFFERED. `await upstream.text()` would work for every route except the one that
  // matters: a stream has no end to wait for, and buffering it would deliver the feed's first
  // tick at the same moment as its last.
  //
  // `pipeline` rather than `.pipe()`: `.pipe()` leaves the SOURCE running when the destination
  // dies, which is the second half of the leak described above — the abort signal releases the
  // request, and this releases the body already being read. `pipeline` destroys both ends
  // together, which is the whole reason to prefer it here.
  try {
    await pipeline(Readable.fromWeb(upstream.body), res)
  } catch {
    // The visitor left mid-stream. That is the ordinary end of a feed socket, not a fault, and
    // there is no longer a response to report it on.
  }
}
