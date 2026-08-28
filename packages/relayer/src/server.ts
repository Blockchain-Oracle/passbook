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
  assertResourceBounds,
  type ResourceBounds,
} from './allowlist.js'
import type {
  InviteClaimResponse,
  InviteMintResponse,
  InviteStatusResponse,
  SubmitBody,
} from '../../protocol/src/relayer-wire.js'
import {
  SEND_CAP_NOTICE,
  SponsorshipLedger,
  utcDayKey,
  type BudgetCaps,
  type SponsorDecision,
} from './sponsorship.js'
import { FileSponsorshipStore, isAcceptableSalt } from './sponsorship-store.js'
import { InviteLedger, normalizeCode, type InviteConfig } from './invite.js'
import { openDirectory, type Directory } from './directory.js'
import { createChainKeeperDeps, runKeeperPass } from './keeper.js'
import {
  NO_APP_CONTRACTS,
  parseAppContracts,
  type AppContracts,
} from '../../protocol/src/app-contracts.js'
import { FileInviteStore } from './invite-store.js'
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
import { isWireEnvelope, RoomHub, ROOM_HISTORY, ROOM_IDLE_MS } from './rooms.js'
import { ChainFeed, APP_POLL_MS, PRICE_POLL_MS, HISTORY_BOUND } from './chain-feed.js'
import { openGroundskeeper } from './groundskeeper.js'
import {
  DRIP_ALREADY_CLAIMED,
  DRIP_BAD_ADDRESS,
  DRIP_BUDGET_SPENT,
  DRIP_WEI,
  dripCall,
  isDrippableAddress,
} from './faucet.js'
import { asAddress, toFeltHex } from '../../protocol/src/address.js'
import { handleLogoGenerate, handleLogoPin, type LogoService } from './logo.js'
import {
  openTeller,
  tellerChainDeps,
  TELLER_INTERVAL_MS,
  type Teller,
} from './teller.js'

// R10 names `POST /submit`; the browser posts to the same-origin `/api/submit`, which
// a dev-server proxy or edge rule normally rewrites. Accepting both means the two
// halves connect whether or not that rewrite is in place.
const SUBMIT_PATHS = new Set(['/submit', '/api/submit'])

// The third-party proxy (FR-029). Both spellings for the same reason as SUBMIT_PATHS.
const QUOTE_PATHS = new Set(['/quote', '/api/quote'])

// Where a client asks which address a fee reimbursement should name (story 1.16). Both
// spellings for the same reason as SUBMIT_PATHS.
const FEE_RECIPIENT_PATHS = new Set(['/fee-recipient', '/api/fee-recipient'])

// The invite substrate (story 1.14). Both spellings for the same reason as SUBMIT_PATHS.
//
// THERE IS NO `/i/<code>` ROUTE HERE, and there must not be one. The invite link's job is to
// open the WEB APP, which then claims through an ordinary JSON POST to `/invite/claim` like
// everything else. A path-parameter route would mean teaching `handle()` — the one function
// every security gate in this file lives in — to parse a path prefix, and it would buy nothing
// the app cannot already do.
const INVITE_MINT_PATHS = new Set(['/invite/mint', '/api/invite/mint'])
const INVITE_CLAIM_PATHS = new Set(['/invite/claim', '/api/invite/claim'])
const INVITE_STATUS_PATHS = new Set(['/invite/status', '/api/invite/status'])
const DIRECTORY_CLAIM_PATHS = new Set(['/directory/claim', '/api/directory/claim'])
const DIRECTORY_LIST_PATHS = new Set(['/directory/list', '/api/directory/list'])
const DIRECTORY_AVATAR_PATHS = new Set(['/directory/avatar', '/api/directory/avatar'])
// The X-binding leg. Server-to-server only — see the handler's note; deliberately NO literal
// file under `api/directory/` so the browser-facing proxy never carries it.
const DIRECTORY_XBIND_PATHS = new Set(['/directory/x-bind', '/api/directory/x-bind'])

// The chat transport (B3). Both spellings for the same reason as SUBMIT_PATHS.
//
// BOTH ARE POSTS, INCLUDING THE ONE THAT STREAMS, and that is this file's rule showing up rather
// than a preference. The room id would naturally live in the path or a query string, and either
// would mean teaching `handle()` to parse a URL — the thing the invite note above refuses for the
// same reason. It travels in the JSON body instead, which costs the client nothing and keeps
// every gate matching an exact string.
//
// It also keeps the two controls that a `GET` would give away. `EventSource` — the browser API a
// streaming GET exists for — cannot set a request header at all: not `content-type`, which is
// what separates a cross-origin page from this port, and not `x-relayer-auth`, which is the only
// control that survives a proxy. A page on any origin could open an EventSource against a room id
// it guessed; it cannot open this. The client reads the stream with `fetch` and a reader instead.
//
// The starter drip. One path pair, same shape as everything above, and it is 404 on a relayer
// with no faucet ledger — for the invite routes' reason: this deployment does not hand out STRK
// at all, so there is nothing for a client to retry.
//
const FAUCET_PATHS = new Set(['/faucet', '/api/faucet'])
const ROOM_STREAM_PATHS = new Set(['/room/stream', '/api/room/stream'])
const ROOM_SEND_PATHS = new Set(['/room/send', '/api/room/send'])

// The chain feed (see `chain-feed.ts`). A POST that streams, for ROOM_STREAM_PATHS' reasons
// verbatim — same gates, same framing, same client-side reader discipline.
const CHAIN_STREAM_PATHS = new Set(['/chain/stream', '/api/chain/stream'])

// The logo studio (`logo.ts`). Each route exists only when its key does — the faucet's
// no-ledger-no-route rule, applied per upstream: a relayer with a Pinata JWT and no Gemini key
// pins uploads and 404s generation, and the create form reads each 404 as "this lane is off".
const LOGO_PIN_PATHS = new Set(['/logo/pin', '/api/logo/pin'])
const LOGO_GENERATE_PATHS = new Set(['/logo/generate', '/api/logo/generate'])

// The Teller's one public door: minting a tally key for a proposal about to be made. Minting is
// local and free; what it hands out is a PUBLIC key, and the secret never leaves the ledger.
const TALLY_KEY_PATHS = new Set(['/govern/tally-key', '/api/govern/tally-key'])

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

