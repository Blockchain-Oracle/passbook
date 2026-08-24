//
// SERVER-SIDE ONLY. This module reads the relayer's signing key out of the process
// environment. It must never be imported by, bundled into, or otherwise reachable
// from browser code — the whole point of the split is that the key stays here while
// `paymaster.ts` (which the browser does hold) stays free of credentials.
//
// The environment is the right home for exactly these two values and nothing else:
// network parameters are facts about a network and live in constants.ts, under
// version control where they can be reviewed. Only secrets come from the env.
//
// This process holds a funded key and pays for what it signs, so reaching the port is
// itself an ability worth restricting. Four controls, in order of how much they buy:
//
//   1. It requires content-type: application/json. This is what separates a web page
//      from the key. Loopback is NOT a boundary against the operator's own browser: a
//      cross-origin <form enctype="text/plain"> is a CORS simple request, fires no
//      preflight, and posts a body that parses as JSON. The attacker cannot read the
//      reply and does not need to — the transaction is already signed. A form cannot
//      send application/json, and anything that can is preflighted against a server
//      that answers no CORS headers.
//
//      The Origin check is a second line only. Note honestly what it can do: it can
//      REFUSE, and it cannot GRANT. A browser request carrying both a non-null Origin
//      and application/json is by definition cross-origin, so it is preflighted, and
//      this server answers no CORS headers — the request never arrives. So configuring
//      an origin does not enable a browser caller; it only narrows non-browser ones.
//
//   1b. RELAYER_AUTH_TOKEN, when set, is required on every request. This is the control
//      for the layer above: paymaster.ts fetches the same-origin relative /api/submit,
//      and this server accepts that path so a proxy can forward it. The moment such a
//      rewrite exists, loopback stops being a boundary and NO warning fires, because
//      offHostWarning keys off RELAYER_HOST, which nobody changed. Behind a proxy every
//      internet client arrives Origin-less, which is the shape treated as same-process.
//      Content-type is a CSRF control, not authentication. Any deployment reachable
//      through a proxy MUST set this.
//   2. allowlist.ts decides what may be signed at all, and caps how much an approve
//      may authorise. Everything is refused BEFORE the key is used — see handle().
//   3. It binds 127.0.0.1 unless RELAYER_HOST says otherwise. Exposing a funded signer
//      to every interface has to be a deliberate act, not what a missed setting does.
//      Treat RELAYER_HOST as a gate that authentication and rate limiting must come
//      before: the allowlist bounds what may be signed, never by whom or how often.
//   4. The approve ceiling is drawn from the LIVE fee, per submission.
//
// Operational rule that backs both up: keep this wallet on a small working balance —
// the next few submissions' worth, not a treasury — so a mistake in either control
// costs a batch rather than a balance. The funding monitor is sized to match: it pages
// ops below five live fees and refuses to sign below two, so a wallet funded to this
// rule sits comfortably clear of both. Fund it far below that and the relayer will
// correctly report itself down.
//
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Account, RpcProvider, type Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import { loadDotEnv } from '../../protocol/src/env.js'
import { withFallback } from '../../protocol/src/rpc.js'
import { readPoolConstants } from '../../protocol/src/pool.js'
import {
  assertProofFacts,
  assertSubmittable,
  isPoolApplyActions,
  needsApproveCeiling,
  approveCeiling,
  type SubmissionPolicy,
} from './allowlist.js'
import type { SubmitBody } from '../../protocol/src/relayer-wire.js'
import {
  SponsorshipLedger,
  utcDayKey,
  type BudgetCaps,
  type SponsorDecision,
} from './sponsorship.js'
import { FileSponsorshipStore, isAcceptableSalt } from './sponsorship-store.js'
import {
  createFundingMonitor,
  MAX_TIMER_MS,
  RELAYER_DOWN_NOTICE,
  type FundingMonitor,
} from './funding-monitor.js'
import {
  buildUpstreamRequest,
  scrubClientHeaders,
  PROXY_TARGETS,
  type ProxyTargetName,
} from './quote-proxy.js'

// R10 names `POST /submit`; the browser posts to the same-origin `/api/submit`, which
// a dev-server proxy or edge rule normally rewrites. Accepting both means the two
// halves connect whether or not that rewrite is in place.
const SUBMIT_PATHS = new Set(['/submit', '/api/submit'])

// The third-party proxy (FR-029). Both spellings for the same reason as SUBMIT_PATHS.
const QUOTE_PATHS = new Set(['/quote', '/api/quote'])

// An upstream that will not answer in this long is an upstream the caller has already
// given up on, and a request left hanging is a socket the relayer keeps paying for.
const PROXY_TIMEOUT_MS = 10_000

// A quote is kilobytes. Anything larger is not one, and reading it would let an
// allowlisted host that starts misbehaving exhaust this process's memory.
const MAX_UPSTREAM_BYTES = 512 * 1024

// Its own number rather than the proxy's. A page is fire-and-forget and nobody is waiting on
// it, so it should give up sooner than a request a user is watching — and tying the two
// together means a future change to proxy patience silently changes how long a dead pager
// holds a socket.
const OPS_WEBHOOK_TIMEOUT_MS = 5_000

const JSON_HEADERS = { 'content-type': 'application/json' }

// A submission is a handful of calls. Anything larger is not one, so stop reading
// rather than buffering an unbounded body into memory.
const MAX_BODY_BYTES = 1_000_000