// A submission is a handful of calls PLUS, on a proven one, the proof blob — measured
// at 308-309K characters of base64 on story 1.13's real mainnet prove, so one megabyte
// carries it with roughly 3x headroom while still refusing an unbounded body. A future
// proof that outgrows the cap is refused as a 400 `request body too large` before the
// allowlist or any budget runs; if that ever fires on a legitimate prove, this number
// is the thing to raise, knowingly, not the refusal to soften.
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
  /**
   * Explicit v3 resource bounds, so the submitter SKIPS fee estimation.
   *
   * ── WHY THIS FIELD HAD TO EXIST ─────────────────────────────────────────────────────────
   *
   * `Account.execute` forwards `proofFacts`/`proof` to `invokeFunction` — the broadcast — and to
   * NOTHING else. `prepareInvoke` runs first, and when no bounds are supplied it calls
   * `starknet_estimateFee`, which therefore simulates the transaction with the proof ABSENT.
   * `apply_actions` reverts for want of a proof and the estimate throws before anything is signed.
   *
   * Registration is the one proven case that escapes it: a zero-deposit `SetViewingKey` needs no
   * proof, so its unproven estimate succeeds. Every value-moving pool transaction dies there — which
   * is why, until this field, the relayer could not submit one at all.
   *
   * Supplying bounds makes `prepareInvoke` skip the estimate entirely (`if (!resourceBounds)`).
   * They are CEILINGS, not charges: the transaction pays what it uses.
   */
  resourceBounds?: ResourceBounds
  proofFacts?: string[]
  /**
   * The proof blob the facts belong to. Present exactly when `proofFacts` is — the
   * sequencer takes both or neither (story 1.13's first real broadcast proved it), and
   * `handleSubmit` refuses a body carrying one without the other before anything is
   * signed. Passed through to starknet.js whole; the sequencer, not this server, is the
   * party that can judge the proof itself.
   */
  proof?: string
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
  const isFeeRecipient = req.method === 'GET' && FEE_RECIPIENT_PATHS.has(url)
  // An invite route on a relayer with no invite ledger is NOT FOUND rather than refused, which
  // is the honest answer: this deployment does not offer invites at all, so there is no code to
  // present and nothing for a client to retry. `/submit` is the one place a presented code gets
  // a typed refusal instead, because there the client has already built a body around it.
  const isInvite =
    opts.invites !== undefined &&
    (INVITE_MINT_PATHS.has(url) || INVITE_CLAIM_PATHS.has(url) || INVITE_STATUS_PATHS.has(url))
  // A relayer with no hub answers 404 on both room routes, on the same reasoning as the invite
  // ones: this deployment does not carry chat at all, so there is nothing for a client to retry.
  const isRoom = opts.rooms !== undefined && (ROOM_STREAM_PATHS.has(url) || ROOM_SEND_PATHS.has(url))
  // Same rule again for the name directory: no ledger, no routes.
  const isDirectory =
    opts.directory !== undefined &&
    (DIRECTORY_CLAIM_PATHS.has(url) ||
      DIRECTORY_LIST_PATHS.has(url) ||
      DIRECTORY_AVATAR_PATHS.has(url) ||
      DIRECTORY_XBIND_PATHS.has(url))
  // And again for the drip. NO LEDGER, NO ROUTE — and here that rule is doing more work than
  // elsewhere: the ledger is the only thing bounding how much of the relayer's wallet this route
  // can give away, so a faucet that ran without one would be an unmetered transfer endpoint.
  const isFaucet = opts.faucet !== undefined && FAUCET_PATHS.has(url)
  // No feed, no route — the invite rule again: a deployment with nothing to stream answers 404,
  // and the browser's store reads that as "poll for yourself", which it already knows how to do.
  const isChainStream = opts.chainFeed !== undefined && CHAIN_STREAM_PATHS.has(url)
  // Per-route key gating: each logo lane exists exactly when its credential does.
  const isLogoPin = opts.logos?.pinataJwt !== undefined && LOGO_PIN_PATHS.has(url)
  const isLogoGenerate = opts.logos?.geminiKey !== undefined && LOGO_GENERATE_PATHS.has(url)
  // No Teller, no route — the ledger rule: this deployment tallies no votes.
  const isTallyKey = opts.teller !== undefined && TALLY_KEY_PATHS.has(url)
  if (
    !isFeeRecipient &&
    (req.method !== 'POST' ||
      !(
        isSubmit ||
        isInvite ||
        isRoom ||
        isDirectory ||
        isFaucet ||
        isChainStream ||
        isLogoPin ||
        isLogoGenerate ||
        isTallyKey ||
        QUOTE_PATHS.has(url)
      ))
  ) {
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
  //
  // SKIPPED FOR THE FEE-RECIPIENT GET, and only because there is nothing for it to do there:
  // this is a CSRF control, it works by being a content-type a cross-origin form cannot send,
  // and a GET has no body to declare a type for. Requiring one would make the endpoint
  // unreachable from a plain fetch while buying nothing — the request writes nothing, signs
  // nothing and returns an address that is already public in every transaction we submit. The
  // Origin and auth gates below still apply to it, so it is behind the same door as everything
  // else; it is only this one lock that does not fit the shape of a GET.
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (!isFeeRecipient && contentType !== 'application/json') {
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
  if (isFeeRecipient) {
    handleFeeRecipient(res, opts)
    return
  }
  // BEHIND ALL FOUR GATES ABOVE, in the same order, for the same reasons. An invite mint is a
  // write against a giveaway allowance and a claim is a burn; an unauthenticated one is a
  // stranger spending somebody's invites and probing codes. Same door, same lock.
  if (isInvite) {
    await handleInvite(req, res, url, opts)
    return
  }
  // Same door, same lock, and the directory is the one record that WANTS to be read — the gates
  // here are about writes (a claim is a durable public statement) and about not being a free
  // fetch proxy for whoever finds the port.
  if (isDirectory) {
    await handleDirectory(req, res, url, opts)
    return
  }
  // BEHIND ALL FOUR GATES, and of everything dispatched here this is the one that most obviously
  // spends money — so it is worth saying plainly that the gates are not what bounds it. They stop
  // a web page from reaching the route; the caps in `handleFaucet` are what stop a caller who
  // reaches it legitimately from draining the wallet.
  if (isFaucet) {
    await handleFaucet(req, res, opts)
    return
  }
  // BEHIND ALL FOUR GATES, like everything else, and the reason is not that chat spends money —
  // it cannot, the hub never touches the key. It is that an open broadcast bus on a funded
  // signer's host is a free anonymous relay pointed at this machine's egress, and the first
  // symptom would be an abuse report naming an address that also signs transactions.
  if (isRoom) {
    await (ROOM_STREAM_PATHS.has(url)
      ? handleRoomStream(req, res, opts)
      : handleRoomSend(req, res, opts))
    return
  }
  // BEHIND ALL FOUR GATES like the rooms, and for the rooms' reason — not because public chain
  // state is a secret (it is not), but because an unauthenticated held-open stream on a funded
  // signer's host is a connection-exhaustion primitive pointed at everything else this port does.
  if (isChainStream) {
    await handleChainStream(req, res, opts)
    return
  }
  // BEHIND ALL FOUR GATES — these two spend a credential's quota and, for generation, real
  // money per call; the meters inside the handlers are what bound a caller the gates admitted.
  if (isLogoPin || isLogoGenerate) {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (e) {
      send(res, 400, { error: String(e) })
      return
    }
    const visitor = visitorId(clientIp(req), opts.visitorSalt ?? '', (opts.now ?? Date.now)())
    await (isLogoPin
      ? handleLogoPin(req, res, opts.logos!, visitor, body, send)
      : handleLogoGenerate(req, res, opts.logos!, visitor, body, send))
    return
  }
  if (isTallyKey) {
    try {
      await readJsonBody(req)
    } catch {
      // A bare POST is fine — the mint takes no arguments.
    }
    try {
      const publicX = opts.teller!.mintKey()
      send(res, 200, { tallyKey: `0x${publicX.toString(16)}` })
    } catch (e) {
      console.warn(`relayer: teller ledger write failed: ${String(e)}`)
      send(res, 500, { error: 'the tally key could not be recorded; refusing to hand one out' })
    }
    return
  }
  await (isSubmit ? handleSubmit(req, res, opts) : handleQuote(req, res, opts))
}

/**
 * The three invite routes (story 1.14). Wiring only — every rule lives in `invite.ts`.
 *
 * The ledger's mutators write the durable store before they mutate memory, so any of them can
 * throw on a full disk or a permissions change. That escaping would leave the request
 * unanswered; it is caught here and answered 500, because an unrecordable mint or burn is one
 * we refuse to make rather than one we make and forget.
 */
async function handleInvite(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  opts: RelayerServerOptions,
): Promise<void> {
  const invites = opts.invites!
  const now = (opts.now ?? Date.now)()

  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }
  // `JSON.parse('null')` succeeds, and so do `'7'` and `'[]'` — the same shape check `handleQuote`
  // does, and for the same reason: destructuring any of them yields undefined for every field.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    send(res, 400, { error: 'body must be a JSON object' })
    return
  }

  try {
    if (INVITE_MINT_PATHS.has(url)) {
      // Keyed on the connecting address, NEVER on anything the body says. An inviter the caller
      // names is an allowance the caller chooses, which is not an allowance.
      const decision = invites.mint(invites.inviterKey(clientIp(req)), now)
      const body: InviteMintResponse = decision.allow
        ? {
            code: decision.code,
            expiresAt: decision.expiresAt,
            left: decision.left,
            nextInHours: decision.nextInHours,
          }
        : {
            // NOT A LOCKED DOOR: the refusal carries the numbers that make it a sentence with a
            // clock in it, so the surface can say when one returns rather than greying out. The
            // error text stays true for BOTH refusals — this inviter's window being spent and
            // the relayer's global daily mint ceiling — because to the person pressing the
            // button they are the same fact; `reason` carries the distinction for ops.
            error: 'no invites can be minted right now; the refusal carries when one returns',
            reason: decision.reason,
            left: decision.left,
            nextInHours: decision.nextInHours,
            notice: decision.notice,
          }
      send(res, decision.allow ? 200 : 429, body)
      return
    }

    const code = normalizeCode((parsed as { code?: unknown }).code)
    if (code === null) {
      // Refused before the ledger sees it and WITHOUT counting a claim attempt: a malformed
      // string is not a guess at a code, and charging one against the cap would let a broken
      // client lock itself out of an invite it holds.
      send(res, 400, { error: 'body must carry a six-character `code` string' })
      return
    }

    if (INVITE_CLAIM_PATHS.has(url)) {
      // `claimant` is the client's idempotency token — random, minted by the claiming browser,
      // held so a retry of a claim whose response was lost gets the same yes. NOT an identity
      // and NOT the visitor id: visitor ids are IP-scoped, and behind one NAT the loser of a
      // double-claim is indistinguishable from the winner by IP. Optional (a claim without one
      // simply has no replay), but if present it must be sane — a silent coercion here would
      // burn a code under a token nobody actually holds.
      const rawClaimant = (parsed as { claimant?: unknown }).claimant
      if (
        rawClaimant !== undefined &&
        (typeof rawClaimant !== 'string' || rawClaimant.length < 8 || rawClaimant.length > 128)
      ) {
        send(res, 400, { error: '`claimant`, when present, must be a string of 8 to 128 characters' })
        return
      }
      const visitor = visitorId(clientIp(req), invites.salt, now)
      const decision = invites.claim(code, visitor, now, rawClaimant)
      if (decision.allow) {
        send(res, 200, { claimed: true } satisfies InviteClaimResponse)
        return
      }
      // 409 for the loser of a race — the request was well formed and arrived at a real code
      // that somebody else won — and 429 for a visitor who has spent their attempts. An unknown
      // code shares the 409 for tidiness, NOT as an enumeration defence: the body's `reason`
      // token legitimately distinguishes not-found from already-used (the client's typed
      // branches depend on it), so anyone reading bodies learns which codes exist either way.
      // What actually stands between a guesser and the code space is the attempt cap — every
      // miss here is charged, cap-first, in the ledger.
      const status = decision.reason === 'invite-too-many-attempts' ? 429 : 409
      send(res, status, {
        error: `this invite cannot be claimed (${decision.reason})`,
        reason: decision.reason,
        notice: decision.notice,
      } satisfies InviteClaimResponse & { error: string })
      return
    }

    // The status poll is charged the same per-visitor attempt cap as a claim, but ONLY on a
    // miss — see `InviteLedger.status`. Without that this route would answer "is this code live
    // and unclaimed" for free and without limit, which is the exact question the claim cap
    // exists to make expensive.
    const decision = invites.status(code, visitorId(clientIp(req), invites.salt, now), now)
    if (!decision.found) {
      send(res, decision.reason === 'invite-too-many-attempts' ? 429 : 404, {
        error: `no invite to report on (${decision.reason})`,
        reason: decision.reason,
      } satisfies InviteStatusResponse & { error: string })
      return
    }
    send(res, 200, { state: decision.state } satisfies InviteStatusResponse)
  } catch (e) {
    console.warn(`relayer: invite ledger write failed: ${String(e)}`)
    send(res, 500, { error: 'the invite ledger could not be written; refusing to mint or burn' })
  }
}

/**
 * The three directory routes. Wiring only — every rule lives in `directory.ts`, where a test
 * can execute it without a socket.
 */
async function handleDirectory(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  opts: RelayerServerOptions,
): Promise<void> {
  const directory = opts.directory!

  if (DIRECTORY_LIST_PATHS.has(url)) {
    // The body is read and discarded — the route is POST for gate symmetry, but a list takes no
    // arguments ON PURPOSE: a parameterised search here would tell this process who is looking
    // for whom, and the client-side match over the whole (small) list is the private version.
    try {
      await readJsonBody(req)
    } catch {
      // A bare POST with no body is fine for a read.
    }
    send(res, 200, { entries: directory.list() })
    return
  }

  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  if (DIRECTORY_AVATAR_PATHS.has(url)) {
    const address = (parsed as { address?: unknown } | null)?.address
    send(res, 200, { avatar: directory.avatar(address) })
    return
  }

  //
  // THE X BINDING — a server-to-server leg, and the second secret is the boundary. The Vercel
  // `api/x/link.js` function is the only intended caller: it verified a live X OAuth session
  // before it got here. Two things keep a browser out. First, no literal file exists at
  // `api/directory/x-bind.js`, so the same-origin proxy never routes the path (the measured
  // single-segment catch-all fact). Second — because a routing accident must not become an
  // identity oracle — the route additionally demands `x-passbook-xbind` matching
  // `RELAYER_XBIND_SECRET`, a secret only the two servers hold. The forwarder attaches the auth
  // token to EVERYTHING, so the auth token alone cannot distinguish our function from a browser.
  //
  if (DIRECTORY_XBIND_PATHS.has(url)) {
    const expected = opts.xBindSecret
    if (!expected) {
      send(res, 404, { error: 'not found' })
      return
    }
    if (!tokenMatches(expected, req.headers['x-passbook-xbind'])) {
      send(res, 401, { error: 'missing or invalid x-passbook-xbind' })
      return
    }
    try {
      const outcome = await directory.bindX(parsed)
      if (outcome.ok) send(res, 200, { ok: true })
      else send(res, outcome.status, { error: outcome.error })
    } catch (e) {
      console.warn(`relayer: directory ledger write failed: ${String(e)}`)
      send(res, 500, { error: 'the directory could not be written; the binding was not recorded' })
    }
    return
  }

  try {
    const outcome = await directory.claim(parsed)
    if (outcome.ok) send(res, 200, { ok: true })
    else send(res, outcome.status, { error: outcome.error })
  } catch (e) {
    console.warn(`relayer: directory ledger write failed: ${String(e)}`)
    send(res, 500, { error: 'the directory could not be written; the claim was not recorded' })
  }
}

/**
 * How often a live stream writes a comment line into the socket.
 *
 * Not for the client — it has an open reader and needs no reassurance. It is for everything
 * BETWEEN: proxies and load balancers close a connection that has been silent, and on a chat
 * surface that reads as the app being broken rather than as a middlebox being thrifty. Well under
 * the shortest idle timeout in common use (60s on most, 30s on a few).
 */
const ROOM_HEARTBEAT_MS = 20_000

/**
 * The most rooms one stream may multiplex. A conversation list needs one per open thread;
 * thirty-two is far past any real sidebar and low enough that a hostile client cannot use one
 * socket to hold a subscriber slot in every room the hub has.
 */
export const MAX_ROOMS_PER_STREAM = 32

/** The refusals the hub can answer with, mapped to what a client should be told and do. */
const ROOM_REFUSAL_STATUS: Record<string, number> = {
  'bad-room-id': 400,
  'bad-envelope': 400,
  'envelope-too-large': 413,
  'too-many-rooms': 503,
  'room-full': 503,
  'rate-limited': 429,
}

/**
 * `POST /api/room/send` — hand one sealed envelope to the bus.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO: look inside. It checks that the body is a small
 * JSON object with the four envelope fields and a well-formed room id, and then passes the
 * envelope through as an opaque string. There is no key here to open it with and no field whose
 * meaning this side is entitled to have an opinion about.
 */
async function handleRoomSend(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RelayerServerOptions,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    send(res, 400, { error: 'body must be a JSON object' })
    return
  }

  const { room, envelope } = parsed as { room?: unknown; envelope?: unknown }
  if (typeof room !== 'string') {
    send(res, 400, { error: 'room must be a string' })
    return
  }
  if (!isWireEnvelope(envelope)) {
    send(res, 400, { error: 'envelope must be {v:1, iv, ct, from}' })
    return
  }

  // Re-serialised rather than forwarded verbatim: the string that reaches the hub is then exactly
  // the four fields it was narrowed to, so a caller cannot smuggle a megabyte of extra keys past
  // a shape check that only looked at four of them.
  const wire = JSON.stringify({ v: 1, iv: envelope.iv, ct: envelope.ct, from: envelope.from })
  const result = opts.rooms!.publish(room, wire)
  if (!result.ok) {
    send(res, ROOM_REFUSAL_STATUS[result.reason] ?? 400, { error: result.reason })
    return
  }
  // `delivered` is how many sockets took it, NOT how many people read it. A zero is the ordinary
  // shape of a shut tab — the envelope is buffered — so a client must not render it as a failure.
  send(res, 200, { delivered: result.delivered })
}

/**
 * `POST /api/room/stream` — subscribe, and keep the socket open.
 *
 * The response is `text/event-stream`, so the framing is SSE's even though the request is a POST
 * (see ROOM_STREAM_PATHS for why it is a POST). That framing is worth keeping rather than
 * inventing one: `data:` lines, a blank line between events, `:` for a comment. What is dropped is
 * `EventSource` on the client, which cannot send a header and so cannot be used here anyway.
 */
async function handleRoomStream(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RelayerServerOptions,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  //
  // ONE SOCKET, N ROOMS. A conversation list holds every room open at once, and N parallel
  // proxied streams from one browser both burn a serverless connection each and collide with
  // HTTP/1.1's per-host cap — so the stream multiplexes. `{room}` (one string) remains accepted
  // verbatim: it is the wire shape every deployed client speaks today.
  //
  // WHAT THIS TELLS THE RELAYER, stated because the room design's whole argument is what the
  // relayer cannot see: a multiplexed subscribe says explicitly that these N rooms share one
  // participant. N separate streams arriving on one connection at one instant already said the
  // same thing — this makes the linkage plain rather than pretending it away. The relayer still
  // cannot read a byte of any of them.
  //
  const body = parsed as { room?: unknown; rooms?: unknown } | null
  let roomIds: string[]
  if (typeof body?.room === 'string') {
    roomIds = [body.room]
  } else if (Array.isArray(body?.rooms) && body.rooms.every((r): r is string => typeof r === 'string')) {
    // Deduplicated rather than refused: a client that lists a room twice wants it once, and
    // double-subscribing would double-deliver fifty envelopes of history.
    roomIds = [...new Set(body.rooms)]
  } else {
    send(res, 400, { error: 'room must be a string, or rooms an array of strings' })
    return
  }
  if (roomIds.length === 0) {
    send(res, 400, { error: 'rooms must name at least one room' })
    return
  }
  if (roomIds.length > MAX_ROOMS_PER_STREAM) {
    send(res, 400, { error: `at most ${MAX_ROOMS_PER_STREAM} rooms per stream` })
    return
  }

  const subscriber = {
    deliver(payload: string) {
      // A write to a socket the peer has closed throws, and that throw is the hub's signal to
      // drop this subscriber — so it is deliberately NOT caught here.
      res.write(`data: ${payload}\n\n`)
    },
    end() {
      res.end()
    },
  }

  // All-or-nothing: a stream that silently carried 31 of 32 requested rooms would present as
  // one conversation mysteriously frozen, with the cause nowhere near the symptom. On the first
  // refusal, everything already attached detaches and the refusal names the room.
  const attachments: Array<{ history: readonly string[]; unsubscribe: () => void }> = []
  for (const id of roomIds) {
    const attached = opts.rooms!.subscribe(id, subscriber)
    if (!attached.ok) {
      for (const a of attachments) a.unsubscribe()
      send(res, ROOM_REFUSAL_STATUS[attached.reason] ?? 400, { error: attached.reason, room: id })
      return
    }
    attachments.push(attached)
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Nginx and several CDNs buffer a response body by default, which for a stream means the
    // first message arrives when the last one does. This is the header that turns that off, and
    // it is harmless everywhere it is not understood.
    'x-accel-buffering': 'no',
  })

  // The backlog first, then live traffic on the same socket, so the client has exactly one
  // ordering rule: everything in the order it arrives. Per-room order is preserved; order
  // BETWEEN rooms is subscription order, which is fine — the client dedupes by envelope iv and
  // sorts threads by their own timestamps.
  for (const attached of attachments) {
    for (const payload of attached.history) subscriber.deliver(payload)
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': hb\n\n')
    } catch {
      // The socket died between the last write and this tick. `close` below does the cleanup.
    }
  }, ROOM_HEARTBEAT_MS)
  // `unref` so a live stream cannot hold the process open on shutdown — a chat socket is not a
  // reason to refuse to exit.
  heartbeat.unref?.()

  // ON THE RESPONSE, NOT THE REQUEST, and the difference is the whole cleanup path. `readJsonBody`
  // above consumes the request stream to its end, and a fully-read request has ALREADY emitted
  // 'close' by the time this line runs — a listener attached there never fires, so the subscriber
  // is never dropped and the room accumulates dead sockets until it hits its cap. The response is
  // the object that is still open; it closes when this side ends it or when the client goes away,
  // which are the same event as far as this room is concerned.
  //
  // Both must free the timer: a leaked interval per abandoned connection is how a long-lived
  // process dies of something unrelated to what it does.
  res.on('close', () => {
    clearInterval(heartbeat)
    for (const attached of attachments) attached.unsubscribe()
  })
}

/**
 * `POST /api/chain/stream` — subscribe to the chain feed, and keep the socket open.
 *
 * `handleRoomStream`'s framing, verbatim, because that framing is production-proven: SSE over a
 * POST body, a heartbeat for the middleboxes, cleanup on the RESPONSE's `close` (the request has
 * already emitted its own by the time the body is read — see the room handler's note). The body
 * is read and discarded: the feed has one channel, so there is nothing to select, but the empty
 * JSON object is still required by the content-type gate that keeps cross-origin pages out.
 */
async function handleChainStream(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RelayerServerOptions,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }
  // EXACTLY `{}`, refused loudly otherwise. The feed has one channel today, so there is nothing
  // for a body to select — and a body that names something is a client from a wire this server
  // does not speak. Refusing now is what lets a future field mean something: silently ignoring
  // unknown keys would make every later addition compatible-looking and wrong.
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 0
  ) {
    send(res, 400, { error: 'the chain stream takes an empty JSON object' })
    return
  }

  const subscriber = {
    deliver(payload: string) {
      // A throw here is the feed's signal to drop this subscriber — deliberately NOT caught.
      res.write(`data: ${payload}\n\n`)
    },
    end() {
      res.end()
    },
  }

  const attached = opts.chainFeed!.subscribe(subscriber)
  if (!attached.ok) {
    // Full is a 503 the browser treats as "poll for yourself" — degraded, never locked.
    send(res, 503, { error: 'the feed is at capacity' })
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  // The hello carries the whole state — including the price history this browser was not open
  // to witness — then live deltas ride the same socket. One ordering rule, the rooms' rule.
  subscriber.deliver(attached.hello)

  const heartbeat = setInterval(() => {
    try {
      res.write(': hb\n\n')
    } catch {
      // The socket died between writes; `close` below cleans up.
    }
  }, ROOM_HEARTBEAT_MS)
  heartbeat.unref?.()

  res.on('close', () => {
    clearInterval(heartbeat)
    attached.unsubscribe()
  })
}

/**
 * The drip, tunable at flip-on without a release: `RELAYER_FAUCET_DRIP_WEI` overrides the
 * 10 STRK default. Read per request rather than at boot so a `fly secrets set` retune takes
 * effect on the machine restart it triggers, with nothing else to redeploy. A value that does
 * not parse falls back to the default rather than dripping garbage.
 */