/**
 * Transaction-level details that are not calls.
 *
 * `proofFacts` is what a proven pool submission needs (story 1.12): the prover returns
 * them alongside the `apply_actions` calldata and the sequencer rejects the transaction
 * without them. They are V3 transaction fields, not calldata, so they cannot be smuggled
 * in through `calls` — which is why `/submit` had to grow a second field rather than the
 * caller finding a way around it.
 */
export interface SubmitDetails {
  proofFacts?: string[]
}

/**
 * Signs and broadcasts the calls, yielding the transaction hash. Injected rather than
 * reached for directly so the request handling around it can be tested without a real
 * mainnet submission — the one part of this file that cannot be exercised for free.
 */
export type SubmitCalls = (calls: Call[], details?: SubmitDetails) => Promise<string>

/** Fails at startup rather than as an opaque signing error on the first request. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The relayer cannot sign without it. Set it in the server ` +
        `environment only — never in a VITE_-prefixed variable, which ships to the browser.`,
    )
  }
  return value
}

/**
 * Constant-time token comparison.
 *
 * Both sides are hashed first so `timingSafeEqual` always gets equal-length buffers —
 * it throws on a length mismatch, and comparing raw values would leak the token's length
 * through that error before leaking its bytes through timing.
 */
function tokenMatches(expected: string, presented: string | string[] | undefined): boolean {
  if (typeof presented !== 'string') return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(presented).digest()
  return timingSafeEqual(a, b)
}

/** Never throws: a response we cannot deliver must not become an uncaught exception. */
function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  try {
    res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body))
  } catch (e) {
    // The socket died between the check above and the write. Nobody left to tell.
    console.warn(`relayer: could not send ${status}: ${String(e)}`)
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: RelayerServerOptions) {
  const { allowedOrigins = new Set<string>(), authToken } = opts

  const url = req.url ?? ''
  const isSubmit = SUBMIT_PATHS.has(url)
  if (req.method !== 'POST' || !(isSubmit || QUOTE_PATHS.has(url))) {
    send(res, 404, { error: 'not found' })
    return
  }

  // Loopback binds the socket; it does not keep out the operator's own browser, which
  // is already inside that boundary. Any page they visit can post here, so these two
  // checks are what actually separate a web page from a funded key.
  //
  // A cross-origin <form> can only send text/plain, urlencoded or multipart — none of
  // them this — and it cannot set a header to fake it. Anything that CAN set
  // application/json cross-origin is preflighted, and we answer no CORS headers at all.
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (contentType !== 'application/json') {
    send(res, 415, { error: 'content-type must be application/json' })
    return
  }

  // Refuses, never grants — see the header note. An Origin we did not configure is not
  // the caller this endpoint is for; a configured one merely stops being refused here.
  const origin = req.headers.origin
  if (origin !== undefined && !allowedOrigins.has(origin)) {
    send(res, 403, { error: `refusing a request from origin ${origin}` })
    return
  }

  // The only control that survives a proxy, because behind one every caller looks like
  // the trusted Origin-less same-process case. Constant-time so a wrong token cannot be
  // narrowed a byte at a time.
  if (authToken !== undefined && !tokenMatches(authToken, req.headers['x-relayer-auth'])) {
    send(res, 401, { error: 'missing or invalid x-relayer-auth' })
    return
  }

  // All three gates above apply to the proxy too. It signs nothing, but it does spend this
  // host's egress and lends its address to whoever reaches it — an unauthenticated proxy is
  // a free anonymity service pointed at two APIs, and the first thing to notice would be a
  // rate limit we did not cause. Same door, same lock.
  await (isSubmit ? handleSubmit(req, res, opts) : handleQuote(req, res, opts))
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RelayerServerOptions,
) {
  const { submit } = opts

  // Refuse before doing any work when the relayer knows it cannot pay. Signing anyway buys a
  // revert that costs gas to fail and reads as our bug rather than our funding. Whatever
  // drives this reports ok while it is merely UNSURE, so a failed read never manufactures an
  // outage — see funding-monitor.ts for why a failed or unjudgeable read reports ok.
  if (opts.relayerState?.() === 'relayer-down') {
    send(res, 503, {
      error: 'the relayer is not accepting submissions right now',
      state: 'relayer-down',
      notice: RELAYER_DOWN_NOTICE,
    })
    return
  }

  // A malformed request is the caller's fault (400); a failed submission is ours or
  // the chain's (502). Collapsing both into one status would misdirect every debug.
  //
  // `proofFacts` is OPTIONAL and the extension is additive: a `{calls}`-only body — every
  // MessageBook submission the browser route already sends — behaves exactly as before.
  let calls: Call[]
  let details: SubmitDetails | undefined
  try {
    const body = (await readJsonBody(req)) as Partial<SubmitBody>
    if (!Array.isArray(body.calls) || body.calls.length === 0) {
      throw new Error('body must carry a non-empty `calls` array')
    }
    calls = body.calls
    if (body.proofFacts !== undefined) {
      // Facts belong to a PROVEN POOL SUBMISSION and to nothing else. On a batch with no
      // `apply_actions` in it there is no proof they could be the facts for, so what they
      // actually are is caller-chosen felts being signed into our V3 transaction details
      // — a field the allowlist never sees. Refuse rather than carry them.
      if (!calls.some(isPoolApplyActions)) {
        throw new Error(
          'refusing proofFacts on a batch with no pool apply_actions: facts belong to a ' +
            'proven pool submission, and on any other batch they are arbitrary felts',
        )
      }
      details = { proofFacts: assertProofFacts(body.proofFacts) }
    }
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  // The approve ceiling comes from the live fee, which is mutable at zero upgrade delay,
  // so it is read per submission rather than pinned at boot — but only when the batch
  // actually contains an approve. A batch without one has nothing to check against a
  // ceiling, and making every submission depend on chain availability would trade a
  // spending risk for an outage. When it IS needed and cannot be read, we refuse:
  // without a bound there is nothing to hold an approve to.
  let policy = opts.policy ?? {}
  if (needsApproveCeiling(calls)) {
    try {
      policy = { ...policy, maxApproveWei: await opts.resolveApproveCeiling() }
    } catch (e) {
      send(res, 503, { error: `refusing to sign: the live fee could not be read: ${String(e)}` })
      return
    }
  }

  // The policy gate. This runs BEFORE the key is used, and its order relative to
  // submit() is the whole control: a refusal reported after signing would be no
  // refusal at all. 403 rather than 400 — the request was legible, just not permitted.
  try {
    assertSubmittable(calls, policy)
  } catch (e) {
    send(res, 403, { error: String(e) })
    return
  }

  // The budget gate. Everything this server signs is paid for out of one funded key, so
  // every accepted submission IS a sponsorship — there is no separate sponsored path to
  // gate. The allowlist bounds what may be signed and the ceiling bounds one approve;
  // neither bounds how MANY, which is what a budget is for.
  //
  // The spend is recorded BEFORE submit(), and that ordering is deliberate. Recording it
  // afterwards would leave the whole await window open for every concurrent request to
  // pass the same check — the classic way a cap of twenty pays for two hundred. The cost
  // of the other order is that a submission which fails at the sequencer still consumes a
  // unit of budget; that is the direction to be wrong in, because the failure mode is a
  // visitor waiting until 00:00 UTC rather than an operator waiting for a refund.
  if (opts.sponsorship) {
    const now = (opts.now ?? Date.now)()
    const visitor = visitorId(clientIp(req), opts.sponsorship.salt, now)
    let decision: SponsorDecision
    try {
      decision = opts.sponsorship.spend(visitor, now)
    } catch (e) {
      // `spend` writes the durable ledger, so it can fail on a full disk or a permissions
      // change. Letting that escape leaves the request unanswered — the client waits for a
      // socket that never closes — and it must NOT fall through to signing: an unrecordable
      // spend is one we refuse to make. 500 because it is our fault, not the caller's.
      console.warn(`relayer: sponsorship ledger write failed: ${String(e)}`)
      send(res, 500, { error: 'the sponsorship ledger could not be written; refusing to sign' })
      return
    }
    if (!decision.allow) {
      // Ops gets the cap that actually bound; the caller does not. Which of the two ran
      // out is a fact about the relayer's day, and "the global budget is gone" tells a
      // stranger what everyone else has been doing.
      console.warn(`relayer: sponsorship refused (${decision.reason}) for visitor ${visitor.slice(0, 8)}…`)
      send(res, 403, {
        error: 'sponsored submissions are paused',
        reason: 'sponsorship-paused',
        notice: decision.notice,
      })
      return
    }
  }

  try {
    // Our address is the one the public record will show against this transaction.
    // That is the entire service being offered; see paymaster.ts.
    send(res, 200, { transactionHash: await submit(calls, details) })
  } catch (e) {
    send(res, 502, { error: String(e) })
  }
}

/**
 * The address the budget is counted against, before it is hashed.
 *
 * Behind a proxy this is the proxy, so every visitor lands in one bucket: the daily budget
 * still binds and the per-visitor cap collapses into it. That refuses too much rather than
 * too little, which is the right way for this to break — the alternative is trusting
 * `x-forwarded-for`, a header the caller writes, which turns the per-visitor cap into a
 * suggestion. A deployment that needs real per-visitor caps behind a proxy has to give the
 * proxy a trusted way to say so; guessing from a header is not one.
 */
function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress || 'unknown'
}