function faucetDripWei(): bigint {
  const raw = process.env.RELAYER_FAUCET_DRIP_WEI
  if (!raw) return DRIP_WEI
  try {
    const parsed = BigInt(raw)
    return parsed > 0n ? parsed : DRIP_WEI
  } catch {
    return DRIP_WEI
  }
}

/**
 * `POST /api/faucet` — the starter drip.
 *
 * ── THE REQUEST CONTRIBUTES ONE VALUE, AND IT IS NORMALISED BEFORE IT IS USED ─────────────
 *
 * `faucet.ts`'s header has the argument for why this is a dedicated route rather than an
 * allowlist entry; what this function adds is the metering. The body is read for exactly one
 * field, `address`, and everything else in the transaction — the token, the entrypoint, the
 * amount — comes from constants in that module. There is no shape of body that widens this.
 *
 * ── THE THREE CAPS, AND THE ORDER THEY RUN IN ─────────────────────────────────────────────
 *
 * Cheapest and most specific first, because each one that fires saves the next from running:
 *
 *   1. The address parses and is not zero. Free, and catches the one failure that would burn
 *      real STRK while answering 200.
 *   2. The per-address claim, burned atomically. This is the honest limit — a starter amount is
 *      for starting.
 *   3. The visitor and daily budgets, through the same ledger machinery every other gate here
 *      uses. The daily one is the solvency floor.
 *
 * ── AND THE CLAIM IS BURNED BEFORE THE TRANSFER IS SENT ───────────────────────────────────
 *
 * `handleSubmit` makes the same call for the same reason, written out at its budget gate: burning
 * afterwards leaves the entire await window open for concurrent requests to pass the same check,
 * which is how a cap of one pays out ten. The cost is that a transfer failing at the sequencer
 * still spends the address's one claim. That is the direction to be wrong in — the failure is a
 * user who funds from elsewhere, rather than an operator whose wallet is empty.
 */
async function handleFaucet(req: IncomingMessage, res: ServerResponse, opts: RelayerServerOptions) {
  const faucet = opts.faucet
  // Unreachable — `handle` only dispatches here when the ledger is present — but the type allows
  // it, and an unmetered drip is not something to reach by way of a `!`.
  if (!faucet) {
    send(res, 404, { error: 'not found' })
    return
  }

  if (opts.relayerState?.() === 'relayer-down') {
    // The ordinary relayer-down state, never a distinct "we are out of STRK" string — FR-053's
    // rule, and it applies here more than anywhere: our balance is not the caller's business.
    send(res, 503, { error: DRIP_BUDGET_SPENT })
    return
  }

  let parsed: unknown
  try {
    parsed = await readJsonBody(req)
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }
  if (!parsed || typeof parsed !== 'object') {
    send(res, 400, { error: 'body must be a JSON object' })
    return
  }

  const address = (parsed as { address?: unknown }).address
  if (!isDrippableAddress(address)) {
    send(res, 400, { error: DRIP_BAD_ADDRESS })
    return
  }

  const now = (opts.now ?? Date.now)()

  //
  // THE ADDRESS IS THE CLAIM KEY, NORMALISED FIRST.
  //
  // `tryClaim` is a string-set membership test, so `0x123` and `0x0123` would be two different
  // claims on one account — two drips, for free, by adding a zero. Normalising through the same
  // felt round trip the calldata uses is what makes "once per address" mean once per ACCOUNT.
  //
  const claimKey = `drip:${toFeltHex(asAddress(address))}`
  let firstClaim: boolean
  try {
    firstClaim = faucet.tryClaim(claimKey)
  } catch (e) {
    // The ledger write failed. Refusing is the only safe answer: an unrecordable claim is one
    // that would be claimable again on the next request.
    console.warn(`relayer: faucet ledger write failed: ${String(e)}`)
    send(res, 500, { error: 'the faucet ledger could not be written; refusing to send' })
    return
  }
  if (!firstClaim) {
    send(res, 429, { error: DRIP_ALREADY_CLAIMED })
    return
  }

  let decision: SponsorDecision
  try {
    decision = faucet.spend(visitorId(clientIp(req), faucet.salt, now), now)
  } catch (e) {
    console.warn(`relayer: faucet budget write failed: ${String(e)}`)
    send(res, 500, { error: 'the faucet ledger could not be written; refusing to send' })
    return
  }
  if (!decision.allow) {
    // WHICH cap bound goes to ops and not to the caller — `handleSubmit`'s rule: "the global
    // budget is gone" tells a stranger what everyone else has been doing today.
    console.warn(`relayer: faucet refused (${decision.reason})`)
    send(res, 429, { error: decision.notice })
    return
  }

  try {
    const dripWei = faucetDripWei()
    const txHash = await opts.submit([dripCall(address, dripWei)])
    console.log(`relayer: dripped ${dripWei} wei to ${address} — ${txHash}`)
    send(res, 200, { txHash, amountWei: dripWei.toString() })
  } catch (e) {
    // The claim and the budget unit are already spent, deliberately — see the header. What the
    // caller gets is the honest outcome: nothing arrived, and this is not retryable here.
    console.warn(`relayer: faucet transfer failed: ${String(e)}`)
    send(res, 503, { error: 'the starter transfer could not be sent. Fund this account from any Starknet wallet.' })
  }
}

/**
 * `GET /api/fee-recipient` — the address a reimbursement `Withdraw` must name (story 1.16).
 *
 * The relayer cannot fold the fee leg itself. The proof binds the action list, so the leg has to
 * be in the list before the prover sees it, and only the client is on that side of the prove.
 * What the relayer CAN do is say where the money should go — which is this, and which is why it
 * is a read rather than a step in the submission.
 *
 * ABSENT MEANS REFUSE, not "use the default". There is no sensible default for an address that a
 * real, irreversible withdraw is about to name; a relayer that has not been told its own payout
 * address should stop clients building a leg to nowhere rather than let them guess.
 */
function handleFeeRecipient(res: ServerResponse, opts: RelayerServerOptions): void {
  const { feeRecipient } = opts
  if (!feeRecipient) {
    send(res, 503, {
      error:
        'this relayer does not advertise a fee recipient, so a reimbursement leg cannot be ' +
        'addressed; submissions that pay their own way are unaffected',
    })
    return
  }
  // The client refuses a zero or malformed address too, but a misconfigured operator should
  // hear it from their own server, not from a user's failed send: what this advertises goes
  // into a proven, irreversible `Withdraw`, and "0" is a perfectly well-formed felt.
  let felt: bigint | null = null
  try {
    felt = BigInt(feeRecipient.trim())
  } catch {
    felt = null
  }
  if (felt === null || felt === 0n) {
    send(res, 503, {
      error:
        'this relayer is configured with a fee recipient that is not a usable address, so it ' +
        'refuses to advertise it; a reimbursement sent to it would be burned',
    })
    return
  }
  send(res, 200, { feeRecipient })
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
      // The same token in `reason`, which is the field every other refusal on this endpoint
      // branches on. `state` is 1.5's spelling and stays: it is a shipped wire field and
      // removing it would break a client to tidy a name. A client should be able to read one
      // field to route every non-200, rather than knowing which status uses which key.
      reason: 'relayer-down',
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
  let sponsored = false
  let invite: string | undefined
  try {
    const body = (await readJsonBody(req)) as Partial<SubmitBody>
    if (!Array.isArray(body.calls) || body.calls.length === 0) {
      throw new Error('body must carry a non-empty `calls` array')
    }
    calls = body.calls
    if (body.sponsored !== undefined) {
      // Exactly `true`, or nothing. Reading this by truthiness would make `sponsored: false`
      // and `sponsored: "no"` land in opposite branches from each other and from the reader's
      // expectation — a flag that decides which budget is charged has to mean one thing.
      if (body.sponsored !== true) {
        throw new Error(
          `refusing sponsored=${JSON.stringify(body.sponsored)}: the only accepted value is true, ` +
            'and a submission that is not sponsored omits the field entirely',
        )
      }
      sponsored = true
    }
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
      // BOTH-OR-NEITHER, and the rule is the sequencer's before it is ours: a v3 invoke
      // carrying proof_facts without proof is rejected at broadcast — AFTER this wallet
      // signed and the sponsorship budget was consumed. Refusing here makes the same
      // mismatch a free 400 instead. The blob is checked for shape only (a non-empty
      // string); judging the proof itself is the sequencer's job, not this server's.
      if (typeof body.proof !== 'string' || body.proof.length === 0) {
        throw new Error(
          'refusing proofFacts without their proof: the sequencer takes both or neither, ' +
            'so facts alone would be signed, broadcast, and rejected at our expense',
        )
      }
      details = { proofFacts: assertProofFacts(body.proofFacts), proof: body.proof }
      // Bounds ride ONLY with a proof, because that is the only case that needs them: an
      // unproven submission estimates cleanly and should keep doing so rather than trusting a
      // caller's ceiling. Validated the same way everything else here is — shape before value.
      if (body.resourceBounds !== undefined) {
        details.resourceBounds = assertResourceBounds(body.resourceBounds)
      }
    } else if (body.proof !== undefined) {
      throw new Error(
        'refusing a proof without its proofFacts: the sequencer takes both or neither, ' +
          'and a blob with no facts is not a proven submission',
      )
    }
    if (body.invite !== undefined) {
      // NEVER A SILENT IGNORE, on any of the three ways this can be wrong. A client that sent a
      // code and got a 200 has every reason to believe the waiver applied, and the one case
      // where that belief is expensive is the one where it did not: the invitee's per-visitor
      // cap was the thing standing in the way, so ignoring the code means refusing them and
      // telling them it worked.
      const code = normalizeCode(body.invite)
      if (code === null) {
        throw new Error(
          `refusing invite=${JSON.stringify(body.invite)}: an invite code is six characters ` +
            'from the invite alphabet',
        )
      }
      if (!sponsored) {
        throw new Error(
          'refusing an invite code on a submission that is not sponsored: the only thing a ' +
            'burned code does is waive the per-visitor SPONSORSHIP cap, so on a plain ' +
            'submission it would silently mean nothing',
        )
      }
      invite = code
    }
  } catch (e) {
    send(res, 400, { error: String(e) })
    return
  }

  // Only the CONFIG question is answered this early — "does this relayer offer invites at
  // all" reveals nothing about any code. The code itself is vetted further down, after the
  // awaits, so the check the burn discipline leans on runs with nothing yielding between it
  // and the consume.
  if (invite !== undefined && !opts.invites) {
    send(res, 400, {
      error: 'this relayer does not accept invite codes',
      reason: 'invites-not-offered',
    })
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

  // The invite vet — deliberately HERE, after the approve-ceiling await and the policy gate and
  // immediately before the budget gate, for two reasons that pull the same direction. First,
  // ordering: from this check through `budget.spend` to `consume` below, nothing yields, so the
  // code's state cannot change between being vetted and being consumed — the earlier placement
  // had the approve-ceiling `await` inside that gap. Second, the vet is METERED
  // (`vetForSubmit` charges a claim attempt per refusal, cap-first): without that, this endpoint
  // would answer "is this code live" in typed refusals for free and without limit, walking
  // around the very cap that makes a six-character bearer code safe. A vetted-and-refused code
  // costs the guesser an attempt; a valid claimed code costs its holder nothing.
  //
  // Refused BEFORE the budget is touched, so a bad code cannot spend the day's budget — and the
  // code is consumed only AFTER the budget accepts, so a submission refused for a spent daily
  // budget leaves the invitee's code intact for tomorrow. Both halves matter.
  if (invite !== undefined && opts.invites) {
    let check: ReturnType<InviteLedger['vetForSubmit']>
    try {
      // The vet PERSISTS on a refusal (the attempt charge is a ledger write), so it can throw
      // on a full disk — and that must refuse the submission, not escape as a 500 with no story.
      check = opts.invites.vetForSubmit(
        invite,
        visitorId(clientIp(req), opts.invites.salt, (opts.now ?? Date.now)()),
        (opts.now ?? Date.now)(),
      )
    } catch (e) {
      console.warn(`relayer: invite ledger write failed: ${String(e)}`)
      send(res, 500, { error: 'the invite ledger could not be written; refusing to sign' })
      return
    }
    if (!check.allow) {
      send(res, check.reason === 'invite-too-many-attempts' ? 429 : 400, {
        error: `this invite cannot pay for a registration (${check.reason})`,
        reason: check.reason,
      })
      return
    }
  }

  // The budget gate — or rather, one of two, and which one is the whole of what `sponsored`
  // decides.
  //
  // THIS SERVER USED TO TREAT EVERY ACCEPTED SUBMISSION AS A SPONSORSHIP, on the reasoning that
  // it signs everything out of one funded key. That was true while the only thing it signed was
  // a registration, and story 1.16 falsified it: a send folds a `Withdraw` naming this relayer
  // into its own proven action chain, so the POOL FEE comes back out of the user's notes.
  //
  // NOT "nothing is given away" — the execution gas is still ours. A send reimburses the fee and
  // nothing else, so every relayed send costs this wallet the gas for the transaction, every
  // time. That is a real per-submission cost, it is simply a much smaller one than a whole
  // sponsored fee. Both branches are therefore metered, and for the same underlying reason: the
  // allowlist bounds WHAT may be signed and the ceiling bounds one approve, but neither bounds
  // how MANY.
  //
  // What the split buys is that a busy day of sends cannot spend the day's free registrations —
  // the one thing this product actually gives cold visitors — and cannot refuse them with copy
  // about account creation. The send cap additionally bounds the relayer's exposure to a batch
  // whose reimbursement leg is missing: `apply_actions` calldata is deliberately uninspected, so
  // nothing here can check for it (allowlist.ts:179-182).
  //
  // The spend is recorded BEFORE submit() on both branches, and that ordering is deliberate.
  // Recording it afterwards would leave the whole await window open for every concurrent request
  // to pass the same check — the classic way a cap of twenty pays for two hundred. The cost of
  // the other order is that a submission which fails at the sequencer still consumes a unit;
  // that is the direction to be wrong in, because the failure mode is a visitor waiting until
  // 00:00 UTC rather than an operator waiting for a refund.
  const budget = sponsored ? opts.sponsorship : opts.sendBudget
  if (budget) {
    const now = (opts.now ?? Date.now)()
    const visitor = visitorId(clientIp(req), budget.salt, now)
    let decision: SponsorDecision
    try {
      // A burned invite waives the PER-VISITOR cap and nothing else. `decideSponsorship` checks
      // the daily budget first and never waives it, so an invited registration on a day whose
      // budget is spent degrades into pay-your-own-way exactly like an uninvited one — which is
      // the difference between a waiver and a bypass, and the reason the invite can be offered
      // at all without it becoming a promise the wallet cannot keep.
      decision = budget.spend(visitor, now, { waivePerVisitorCap: invite !== undefined })
    } catch (e) {
      // `spend` writes the durable ledger, so it can fail on a full disk or a permissions
      // change. Letting that escape leaves the request unanswered — the client waits for a
      // socket that never closes — and it must NOT fall through to signing: an unrecordable
      // spend is one we refuse to make. 500 because it is our fault, not the caller's.
      console.warn(`relayer: ${sponsored ? 'sponsorship' : 'send'} ledger write failed: ${String(e)}`)
      send(res, 500, {
        error: `the ${sponsored ? 'sponsorship' : 'send'} ledger could not be written; refusing to sign`,
      })
      return
    }
    if (!decision.allow) {
      // Ops gets the cap that actually bound; the caller does not. Which of the two ran
      // out is a fact about the relayer's day, and "the global budget is gone" tells a
      // stranger what everyone else has been doing.
      console.warn(
        `relayer: ${sponsored ? 'sponsorship' : 'send'} refused (${decision.reason}) for visitor ${visitor.slice(0, 8)}…`,
      )
      send(
        res,
        403,
        sponsored
          ? {
              error: 'sponsored submissions are paused',
              reason: 'sponsorship-paused',
              notice: decision.notice,
            }
          : {
              // A DISTINCT reason token, so a client can tell "your free account is on hold"
              // from "relay this yourself" without parsing prose — and so a send can never
              // render the registration notice by accident.
              error: 'relayed sends are paused',
              reason: 'send-cap-reached',
              notice: decision.notice,
            },
      )
      return
    }
  }

  // The budget has accepted, so the code has bought what it was for. Marked consumed HERE,
  // still before `submit`, and for the same reason the spend is: the whole `await` below is a
  // window in which concurrent requests would otherwise present the same code and each find it
  // unconsumed. The cost of this order is that a submission which fails at the sequencer still
  // spends the invite — the same direction of wrongness the budget already accepts, and the
  // sender can mint another.
  //
  // If the WRITE here fails after the budget already spent, the relayer eats a budget unit for
  // a registration that never happened — its own headroom, never the user's code (the code is
  // only consumed by a successful write). That direction is deliberate: the reverse order would
  // make a budget-write failure cost the invitee their invite.
  if (invite !== undefined && opts.invites) {
    try {
      const consumed = opts.invites.consume(invite, (opts.now ?? Date.now)())
      if (!consumed.allow) {
        // Unreachable: from `vetForSubmit` above through `budget.spend` to here, nothing
        // yields, so no concurrent request can consume the code in between. Kept because
        // "unreachable" is a claim about today's control flow, and the failure it would cover
        // — signing on a code that was not actually marked — is a free registration handed
        // out twice.
        send(res, 400, {
          error: `this invite cannot pay for a registration (${consumed.reason})`,
          reason: consumed.reason,
        })
        return
      }
    } catch (e) {
      console.warn(`relayer: invite ledger write failed: ${String(e)}`)
      send(res, 500, { error: 'the invite ledger could not be written; refusing to sign' })
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
   * The durable SPONSORSHIP budget — what the relayer gives away. Charged only by a submission
   * that flags itself `sponsored`. Absent means no budget gate, which is what the tests about
   * everything else want; `main()` always supplies one.
   */
  sponsorship?: SponsorshipLedger
  /**
   * The durable cap on PLAIN submissions — the ones that reimburse their own fee. Its own
   * ledger, so a busy day of sends cannot spend the free registrations and vice versa; the same
   * class, because the counting, the day boundary and the durability rules are identical and a
   * second implementation of them would be a second set of bugs.
   */
  sendBudget?: SponsorshipLedger
  /**
   * The durable INVITE ledger (story 1.14). Absent means this relayer offers no invites: the
   * three routes are 404 and a code presented on `/submit` is a typed 400 rather than a waiver.
   *
   * Its own file, like the send cap's, because an operator clearing a stuck allowance must not
   * thereby un-burn every code ever claimed.
   */
  invites?: InviteLedger
  /**
   * The opt-in name directory (see `directory.ts`). Absent means this relayer publishes no
   * names: all three routes are 404, and search degrades to raw addresses client-side.
   */
  directory?: Directory
  /**
   * The address a client should name in a fee-reimbursement `Withdraw` — this relayer's own.
   * Absent means `GET /fee-recipient` refuses; see `handleFeeRecipient`.
   */
  feeRecipient?: string
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
  /**
   * The chat bus (B3). Absent means this relayer carries no chat: both room routes are 404.
   *
   * It is not a ledger and takes no store path on purpose — see `rooms.ts`. Nothing it holds is
   * worth surviving a restart, and everything it holds is ciphertext it cannot read.
   */
  rooms?: RoomHub
  /**
   * The durable ledger behind the starter drip (`faucet.ts`). Absent means `/api/faucet` is 404.
   *
   * A FOURTH `SponsorshipLedger`, and the fourth separate FILE, for the reason the send budget
   * got its own: these three meters bound different things and must not spend each other. A busy
   * day of drips must not exhaust the free registrations — which would break account creation for
   * everybody, to give strangers STRK.
   *
   * It also uses `tryClaim` for something that is not an invite code: the claim set holds
   * `drip:<felt>` keys, one per funded address, so "once per address, ever" survives a restart.
   * The mechanism is a one-shot atomic burn either way, which is exactly what both uses need.
   *
   * ABSENT IS THE SAFE DEFAULT AND THE ROUTE IS GATED ON IT. This ledger is the only thing
   * bounding how much of the wallet the drip can give away, so there is no configuration in which
   * the route runs without one.
   */
  faucet?: SponsorshipLedger
  /**
   * The chain feed (`chain-feed.ts`). Absent means `/api/chain/stream` is 404 and every browser
   * polls the chain for itself — the shape this app shipped with, kept as the honest fallback.
   */
  chainFeed?: ChainFeed
  /**
   * The logo studio (`logo.ts`). Each of its two routes is gated on its own credential being
   * present in the service — absent key, absent route — and the whole service absent means both
   * are 404 and the create form degrades to the seeded disc.
   */
  logos?: LogoService
  /**
   * The second secret on `/directory/x-bind` — held by this process and the Vercel `api/x/link`
   * function, never the browser. Absent means the route is 404 and X binding is off.
   */
  xBindSecret?: string
  /**
   * The Teller (`teller.ts`) — the governance key custodian. Absent means `/govern/tally-key`
   * is 404 and this deployment tallies no votes; the void escape is every proposal's backstop.
   */
  teller?: Teller
}

export function createRelayerServer(options: RelayerServerOptions): Server {
  // TWO CONSTRUCTION-TIME GUARDS, both for mistakes that are otherwise completely silent — the
  // server starts, serves, and is wrong in a way only a user would notice.
  //
  // A budget without its sibling is the dangerous one. `sponsorship` present and `sendBudget`
  // absent means every plain submission — every send — passes unmetered, while registrations
  // stay capped: the gate looks configured and the expensive half of it is off. Refusing at
  // construction rather than at the gate keeps `handleSubmit`'s order untouched.
  if (options.sponsorship && !options.sendBudget) {
    throw new Error(
      'a sponsorship budget was configured without a send budget, which would leave every ' +
        'plain submission unmetered while registrations stay capped. Pass both, or neither.',
    )
  }
  // And a send budget carrying the registration notice would refuse sends with copy about
  // account creation — the exact thing the second ledger exists to prevent. The argument is
  // optional and easy to omit, so it is read back here instead of trusted.
  if (options.sendBudget && options.sendBudget.notice !== SEND_CAP_NOTICE) {
    throw new Error(
      'the send budget was built without SEND_CAP_NOTICE, so a refused send would be shown copy ' +
        'about sponsored registrations. Construct it with the send notice.',
    )
  }

  // An invite ledger with no sponsorship budget behind it is the third silent misconfiguration,
  // and it is silent in the worst direction: every invite route works, every code burns, and the
  // waiver those codes buy waives a cap that does not exist — so `handleSubmit`'s budget gate is
  // skipped entirely and the relayer hands out unbounded registrations while looking configured.
  // The whole "a waiver is not a bypass" argument is a statement about a budget that is present.
  if (options.invites && !options.sponsorship) {
    throw new Error(
      'an invite ledger was configured without a sponsorship budget. A burned invite waives the ' +
        'per-visitor sponsorship cap, so without a budget behind it every invited registration ' +
        'would be unmetered. Pass both, or neither.',
    )
  }

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

  // READ BACK, not trusted, on the same reasoning as the send-cap notice above: the invite
  // ledger takes its salt from its own store, and a store opened without being handed the
  // sponsorship salt mints a fresh one and works perfectly. What it would do is bucket one
  // address under two different opaque ids — the caps counting one visitor, the invite
  // allowance counting another — so a per-visitor cap and the `1 more in Nh` promise it
  // interacts with would be about two different people. Silent, and invisible in every log.
  if (options.invites && options.invites.salt !== resolved.visitorSalt) {
    throw new Error(
      'the invite ledger was opened with a different visitor salt than the budget gates use, so ' +
        'one address would be counted as two different visitors. Open it with the sponsorship ' +
        "ledger's salt.",
    )
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
  /** The cap on plain, self-reimbursing submissions. Its own numbers and its own ledger file. */
  sendCaps: BudgetCaps
  sendStorePath: string
  /**
   * The cap on the starter drip. Its own numbers and its own ledger file, for `sendStorePath`'s
   * reason — but read `faucet.ts` before changing either: this is the ONLY bound on how much of
   * the relayer's wallet the drip can give away in a day, and unlike the other two it is not
   * measured in fees. `daily` × `DRIP_WEI` is a literal amount of STRK an operator is choosing
   * to hand out.
   */
  faucetCaps: BudgetCaps
  faucetStorePath: string
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
  /**
   * The invite feature, or `undefined` when this relayer does not offer invites.
   *
   * OFF UNLESS DELIBERATELY TURNED ON. There is no defensible default for "how many free
   * registrations may one address hand out to strangers" — that is a giveaway policy, not a
   * tuning number — so the feature has a master switch rather than a default, and a relayer
   * nobody configured for invites simply does not have them.
   */
  invites: InviteConfig | undefined
  /** Where the invite ledger lives. Meaningless, and unread, when `invites` is undefined. */
  inviteStorePath: string
}

/** The knob whose presence turns invites on. Named once, so the guard and the docs agree. */
const INVITE_SWITCH = 'RELAYER_INVITE_ALLOWANCE'

/**
 * The invite surface, resolved from the environment. `undefined` when the feature is off.
 *
 * PARTIAL CONFIGURATION IS A STARTUP ERROR, and this is the guard the story asks for. An
 * operator who sets `RELAYER_INVITE_TTL_HOURS` and nothing else has plainly decided to run
 * invites; reading the rest from defaults and then quietly not having the feature at all —
 * because the one variable that switches it on was the one they missed — is the same class of
 * silent misconfiguration as a send budget carrying the wrong notice. The settings would look
 * configured, `/invite/mint` would answer 404, and nothing anywhere would say why.
 */
export function resolveInviteConfig(env: NodeJS.ProcessEnv = process.env): InviteConfig | undefined {
  const KNOBS = [
    INVITE_SWITCH,
    'RELAYER_INVITE_WINDOW_HOURS',
    'RELAYER_INVITE_TTL_HOURS',
    'RELAYER_INVITE_CLAIM_ATTEMPTS',
    'RELAYER_INVITE_MINT_DAILY',
    'RELAYER_INVITE_STORE',
  ]
  if (!(env[INVITE_SWITCH] || '')) {
    const orphans = KNOBS.filter((name) => env[name])
    if (orphans.length) {
      throw new Error(
        `${orphans.join(', ')} ${orphans.length === 1 ? 'is' : 'are'} set but ${INVITE_SWITCH} is ` +
          `not, so the invite feature would be OFF and those settings would have no effect. ` +
          `Set ${INVITE_SWITCH} to turn invites on, or unset the rest.`,
      )
    }
    return undefined
  }
  return {
    // Adapted from Bluesky's invite allowance rather than derived from anything (UX §9 Q12).
    // Small, because every one of these is a registration the relayer pays for. The fallback
    // on this one line is UNREACHABLE — this branch only runs when the switch is set, and
    // `wholeInt` returns the fallback only for a blank value — so the effective default of the
    // feature is OFF, never 3; the ceiling is the load-bearing part. It is 1,000 because the
    // knobs that bound a giveaway need bounds of their own: a fat-fingered extra digit here is
    // a thousand registrations per address per window.
    allowance: positiveInt(env, INVITE_SWITCH, 3, 1_000),
    // 24h is not arbitrary: the copy promises `1 more in {N}h`, and a window measured in
    // anything else makes that sentence describe a different feature.
    windowMs: positiveInt(env, 'RELAYER_INVITE_WINDOW_HOURS', 24, 24 * 365) * 3_600_000,
    // Long enough that a link sent in the evening still works the next day, short enough that
    // the live population of bearer codes stays small — which is one of the things that makes
    // six characters sufficient (see invite.ts).
    ttlMs: positiveInt(env, 'RELAYER_INVITE_TTL_HOURS', 72, 24 * 365) * 3_600_000,
    // A real invitee claims once. This is sized against guessing, not against use: it is the
    // rate limit that turns 32^6 from a number into a wall, and it also meters the status
    // route's misses and `/submit`'s vet. CEILINGED at 10,000 because this knob is documented
    // as what makes a six-character bearer code safe — a value that unmakes that argument
    // should have to be typed somewhere more deliberate than an env file.
    claimAttemptsPerDay: positiveInt(env, 'RELAYER_INVITE_CLAIM_ATTEMPTS', 10, 10_000),
    // The global ceiling: what EVERY inviter together may mint per rolling day. The per-address
    // allowance is a fairness bound; this is a solvency-shaped one, because addresses are cheap
    // (IPv6, a botnet) and each live code slightly weakens the guessing arithmetic.
    mintDailyGlobal: positiveInt(env, 'RELAYER_INVITE_MINT_DAILY', 50, 100_000),
  }
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
  const invites = resolveInviteConfig(env)
  const sponsorDaily = positiveInt(env, 'RELAYER_SPONSOR_DAILY', 20)
  // `.env.example` states the invariant — "raise the allowance alongside RELAYER_SPONSOR_DAILY,
  // never past it" — and a stated invariant nothing enforces is one config typo away from being
  // false. An allowance above the daily budget is a giveaway the treasury cannot honour: every
  // code past the budget mints fine, claims fine, and then walks into `sponsorship-paused`.
  if (invites && invites.allowance > sponsorDaily) {
    throw new Error(
      `${INVITE_SWITCH}=${invites.allowance} exceeds RELAYER_SPONSOR_DAILY=${sponsorDaily}. ` +
        `One inviter could then mint more registrations per window than the relayer sponsors ` +
        `per day, so invites would be minted that can only ever degrade. Raise the daily ` +
        `budget, or lower the allowance.`,
    )
  }
  return {
    caps: {
      perVisitor: positiveInt(env, 'RELAYER_SPONSOR_PER_VISITOR', 1),
      daily: sponsorDaily,
    },
    storePath:
      env.RELAYER_SPONSOR_STORE ||
      fileURLToPath(new URL('../../../.relayer/sponsorship.json', import.meta.url)),
    // MORE PER VISITOR than the sponsorship cap, the same ceiling per day, and the difference is
    // what the two are measuring. A sponsored registration is a whole fee given away, so one per
    // visitor is a spending limit. A send reimburses its fee and leaves us only the execution
    // gas, so three per visitor costs far less than three registrations would — it is sized for
    // a session that sends more than once, not against a balance.
    //
    // The daily ceiling matches the sponsorship one deliberately, so neither gate is the
    // surprising one. What it bounds is the RATE at which an unreimbursed batch could drain the
    // wallet if a client lied about the leg it folded in (the relayer cannot check:
    // `apply_actions` calldata is deliberately uninspected). What bounds the LOSS is the wallet
    // balance and the funding monitor's refusal floor, which closes the door at two live fees
    // whatever this number says.
    sendCaps: {
      perVisitor: positiveInt(env, 'RELAYER_SEND_PER_VISITOR', 3),
      daily: positiveInt(env, 'RELAYER_SEND_DAILY', 20),
    },
    // A SEPARATE FILE, not a second section of the same one. One ledger holding both would make
    // a reset of either a reset of both, and an operator clearing a stuck send counter would
    // silently hand out a fresh day of free registrations.
    sendStorePath:
      env.RELAYER_SEND_STORE ||
      fileURLToPath(new URL('../../../.relayer/send-budget.json', import.meta.url)),
    //
    // ONE PER VISITOR PER DAY, and the per-address claim behind it is once EVER — so this number
    // is the anti-rotation limit rather than the honest-user limit.
    //
    // `daily` IS AN AMOUNT OF MONEY, NOT A RATE LIMIT: `daily` × the drip is the acquisition
    // budget — how much STRK a day the relayer is funded to hand out, which under M8's
    // one-subsidy rule is the WHOLE cost of a new user (the drip stakes the journey; the user
    // then self-pays their registration from it, and sponsorship is only the faucet-off
    // fallback). At the 10 STRK default drip, `daily: 2` is ~20 STRK/day — the operator sets
    // both numbers at flip-on; `faucet.ts` carries the doctrine.
    //
    faucetCaps: {
      perVisitor: positiveInt(env, 'RELAYER_FAUCET_PER_VISITOR', 1),
      daily: positiveInt(env, 'RELAYER_FAUCET_DAILY', 2),
    },
    // A THIRD FILE, on `sendStorePath`'s argument and with more force: this ledger's claim set is
    // the once-per-address record, and folding it into another file would mean an operator
    // clearing a stuck send counter re-opens the drip for every address ever funded.
    faucetStorePath:
      env.RELAYER_FAUCET_STORE ||
      fileURLToPath(new URL('../../../.relayer/faucet.json', import.meta.url)),
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
    invites,
    // A THIRD FILE, for the reason the send cap needed a second one: one file holding all three
    // would make a reset of any of them a reset of all, and here the reset that must never
    // happen by accident is the one that un-burns every claimed code.
    inviteStorePath:
      env.RELAYER_INVITE_STORE ||
      fileURLToPath(new URL('../../../.relayer/invites.json', import.meta.url)),
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
 * The deployed Markets and Launch contracts, if they exist yet.
 *
 * Absent before the Wave 3 declares land, which is not an error and not a reason to refuse to
 * boot: the allowlist simply never matches a contract it has no address for, and the keeper below
 * skips cleanly. Failing closed in both places is what makes "not deployed yet" an ordinary state
 * rather than a special case.
 */
function deployedAppContracts(): AppContracts {
  try {
    return parseAppContracts(
      readFileSync(new URL('../../../evidence/markets-launch-deployment.json', import.meta.url), 'utf8'),
    )
  } catch {
    return NO_APP_CONTRACTS
  }
}

/**
 * How often the keeper sweeps. `Markets::resolve` is open for 300 seconds after a deadline, so a
 * sixty-second pass gets five attempts inside every window — enough that one RPC blip or one
 * still-stale oracle read does not cost a market its settlement and force it to a void.
 */
const KEEPER_INTERVAL_MS = 60_000

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
 * Opens the plain-submission cap's ledger — same machinery, second file, its own notice.
 *
 * `sponsorship.salt` is passed through rather than letting this file mint its own, so both gates
 * bucket the same visitor under the same id. Two salts would mean two different opaque ids for
 * one address, which is not more private (the relayer sees the address either way) and does make
 * the two counters impossible to read together when an operator is trying to understand a day.
 */
export function openSendBudgetLedger(
  config: SponsorshipConfig,
  salt: string,
): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.sendStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(config.sendCaps, store, Date.now(), SEND_CAP_NOTICE)
}

/**
 * Opens the starter drip's ledger — same machinery, third file, its own notice.
 *
 * The salt is shared with the other two for `openSendBudgetLedger`'s reason: one visitor, one
 * opaque id, so an operator reading a day can read all three counters against each other.
 */
export function openFaucetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.faucetStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(config.faucetCaps, store, Date.now(), DRIP_BUDGET_SPENT)
}

/**
 * Opens the invite ledger — third file, same machinery, and the budget gates' salt.
 *
 * `salt` is passed in rather than letting the store mint its own, exactly as
 * `openSendBudgetLedger` does. Two salts would bucket one address under two opaque ids, and
 * `createRelayerServer` reads the result back and refuses to start on a mismatch, because
 * getting this wrong changes nothing an operator can see.
 */
export function openInviteLedger(config: SponsorshipConfig, salt: string): InviteLedger | undefined {
  if (!config.invites) return undefined
  const store = new FileInviteStore(config.inviteStorePath)
  const record = store.load()
  if (record.salt !== salt) {
    // A FRESH ledger adopts the budget gates' salt silently — that is first boot, and the store
    // minted a throwaway. An ESTABLISHED ledger with a different salt is another matter: every
    // `inviterKey` in it was hashed under the old salt, so adopting the new one would silently
    // re-key every inviter — all rolling windows reset, all standing attempt counts orphaned —
    // with nothing in any log. That happens in practice when the SPONSORSHIP store is deleted
    // or rotated (it mints the shared salt); the honest answer is to stop and make the operator
    // reset the invite ledger deliberately too, not to quietly forget every allowance.
    const established = record.invites.length > 0 || Object.keys(record.attempts.counts).length > 0
    if (established) {
      throw new Error(
        `the invite ledger at ${config.inviteStorePath} was written under a different visitor ` +
          `salt than the budget gates now use (this happens when the sponsorship store was ` +
          `deleted or rotated). Adopting the new salt would silently reset every inviter's ` +
          `rolling allowance and orphan every claim-attempt count. If that is what you intend, ` +
          `move or delete the invite ledger file deliberately and restart.`,
      )
    }
    store.save({ ...record, salt })
  }
  return new InviteLedger(config.invites, store)
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
  const sendBudget = openSendBudgetLedger(sponsorConfig, sponsorship.salt)
  //
  // OFF BY DEFAULT, and this is the one ledger that is. The other two meter fees the relayer was
  // always going to pay; this one gives away principal, on mainnet, to anyone who asks. An
  // operator turns it on deliberately — `RELAYER_FAUCET=on` — so a fresh deployment of this
  // repository cannot start handing out its wallet because somebody forgot to configure a cap.
  //
  const faucet = process.env.RELAYER_FAUCET === 'on'
    ? openFaucetLedger(sponsorConfig, sponsorship.salt)
    : undefined
  const invites = openInviteLedger(sponsorConfig, sponsorship.salt)

  const nodeUrl = await pickLiveRpcHost()
  const provider = new RpcProvider({ nodeUrl })
  const account = new Account({
    provider,
    address,
    signer: privateKey,
  })

  // The name directory — a fourth ledger file, for the by-now-familiar reason: resetting a
  // public registry must never be a side effect of maintaining a private one. The key read is
  // the pool's own view, so a claim verifies against exactly what registration wrote.
  const directory = openDirectory({
    file:
      process.env.RELAYER_DIRECTORY_STORE ||
      fileURLToPath(new URL('../../../.relayer/directory.json', import.meta.url)),
    readPublicKey: async (userAddress) => {
      const result = await provider.callContract({
        contractAddress: NET.pool,
        entrypoint: 'get_public_key',
        calldata: [userAddress],
      })
      return BigInt(result[0] ?? '0x0')
    },
  })

  const monitor: FundingMonitor = createFundingMonitor({
    readBalance: () => readStrkBalance(address),
    readFeeWei: async () => (await readPoolConstants()).feeWei,
    pageOps: makeOpsPager(sponsorConfig.opsWebhook),
    intervalMs: sponsorConfig.fundingIntervalMs,
  })

  const messageBook = deployedMessageBook()
  const appContracts = deployedAppContracts()

  // The chat bus. Nothing to open and nothing to read back: it starts empty on every boot, by
  // design (`rooms.ts`). The sweep is on a timer rather than only on request, because a room's
  // retention window is a promise about wall-clock time — on a quiet host, "we drop it after
  // thirty minutes" would otherwise mean "we drop it whenever somebody next visits".
  const rooms = new RoomHub()
  const roomSweep = setInterval(() => {
    const dropped = rooms.sweep()
    if (dropped > 0) console.log(`rooms: swept ${dropped} idle`)
  }, ROOM_IDLE_MS / 6)
  roomSweep.unref?.()

  // The chain feed — one poller for every open tab (`chain-feed.ts`). Constructed whenever there
  // is anything to stream; the price reader is passed in here so the `starknet`-reaching pragma
  // import stays at this composition root. `RELAYER_CHAIN_FEED_STORE` keeps the price history on
  // the volume; without it the history honestly starts over on each deploy.
  const feedWanted = process.env.RELAYER_CHAIN_FEED !== 'off'
  const chainFeed =
    feedWanted && (appContracts.markets || appContracts.launch || appContracts.pragma)
      ? new ChainFeed({
          markets: appContracts.markets,
          launch: appContracts.launch,
          governance: appContracts.governance,
          readPrices: appContracts.pragma
            ? async () => {
                const { readAllMedians } = await import('../../protocol/src/pragma.js')
                return readAllMedians(appContracts.pragma)
              }
            : undefined,
          storePath: process.env.RELAYER_CHAIN_FEED_STORE || undefined,
        })
      : undefined
  chainFeed?.start()

  // The logo studio — constructed when at least one key exists. Meters are in-memory for the
  // quote counter's reason: quota is egress, not money owed to anyone, and fresh quota on
  // restart is cheaper than an unwritable disk stopping logo uploads.
  const pinataJwt = process.env.RELAYER_PINATA_JWT || undefined
  const geminiKey = process.env.RELAYER_GEMINI_KEY || undefined
  const logos: LogoService | undefined =
    pinataJwt || geminiKey
      ? {
          pinataJwt,
          geminiKey,
          imageModel: process.env.RELAYER_GEMINI_IMAGE_MODEL || undefined,
          pinCounter: createQuoteCounter(20, 200),
          generateCounter: createQuoteCounter(10, 100),
        }
      : undefined

  // The Teller — constructed the moment a Governance contract exists. Its ledger is the fifth
  // signer's whole custody story (`teller.ts`); the tick is the keeper's discipline verbatim.
  const teller: Teller | undefined = appContracts.governance
    ? openTeller({
        file:
          process.env.RELAYER_TELLER_STORE ||
          fileURLToPath(new URL('../../../.relayer/teller.json', import.meta.url)),
      })
    : undefined
  if (teller && appContracts.governance) {
    const governance = appContracts.governance
    const chainDeps = tellerChainDeps(
      governance,
      {
        callContract: async ({ contractAddress, entrypoint, calldata }) =>
          (await provider.callContract({ contractAddress, entrypoint, calldata })) as string[],
        getEvents: (filter) =>
          provider.channel.getEvents(filter as never) as Promise<{
            events?: unknown[]
            continuation_token?: string
          }>,
      },
      Number(process.env.RELAYER_GOVERNANCE_FROM_BLOCK ?? 0),
    )
    const tellerDeps = {
      ...chainDeps,
      submitTally: async (
        proposalId: number,
        sums: readonly bigint[],
        blindSums: readonly bigint[],
        excluded: readonly string[],
      ) => {
        const calldata = [
          `0x${proposalId.toString(16)}`,
          `0x${sums.length.toString(16)}`,
          ...sums.map((s) => `0x${s.toString(16)}`),
          `0x${blindSums.length.toString(16)}`,
          ...blindSums.map((r) => `0x${r.toString(16)}`),
          `0x${excluded.length.toString(16)}`,
          ...excluded,
        ]
        const { transaction_hash } = await account.execute([
          { contractAddress: governance, entrypoint: 'publish_tally', calldata },
        ])
        return transaction_hash
      },
      // THE ONE CALL THAT NEVER RIDES A USER SUBMISSION — the allowlist refuses `publish_key`
      // by name, and this is the Teller-signed path it is reserved for.
      submitKey: async (proposalId: number, secret: bigint) => {
        const { transaction_hash } = await account.execute([
          {
            contractAddress: governance,
            entrypoint: 'publish_key',
            calldata: [`0x${proposalId.toString(16)}`, `0x${secret.toString(16)}`],
          },
        ])
        return transaction_hash
      },
    }
    const tellerTick = setInterval(() => {
      void teller.tick(tellerDeps).catch((e: unknown) => console.warn(`teller: sweep failed — ${String(e)}`))
    }, TELLER_INTERVAL_MS)
    tellerTick.unref?.()
  }

  // The Groundskeeper — standing markets, so the board is never empty. Env-gated because every
  // sweep can spend real STRK (a seed per market, plus one-time registration and shielding on
  // first boot). `groundskeeper.ts`'s header carries the whole story.
  const groundskeeper =
    process.env.RELAYER_GROUNDSKEEPER === 'on' && appContracts.markets && appContracts.pragma
      ? openGroundskeeper({
          markets: appContracts.markets,
          pragma: appContracts.pragma,
          address: String(account.address),
          accountKey: privateKey,
          seedWei: BigInt(process.env.RELAYER_GROUNDSKEEPER_SEED_WEI || '2000000000000000000'),
          storePath:
            process.env.RELAYER_GROUNDSKEEPER_STORE ||
            fileURLToPath(new URL('../../../.relayer/groundskeeper.json', import.meta.url)),
          log: (line) => console.log(line),
          warn: (line) => console.warn(line),
        })
      : undefined
  groundskeeper?.start()

  const server = createRelayerServer({
    // `details` is undefined for a plain submission, which is what `execute` already
    // defaults to — so a `{calls}`-only body goes out byte-identical to before, and a
    // proven one carries proofFacts into the V3 transaction fields.
    submit: async (calls, details) => {
      const { transaction_hash } = await account.execute(calls, details)
      return transaction_hash
    },
    policy: {
      messageBook,
      markets: appContracts.markets,
      launch: appContracts.launch,
      governance: appContracts.governance,
    },
    resolveApproveCeiling: async () => approveCeiling((await readPoolConstants()).feeWei),
    allowedOrigins,
    authToken: process.env.RELAYER_AUTH_TOKEN || undefined,
    sponsorship,
    sendBudget,
    invites,
    // Our own address, which is where a send's reimbursement leg has to point. It is already
    // public in every transaction this process submits, so advertising it discloses nothing —
    // what it buys is that rotating this wallet does not need a front-end release.
    feeRecipient: address,
    visitorSalt: sponsorship.salt,
    quoteCounter: createQuoteCounter(
      sponsorConfig.quoteDailyPerVisitor,
      sponsorConfig.quoteDailyGlobal,
    ),
    // Refuse rather than sign when the wallet cannot cover the fee. Signing anyway buys a
    // revert that still costs gas and reads to the user as our bug. `userState` reports ok
    // while the health is `unknown`, so a failed read cannot turn an RPC blip into an outage.
    relayerState: () => monitor.userState(),
    rooms,
    directory,
    faucet,
    chainFeed,
    logos,
    xBindSecret: process.env.RELAYER_XBIND_SECRET || undefined,
    teller,
  })

  // ── The settlement keeper ───────────────────────────────────────────────────────────────
  //
  // A convenience with no privileges. `resolve` and `void` are permissionless by design, so
  // nobody's money depends on this process being alive — but "anyone may" is not "someone will",
  // and a market nobody settles inside its 300-second window can only be voided afterwards, which
  // refunds everybody and pays out nothing. This is what makes the ordinary case ordinary.
  //
  // OFF UNLESS THERE IS SOMETHING TO KEEP. It needs both a deployed Markets and the Pragma address
  // that Markets was constructed with; without either there is nothing to read and nothing to send,
  // so it stays dark rather than logging a failure every minute.
  const keeperWanted = process.env.RELAYER_KEEPER !== 'off'
  const keeperReady = keeperWanted && appContracts.markets && appContracts.pragma
  if (keeperReady) {
    const keeperDeps = createChainKeeperDeps({
      markets: appContracts.markets!,
      pragma: appContracts.pragma!,
      call: (contractAddress, entrypoint, calldata) =>
        provider.callContract({ contractAddress, entrypoint, calldata }),
      // Through the same account every submission uses, so a keeper call is subject to the same
      // allowlist as everything else this key signs — `resolve`, `void` and `graduate` are the
      // only entrypoints permitted on the app contracts, and `sweep` is refused there by name.
      send: async (contractAddress, entrypoint, calldata) => {
        await account.execute([{ contractAddress, entrypoint, calldata }])
      },
    })

    // LOG, NEVER THROW. An unhandled rejection inside a timer takes the whole relayer down — and
    // the relayer's actual job is submitting other people's transactions, which has nothing to do
    // with whether a market got settled. Every failure here is worth saying out loud and worth
    // surviving. `runKeeperPass` already contains per-market failures; this catches the pass.
    const keeperTick = setInterval(() => {
      void runKeeperPass(keeperDeps)
        .then((pass) => {
          for (const id of pass.resolved) console.log(`keeper: resolved market ${id}`)
          for (const id of pass.voided) console.log(`keeper: voided market ${id}`)
          for (const f of pass.failed) console.warn(`keeper: market ${f.marketId} failed — ${f.reason}`)
        })
        .catch((e: unknown) => console.warn(`keeper: pass failed — ${String(e)}`))
    }, KEEPER_INTERVAL_MS)
    // `unref` for the same reason the room sweep has it: a timer must not hold the process open
    // through a shutdown.
    keeperTick.unref?.()
  }

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
      appContracts.markets
        ? `allowlist: Markets ${appContracts.markets}${appContracts.launch ? ` · Launch ${appContracts.launch}` : ''}${appContracts.governance ? ` · Governance ${appContracts.governance}` : ''}`
        : 'allowlist: no Markets/Launch deployed yet',
    )
    console.log(
      keeperReady
        ? `keeper: sweeping every ${KEEPER_INTERVAL_MS / 1000}s via Pragma ${appContracts.pragma}`
        : keeperWanted
          ? 'keeper: idle — nothing deployed to keep'
          : 'keeper: disabled by RELAYER_KEEPER=off',
    )
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
      `plain sends: ${sponsorConfig.sendCaps.perVisitor}/visitor · ${sponsorConfig.sendCaps.daily}/day · ` +
        `ledger ${sponsorConfig.sendStorePath} · fee recipient ${address}`,
    )
    // Said out loud at startup because it is the one piece of state this process holds that a
    // user might reasonably assume it does not: ciphertext it cannot read, for a bounded time.
    console.log(
      `rooms: ciphertext only, in memory · ${ROOM_HISTORY} messages kept per room · ` +
        `idle rooms dropped after ${ROOM_IDLE_MS / 60_000} minutes`,
    )
    console.log(
      chainFeed
        ? `chain feed: app reads every ${APP_POLL_MS / 1000}s · prices every ${PRICE_POLL_MS / 1000}s · ` +
            `history ${HISTORY_BOUND}/pair · ` +
            `${process.env.RELAYER_CHAIN_FEED_STORE ? `store ${process.env.RELAYER_CHAIN_FEED_STORE}` : 'NO STORE — history resets on deploy'} · ` +
            `warmed ${chainFeed.stats().historyPoints} points`
        : feedWanted
          ? 'chain feed: idle — nothing deployed to stream'
          : 'chain feed: disabled by RELAYER_CHAIN_FEED=off',
    )
    console.log(
      logos
        ? `logo studio: pin ${logos.pinataJwt ? 'on (20/visitor · 200/day)' : 'OFF — no RELAYER_PINATA_JWT'} · ` +
            `generate ${logos.geminiKey ? `on via ${logos.imageModel ?? 'gemini-2.5-flash-image'} (10/visitor · 100/day)` : 'OFF — no RELAYER_GEMINI_KEY'}`
        : 'logo studio: off — set RELAYER_PINATA_JWT / RELAYER_GEMINI_KEY to offer it',
    )
    console.log(
      teller
        ? `teller: holding ${teller.keyCount()} tally key(s) · sweeping every ${TELLER_INTERVAL_MS / 1000}s · ` +
            `ledger ${process.env.RELAYER_TELLER_STORE ?? '.relayer/teller.json'}`
        : 'teller: off — no Governance contract deployed',
    )
    console.log(
      groundskeeper
        ? `groundskeeper: standing markets on, seed ${process.env.RELAYER_GROUNDSKEEPER_SEED_WEI || '2000000000000000000'} wei · ` +
            `store ${process.env.RELAYER_GROUNDSKEEPER_STORE ?? '.relayer/groundskeeper.json'} — REAL STRK per market`
        : 'groundskeeper: off — set RELAYER_GROUNDSKEEPER=on to keep the board planted (spends real STRK)',
    )
    // The subsystem was invisible at boot — an operator could not tell a 404-by-design from a
    // misconfiguration without curling the route. One line, either way.
    console.log(
      faucet
        ? `faucet: ON — drip ${faucetDripWei()} wei, ${sponsorConfig.faucetCaps.perVisitor}/visitor/day, ` +
            `${sponsorConfig.faucetCaps.daily}/day global · ledger ${sponsorConfig.faucetStorePath} — the drip IS the subsidy (M8)`
        : 'faucet: off — set RELAYER_FAUCET=on to drip starter STRK (spends principal; the drip stakes the whole journey)',
    )
    console.log(
      sponsorConfig.invites
        ? `invites: ${sponsorConfig.invites.allowance}/inviter per ` +
            `${sponsorConfig.invites.windowMs / 3_600_000}h · codes live ` +
            `${sponsorConfig.invites.ttlMs / 3_600_000}h · ` +
            `${sponsorConfig.invites.claimAttemptsPerDay} claim attempts/visitor/day · ` +
            `ledger ${sponsorConfig.inviteStorePath}`
        : `invites: off (set ${INVITE_SWITCH} to offer them)`,
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