/**
 * The opaque id one visitor is counted under, for one UTC day.
 *
 * The relayer already sees IPs — shielding IP+intent from THIRD parties is the service it
 * exists to sell, not a promise about itself. What the hash buys is narrower than "the
 * ledger is anonymous", so state it exactly:
 *
 *   - OPAQUE AT REST. The stored ids are not addresses, so reading a counter is not reading
 *     a visitor. That is worth having; it is not the same as unreadable.
 *   - DAY-SCOPED UNLINKABILITY. The UTC day is mixed in, so an id from yesterday cannot be
 *     matched against one from today, and the same day scope is what makes the caps reset at
 *     00:00 UTC — the promise the notice makes.
 *   - NOT ONE-WAY AGAINST A LEAK OF THE FILE. The salt is stored beside the hashes it
 *     produced, so whoever holds the ledger can brute-force the entire IPv4 space against
 *     it — 2^32 SHA-256s, which is hours, not a barrier. The file is sensitive, and
 *     sponsorship-store.ts says so where it is written.
 */
export function visitorId(ip: string, salt: string, now: number): string {
  return createHash('sha256')
    // `|` separates the three fields so two different triples cannot join into the same
    // string. It is safe as a separator because none of the three can contain one: the salt
    // is hex, the day is a fixed-format YYYY-MM-DD, and every value `clientIp` produces is
    // either an IPv4/IPv6 literal or the word `unknown`.
    .update(`${salt}|${utcDayKey(now)}|${ip}`)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Per-IP daily counter for the quote proxy, kept apart from the sponsorship budget.
 *
 * ITS OWN COUNTER, DELIBERATELY. A quote costs egress; a submission costs STRK. Charging
 * quotes against the sponsorship budget would let anyone burn a visitor's sponsored
 * registration — the thing this product gives away — by asking for prices, and it would make
 * the pause notice's promise ("paused until 00:00 UTC") arrive for a reason that has nothing
 * to do with sponsorship.
 *
 * IN MEMORY, ALSO DELIBERATELY. Losing the counts on restart hands out fresh quota, and that
 * is an acceptable loss because quotes are not money: the cap exists so the proxy cannot be
 * turned into a free anonymity service, not to protect a balance. Paying a durable write per
 * quote — and inheriting the failure mode where an unwritable disk stops price lookups —
 * would buy strictness nobody needs. The sponsorship ledger is durable because it is money.
 */
class DailyQuoteCounter {
  private day = ''
  private dayTotal = 0
  private counts = new Map<string, number>()

  constructor(
    private readonly perVisitor: number,
    private readonly global: number,
    private readonly maxTracked = MAX_TRACKED_QUOTE_VISITORS,
  ) {}

  /** Records one quote for `visitor` and reports whether it was within the caps. */
  tryConsume(visitor: string, now: number): boolean {
    const today = utcDayKey(now)
    // FORWARD ONLY. A string compare works because the key is YYYY-MM-DD, and `!==` would not:
    // a clock stepping backwards — NTP correction, a VM resuming from a snapshot, a container
    // starting with a bad clock — would read as "a new day" and hand out a whole fresh day's
    // quota. Refusing to travel backwards means the worst a bad clock does is keep yesterday's
    // counters running, which errs toward refusing rather than toward giving away.
    if (today > this.day) {
      this.day = today
      this.dayTotal = 0
      this.counts.clear()
    }

    if (this.dayTotal >= this.global) return false

    const used = this.counts.get(visitor)
    // A visitor we are not already tracking only gets in if there is room. Without this the map
    // grows once per distinct address, and an attacker with a /64 has more addresses than we
    // have memory — the per-visitor cap is no bound at all when addresses are free. Callers
    // already holding an entry keep counting, so this throttles new arrivals, not regulars.
    if (used === undefined && this.counts.size >= this.maxTracked) return false
    if ((used ?? 0) >= this.perVisitor) return false

    this.counts.set(visitor, (used ?? 0) + 1)
    this.dayTotal += 1
    return true
  }
}

/**
 * How many distinct addresses the quote counter will track in one day.
 *
 * The global cap already bounds the map indirectly — a refused request adds no entry — but only
 * while the global cap is set sanely. This is the backstop that holds regardless of config.
 */
export const MAX_TRACKED_QUOTE_VISITORS = 50_000

/** Exported for `main()` and tests; the class stays private so the cap has one constructor. */
export function createQuoteCounter(
  perVisitor: number,
  global: number,
  maxTracked?: number,
): QuoteCounter {
  return new DailyQuoteCounter(perVisitor, global, maxTracked)
}

export interface QuoteCounter {
  tryConsume(visitor: string, now: number): boolean
}

/**
 * Reads an upstream body under a hard byte cap.
 *
 * `res.text()` would buffer whatever the upstream chooses to send. The targets are
 * allowlisted, but an allowlisted host having a bad day is exactly the case a cap is for,
 * and the cap has to be enforced while reading — checking content-length afterwards is
 * checking a number the sender picked.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > cap) {
      await reader.cancel()
      throw new Error(`upstream response exceeded ${cap} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * `POST /api/quote` — a third-party read, made from here instead of from the browser.
 *
 * The point is FR-029: a browser that polls an aggregator directly hands that aggregator
 * the user's IP next to their intent, which is precisely the linkage this product sells
 * closing. Fetching it server-side means the upstream sees this host and a bare path.
 *
 * The allowlist is also the SSRF guard, so it is checked against `PROXY_TARGETS` before
 * anything is built, and redirects are refused rather than followed: an allowlisted host
 * that answers 302 to a link-local address would otherwise walk straight through the
 * allowlist into this machine's metadata service.
 */
async function handleQuote(req: IncomingMessage, res: ServerResponse, opts: RelayerServerOptions) {
  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  // `JSON.parse('null')` succeeds, and so do `'7'` and `'[]'`. Destructuring any of them
  // throws or silently yields undefined for every field, so the shape is checked before it
  // is taken apart rather than after.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    send(res, 400, { error: 'body must be a JSON object' })
    return
  }

  const { target, path, query } = parsed as { target?: unknown; path?: unknown; query?: unknown }
  if (typeof target !== 'string' || !Object.hasOwn(PROXY_TARGETS, target)) {
    send(res, 403, {
      error: `refusing to proxy to ${JSON.stringify(target)}: not an allowlisted upstream`,
    })
    return
  }
  if (typeof path !== 'string') {
    send(res, 400, { error: 'body must carry a `path` string' })
    return
  }
  if (query !== undefined && (typeof query !== 'object' || query === null || Array.isArray(query))) {
    send(res, 400, { error: '`query` must be an object of string values' })
    return
  }
  // Checked, not just promised. `URLSearchParams` stringifies whatever it is handed, so an
  // object or an array here becomes `[object Object]` in the upstream URL — a silently wrong
  // query rather than a refused one, and the error message above would have been a lie.
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value !== 'string') {
      send(res, 400, { error: `query value for ${JSON.stringify(key)} must be a string` })
      return
    }
  }

  let upstream: { url: string; headers: Record<string, string> }
  try {
    upstream = buildUpstreamRequest(
      target as ProxyTargetName,
      path,
      (query ?? {}) as Record<string, string>,
    )
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  // Metered per IP on a counter of its own — see DailyQuoteCounter for why this never touches
  // the sponsorship budget and why forgetting it on restart is the right trade.
  //
  // Charged HERE, after every validation has passed and immediately before the fetch, because
  // the quota is a budget for outbound requests. A malformed body costs us nothing, so making
  // a client spend quota on their own typo would let a broken caller lock itself out of a
  // service it never used. From this point on an upstream attempt is going to happen, and that
  // is what a unit pays for.
  if (opts.quoteCounter) {
    const now = (opts.now ?? Date.now)()
    if (!opts.quoteCounter.tryConsume(visitorId(clientIp(req), opts.visitorSalt ?? '', now), now)) {
      send(res, 429, {
        error: 'too many quote requests from this address today; the limit resets at 00:00 UTC',
      })
      return
    }
  }

  // The client's own headers are not forwarded AT ALL — not even a scrubbed subset, because
  // `accept-language` alone is a usable fingerprint and no denylist stays ahead of that.
  // This scrub therefore runs over the request WE built: it is the standing guarantee that
  // nothing identity-bearing reaches an upstream from here, including after a later edit
  // that starts forwarding something.
  const headers = scrubClientHeaders(upstream.headers)
  const fetchUpstream = opts.fetchUpstream ?? globalThis.fetch

  let text: string
  let status: number
  try {
    const upstreamRes = await fetchUpstream(upstream.url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(opts.proxyTimeoutMs ?? PROXY_TIMEOUT_MS),
    })
    status = upstreamRes.status
    text = await readCapped(upstreamRes.body, MAX_UPSTREAM_BYTES)
  } catch (e) {
    send(res, 502, { error: `proxying to ${target} failed: ${String(e)}` })
    return
  }

  if (status < 200 || status >= 300) {
    send(res, 502, { error: `${target} answered ${status}` })
    return
  }

  // Parsed and re-serialised rather than piped through: this endpoint answers JSON, and
  // relaying an upstream's bytes verbatim would let it choose our response's shape.
  try {
    send(res, 200, JSON.parse(text))
  } catch {
    send(res, 502, { error: `${target} did not answer JSON` })
  }
}

export interface RelayerServerOptions {
  /** Signs and broadcasts. Injected so everything around it is testable for free. */
  submit: SubmitCalls
  /** The part of the policy that needs no network: the deployed MessageBook, if any. */
  policy?: SubmissionPolicy
  /**
   * The approve ceiling, from the LIVE fee. Called only for batches that contain an
   * approve, so a batch without one does not make chain availability a precondition
   * for being accepted at all.
   */
  resolveApproveCeiling: () => Promise<bigint>
  /** Browser origins permitted to post. Empty means only callers that send no Origin. */
  allowedOrigins?: ReadonlySet<string>
  /**
   * Shared secret required on every request as `x-relayer-auth`. Optional only because
   * a loopback-only relayer has a boundary already; behind a proxy it is mandatory,
   * since content-type is a CSRF control and not authentication.
   */
  authToken?: string
  /**
   * The durable budget. Absent means no budget gate, which is what the tests about
   * everything else want; `main()` always supplies one.
   */
  sponsorship?: SponsorshipLedger
  /** Clock for both day-scoped gates. Injected so a test can stand on either side of 00:00 UTC. */
  now?: () => number
  /**
   * Per-IP daily cap on `POST /api/quote`. Absent means the route is unmetered, which is what
   * the tests about everything else want; `main()` always supplies one.
   */
  quoteCounter?: QuoteCounter
  /**
   * Salt for hashing client addresses. Defaults to the sponsorship ledger's, so both gates
   * bucket the same visitor the same way. Only the quote counter can run without one, and
   * its map is in-process and never written anywhere.
   */
  visitorSalt?: string
  /**
   * Whether the relayer can currently pay. Absent means "assume it can" — the monitor is
   * what knows, and a server started without one is not a server that should refuse.
   */
  relayerState?: () => 'ok' | 'relayer-down'
  /** Outbound fetch for the quote proxy. Injected so no unit test touches the network. */
  fetchUpstream?: typeof fetch
  proxyTimeoutMs?: number
}

export function createRelayerServer(options: RelayerServerOptions): Server {
  // Resolved once, here, so the request path can never hash with an empty salt. An empty salt
  // makes every visitor id a plain hash of the address — the same value on every deployment,
  // so an in-memory key becomes a precomputable one. `main()` always passes the ledger's salt;
  // this covers a server stood up without one, and minting per process is right because the
  // counter it keys is per process and never written down.
  const resolved: RelayerServerOptions = {
    ...options,
    visitorSalt:
      options.visitorSalt || options.sponsorship?.salt || randomBytes(32).toString('hex'),
  }

  return createServer((req, res) => {
    // A client that vanishes mid-request — closed tab, dropped network — makes Node
    // emit 'error' on these streams. An 'error' event with no listener is rethrown as
    // an uncaught exception, and this process is a singleton that must outlive the
    // whole judging session: one dropped connection must not end it. There is nobody
    // left to answer by this point, so noting it is the only action available.
    req.on('error', (e) => console.warn(`relayer: request stream failed: ${e.message}`))
    res.on('error', (e) => console.warn(`relayer: response stream failed: ${e.message}`))

    handle(req, res, resolved).catch((e) => {
      // Last line of defence. Nothing in handle() may escape as an unhandled rejection.
      console.warn(`relayer: unhandled request failure: ${String(e)}`)
      send(res, 500, { error: 'internal error' })
    })
  })
}

/**
 * Returns the first RPC host that actually answers, so a dead primary at boot does not
 * silently become a relayer that cannot submit anything.
 *
 * This probes with a READ, before any key is used and before anything is signed, so
 * there is no double-submission risk. Deliberately NOT retry-on-error for the write
 * path: once a submission has been broadcast, a connection failure and a JSON-RPC
 * error are not distinguishable from here, and retrying the latter risks broadcasting
 * twice. That distinction needs the real submission path and stays deferred.
 */
export async function pickLiveRpcHost(): Promise<string> {
  return withFallback(async (p) => {
    await p.getBlockNumber()
    return p.channel.nodeUrl
  })
}

/**
 * Loopback unless deliberately overridden.
 *
 * `||` rather than `??` on purpose: `??` falls back only on undefined, so a set-but-empty
 * RELAYER_HOST — a .env placeholder, a compose key with no value, an unset CI variable —
 * would reach `listen(port, '')`, which binds every interface. That is the exact opposite
 * of the default, produced by leaving something blank. Empty means unset here, matching
 * how required() already treats it.
 *
 * Exported because the default is a security control, and a control that lives only
 * inside main() is a control no test can reach.
 */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.RELAYER_HOST || '127.0.0.1'
}

/**
 * Browser origins permitted to post, from a comma-separated RELAYER_ALLOWED_ORIGINS.
 *
 * Blanks are filtered, so neither `RELAYER_ALLOWED_ORIGINS=` nor a stray comma can turn
 * into an entry — the same failure the `??`/`||` bug had, an empty value read as
 * permission rather than as absence. There is no wildcard syntax at all: matching is
 * exact Set membership, so a `*` entry would only ever match a literal `Origin: *`,
 * which no browser sends. The empty set means "only callers that send no Origin",
 * which is what doing nothing gets you.
 *
 * Exported for the same reason as resolveHost: a control that lives only inside main()
 * is a control no test can reach.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env.RELAYER_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

/** Everything the sponsorship budget needs to exist, resolved from the environment. */
export interface SponsorshipConfig {
  caps: BudgetCaps
  /** Where the durable ledger lives. Named, so an operator can find, inspect and reset it. */
  storePath: string
  /** Where a funding page goes. Unset means it goes to the log, under a greppable name. */
  opsWebhook: string | undefined
  /** Overrides the salt the store minted. Unset is the normal case and the better one. */
  salt: string | undefined
  /** Funding poll period. Zero disables polling, leaving only the startup check. */
  fundingIntervalMs: number
  /** Per-IP daily ceiling on `POST /api/quote`. Its own counter, never the budget. */
  quoteDailyPerVisitor: number
  /** Daily ceiling on `POST /api/quote` across everyone, for when addresses are cheap. */
  quoteDailyGlobal: number
}

/**
 * A whole decimal integer from the environment, or the default when the value is blank.
 *
 * Blank means unset, matching `resolveHost` and `required()`. Garbage does NOT mean unset:
 * silently substituting the default for `RELAYER_SPONSOR_DAILY=lots` would be the same
 * class of bug as the `??`/`||` one — a value the operator believes they set, quietly not
 * in force. That fails at startup instead.
 *
 * The regex is doing real work, because `Number()` is far too accommodating to be a
 * validator: it reads `'1e3'` as 1000, `'0x10'` as 16, `' 5 '` as 5 and `''` as 0. An
 * operator who writes `1e3` means a thousand and would get one, but they would also get
 * `0x10` read as sixteen and never know — so only plain digits pass, and everything else
 * is a startup error naming the value.
 */
function wholeInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  { min, max = Number.MAX_SAFE_INTEGER }: { min: number; max?: number },
): number {
  const raw = env[name] || ''
  if (!raw) return fallback
  const shape = min > 0 ? 'a positive integer' : 'a non-negative integer'
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be ${shape} in plain decimal digits, not ${JSON.stringify(raw)}`)
  }
  const n = Number(raw)
  // Digits alone are not enough: a twenty-digit value parses without complaint and comes back
  // rounded, so the number in force is not the number that was written. Silently operating on
  // a different value than the operator typed is the failure this whole resolver guards against.
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `${name} is too large to represent exactly (${JSON.stringify(raw)}); the value that would ` +
        `take effect is ${n}, which is not what you wrote.`,
    )
  }
  if (n < min || n > max) {
    throw new Error(`${name} must be ${shape} between ${min} and ${max}, not ${JSON.stringify(raw)}`)
  }
  return n
}

const positiveInt = (env: NodeJS.ProcessEnv, name: string, fallback: number, max?: number) =>
  wholeInt(env, name, fallback, { min: 1, max })

const nonNegativeInt = (env: NodeJS.ProcessEnv, name: string, fallback: number, max?: number) =>
  wholeInt(env, name, fallback, { min: 0, max })

/**
 * An operator-supplied visitor salt, checked before it is trusted.
 *
 * A short salt is worse than no salt, because it looks like one. The whole IPv4 space is
 * 2^32 hashes; a salt only raises the cost of a precomputed table, and `RELAYER_VISITOR_SALT=1`
 * raises it by nothing while reading in a config file as though privacy had been configured.
 * 32 hex characters is 128 bits, which is what `openssl rand -hex 32` gives by default.
 */
function resolveVisitorSalt(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.RELAYER_VISITOR_SALT || ''
  if (!raw) return undefined
  // The same predicate the store applies to a salt loaded from disk, so an environment salt
  // and a hand-edited file salt cannot be held to two different standards.
  if (!isAcceptableSalt(raw)) {
    throw new Error(
      'RELAYER_VISITOR_SALT must be at least 32 hexadecimal characters. Generate one with ' +
        '`openssl rand -hex 32`, or leave it unset and let the store mint its own.',
    )
  }
  return raw
}

/**
 * The sponsorship surface, on the `resolveHost` pattern: `||` semantics, blanks are
 * absence, and exported because a limit that lives only inside main() is a limit no test
 * can reach.
 *
 * The defaults are small on purpose. This relayer's operating rule is to fund the wallet
 * with what the current batch needs (see the header), and a default budget generous enough
 * to be convenient would quietly undo that — a misconfigured deployment should cost a demo,
 * not a balance. One sponsored submission per visitor per day, twenty across everyone.
 */
export function resolveSponsorshipCaps(env: NodeJS.ProcessEnv = process.env): SponsorshipConfig {
  return {
    caps: {
      perVisitor: positiveInt(env, 'RELAYER_SPONSOR_PER_VISITOR', 1),
      daily: positiveInt(env, 'RELAYER_SPONSOR_DAILY', 20),
    },
    storePath:
      env.RELAYER_SPONSOR_STORE ||
      fileURLToPath(new URL('../../../.relayer/sponsorship.json', import.meta.url)),
    opsWebhook: env.RELAYER_OPS_WEBHOOK || undefined,
    salt: resolveVisitorSalt(env),
    // Non-negative, unlike the caps: 0 is a meaningful setting here (poll never, keep the
    // startup check), whereas a cap of 0 would just be a closed door with extra steps. Bounded
    // above because Node clamps a timer past 2^31-1 to 1ms — "poll monthly" would become a hot
    // loop, and refusing at startup beats discovering it from an RPC provider's rate limit.
    fundingIntervalMs: nonNegativeInt(env, 'RELAYER_FUNDING_INTERVAL_MS', 300_000, MAX_TIMER_MS),
    // Generous next to the sponsorship caps because a quote costs egress, not STRK — the cap
    // is here so the proxy cannot be turned into someone's free anonymity service, not to
    // ration a resource we are short of.
    quoteDailyPerVisitor: positiveInt(env, 'RELAYER_QUOTE_DAILY_PER_VISITOR', 100),
    // The per-visitor cap alone bounds one address, not the bill: a rotating IPv6 /64 gives an
    // attacker a fresh visitor id per request, so without a global ceiling the "cap" is only a
    // speed limit per identity they can mint for free. Same reasoning as the daily budget.
    quoteDailyGlobal: positiveInt(env, 'RELAYER_QUOTE_DAILY_GLOBAL', 1_000),
  }
}

/** What must be true before running off-loopback, or null when it is loopback. */
export function offHostWarning(host: string): string | null {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null
  return (
    `WARNING: bound to ${host}, not loopback. This signer is reachable off-host. ` +
    `Do not run this way without authentication and rate limiting in front of it: ` +
    `the allowlist bounds what may be signed, not by whom or how often, so an ` +
    `exposed port still lets anyone spend up to the approve ceiling per submission.`
  )
}

/**
 * The deployed MessageBook, if there is one. Absent before Task 7 deploys it, which is
 * not an error: the pool and STRK entries stand on their own, and an allowlist that is
 * missing an entry refuses too much rather than too little.
 */
function deployedMessageBook(): string | undefined {
  try {
    const raw = readFileSync(new URL('../../../evidence/deployment.json', import.meta.url), 'utf8')
    return (JSON.parse(raw) as { contractAddress?: string }).contractAddress
  } catch {
    return undefined
  }
}

/**
 * Opens the durable ledger, honouring an operator-supplied salt.
 *
 * The store mints its own salt on first boot and that is the better default — nobody has to
 * hold it, and it dies with the file. `RELAYER_VISITOR_SALT` exists for the operator who
 * wants to choose or rotate it deliberately. Writing a new salt re-keys every visitor id,
 * so today's per-visitor counters stop matching the visitors they were counting; the daily
 * budget, which is not keyed by visitor, is unaffected.
 */
export function openSponsorshipLedger(config: SponsorshipConfig): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.storePath)
  if (config.salt) {
    const record = store.load()
    if (record.salt !== config.salt) store.save({ ...record, salt: config.salt })
  }
  return new SponsorshipLedger(config.caps, store)
}

/**
 * Recombines a Cairo `u256` from the two felts it arrives as, low limb first.
 *
 * Split out and exported because it is the one piece of the balance read that can be wrong
 * while everything around it looks right. Swap the limbs, or shift by 64 instead of 128, and
 * every realistic balance still comes back plausible — small numbers live entirely in the low
 * limb, so the bug only appears above 2^128 and only as a wildly wrong number nobody is
 * expecting. Every gate test stubs the read, so without a direct test on this line the shift
 * is unverified.
 */
export function u256FromFelts(low: string, high: string): bigint {
  return BigInt(low) + (BigInt(high) << 128n)
}

/** The relayer wallet's STRK balance — the funds every fee it signs is actually paid from. */
export async function readStrkBalance(owner: string): Promise<bigint> {
  const [low, high] = await withFallback((p) =>
    p.callContract({
      contractAddress: STRK_TOKEN,
      entrypoint: 'balanceOf',
      calldata: [owner],
    }),
  )
  return u256FromFelts(low!, high!)
}

/**
 * Where a funding page goes: a webhook when one is configured, the log otherwise.
 *
 * The log is a real destination, not a placeholder — it is prefixed `relayer: OPS` so it is
 * greppable and so it does not read like the ordinary warnings around it. What it must never
 * do is fail silently, hence the catch: a page that throws in the middle of a poll would
 * stop the poll, and then the monitor is gone precisely when it matters.
 */
export function makeOpsPager(
  webhook: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
): (message: string) => void {
  return (message) => {
    console.warn(`relayer: OPS ${message}`)
    if (!webhook) return
    void fetchImpl(webhook, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: `relayer: ${message}` }),
      signal: AbortSignal.timeout(OPS_WEBHOOK_TIMEOUT_MS),
    })
      .then((r) => {
        // A 404 from a rotated webhook, or a 403 from a revoked one, RESOLVES — so `.catch`
        // never fires and the page is lost in silence. Which is the worst possible outcome
        // for a pager: it looks configured, it looks quiet, and it delivers nothing.
        if (!r.ok) console.warn(`relayer: ops webhook answered ${r.status}; page not delivered`)
      })
      .catch((e) => console.warn(`relayer: ops webhook failed: ${String(e)}`))
  }
}

async function main(): Promise<void> {
  // Before required(), so a populated .env is actually seen. required() still throws on
  // a genuinely missing secret afterwards — loading a file is not the same as finding
  // the variable in it, and the relayer must still refuse to start without a key.
  const envFile = loadDotEnv()
  if (envFile.loaded) console.log(`relayer: loaded ${envFile.path}`)
  else if (envFile.path) console.warn(`relayer: WARNING ${envFile.reason}`)

  const address = required('RELAYER_ADDRESS')
  const privateKey = required('RELAYER_PRIVATE_KEY')
  const port = Number(process.env.PORT ?? 8787)
  const host = resolveHost()
  const allowedOrigins = resolveAllowedOrigins()

  // Before the socket opens. A ledger that cannot be read or written is not something to
  // discover on the first submission — by then the budget is already unaccounted for.
  const sponsorConfig = resolveSponsorshipCaps()
  const sponsorship = openSponsorshipLedger(sponsorConfig)

  const nodeUrl = await pickLiveRpcHost()
  const account = new Account({
    provider: new RpcProvider({ nodeUrl }),
    address,
    signer: privateKey,
  })

  const monitor: FundingMonitor = createFundingMonitor({
    readBalance: () => readStrkBalance(address),
    readFeeWei: async () => (await readPoolConstants()).feeWei,
    pageOps: makeOpsPager(sponsorConfig.opsWebhook),
    intervalMs: sponsorConfig.fundingIntervalMs,
  })

  const messageBook = deployedMessageBook()
  const server = createRelayerServer({
    // `details` is undefined for a plain submission, which is what `execute` already
    // defaults to — so a `{calls}`-only body goes out byte-identical to before, and a
    // proven one carries proofFacts into the V3 transaction fields.
    submit: async (calls, details) => {
      const { transaction_hash } = await account.execute(calls, details)
      return transaction_hash
    },
    policy: { messageBook },
    resolveApproveCeiling: async () => approveCeiling((await readPoolConstants()).feeWei),
    allowedOrigins,
    authToken: process.env.RELAYER_AUTH_TOKEN || undefined,
    sponsorship,
    visitorSalt: sponsorship.salt,
    quoteCounter: createQuoteCounter(
      sponsorConfig.quoteDailyPerVisitor,
      sponsorConfig.quoteDailyGlobal,
    ),
    // Refuse rather than sign when the wallet cannot cover the fee. Signing anyway buys a
    // revert that still costs gas and reads to the user as our bug. `userState` reports ok
    // while the health is `unknown`, so a failed read cannot turn an RPC blip into an outage.
    relayerState: () => monitor.userState(),
  })

  // One read now, then on a timer. The startup read is what turns "we would have noticed
  // eventually" into "we knew before the first submission"; it is awaited so the first line
  // the operator sees already reflects the real balance, and so the gate above is answering
  // from a measurement rather than from `unknown` when the first request lands.
  await monitor.check()
  monitor.start()

  server.listen(port, host, () => {
    console.log(`relayer listening on ${host}:${port}, submitting as ${address} via ${nodeUrl}`)
    console.log(`allowlist: pool ${NET.pool} · STRK approve-to-pool only`)
    console.log(messageBook ? `allowlist: MessageBook ${messageBook}` : 'allowlist: no MessageBook deployed yet')
    console.log(
      allowedOrigins.size
        ? `origins: ${[...allowedOrigins].join(', ')}`
        : 'origins: none — only callers that send no Origin header',
    )
    console.log(
      `sponsorship: ${sponsorConfig.caps.perVisitor}/visitor · ${sponsorConfig.caps.daily}/day · ` +
        `ledger ${sponsorConfig.storePath}`,
    )
    console.log(
      `funding: STRK balance ${monitor.health()} · ` +
        `${sponsorConfig.fundingIntervalMs ? `polling every ${sponsorConfig.fundingIntervalMs}ms` : 'startup check only'} · ` +
        `pages to ${sponsorConfig.opsWebhook ?? 'the log'}`,
    )
    if (monitor.userState() === 'relayer-down') {
      console.warn('  submissions are being REFUSED until the relayer wallet is topped up.')
    }
    console.log(
      `proxy: ${Object.values(PROXY_TARGETS).map((t) => t.host).join(', ')} · ` +
        `${sponsorConfig.quoteDailyPerVisitor} quotes/visitor/day · ` +
        `${sponsorConfig.quoteDailyGlobal}/day overall`,
    )
    const warning = offHostWarning(host)
    if (warning) console.warn(warning)
  })
}

// Only when run directly. Importing this module (tests, tooling) must stay side-effect
// free, but launching it must still fail loudly on a missing secret before it listens.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
