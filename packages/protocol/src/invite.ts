//
// The invite client pipeline (FR-014 / FR-060, story 1.14) — Doors A and B, headless.
//
// NO DOM, NO REACT, NO UI. Everything here is a function epic 6 calls: the three relayer
// round-trips, the link the sender shares, the copy the surfaces render, and the watcher that
// notices an invitee registered. The transform, the composer and the ladder rows are epic 6's.
//
// THE COPY LIVES HERE, AS FUNCTIONS RATHER THAN AS STRINGS IN A COMPONENT. Flow W2 fixes every
// sentence in this flow byte-exactly, and a sentence that gets retyped inside a component is a
// sentence that drifts from the one that was reviewed. Building them here also makes the
// parameters explicit — which is how the registration cost stays a MEASURED NUMBER passed in
// rather than a literal somebody would have to remember to delete (story 1.13's ship gate).
//
// SETTLEMENT IS AN ORDINARY SEND, and it is worth being exact about why there is nothing else
// here to do it. Attaching money to an invite creates an INTENT held by the sender, not an
// escrow: `open_channel` asserts strictly sequential channel indices (`INDEX_NOT_SEQUENTIAL`,
// FR-060), so a relayer opening channels on users' behalf would be a global serialization point
// where one stuck release blocks everyone, and the on-chain sender would be the relayer rather
// than the person who meant it — a provenance lie in the one record that is public. So the
// sender's own `sendShielded` settles it, and take-back is genuinely free because nothing ever
// moved.
//

import { getPublicKey } from './pool.js'
import {
  CLAIMANT_TOKEN_MAX_LENGTH,
  CLAIMANT_TOKEN_MIN_LENGTH,
  INVITE_ALPHABET,
  INVITE_ALREADY_USED_NOTICE,
  INVITE_CODE_LENGTH,
  inviteExhaustedNotice,
  isAcceptableClaimant,
  normalizeInviteCode,
  type InviteClaimResponse,
  type InviteMintResponse,
  type InviteRefusalReason,
  type InviteState,
  type InviteStatusResponse,
} from './relayer-wire.js'

// The alphabet, the length and the normaliser come from the wire contract — ONE definition
// shared with the relayer, so a link the relayer minted and a link this parses cannot disagree.
export {
  CLAIMANT_TOKEN_MAX_LENGTH,
  CLAIMANT_TOKEN_MIN_LENGTH,
  INVITE_ALPHABET,
  INVITE_ALREADY_USED_NOTICE,
  INVITE_CODE_LENGTH,
  inviteExhaustedNotice,
  isAcceptableClaimant,
  normalizeInviteCode,
}
export type { InviteRefusalReason, InviteState }

// ── The code, as the client sees it ───────────────────────────────────────────────────────

/**
 * The path an invite link uses. A WEB-APP ROUTE, never a relayer one.
 *
 * Short because it is meant to be read off a phone screen and typed into another one.
 */
export const INVITE_LINK_PATH = '/i/'

/**
 * The shareable link for a code, against the app's own origin.
 *
 * THE ORIGIN IS A PARAMETER, always. The app is not the only thing that will ever host this
 * flow — a preview deployment, a local dev server and the judged deployment are three origins
 * for one build — and a hostname compiled into protocol code is a hostname somebody has to
 * remember to change before shipping.
 */
export function buildInviteLink(code: string, origin: string): string {
  const normalized = normalizeInviteCode(code)
  if (normalized === null) {
    throw new Error(`refusing to build a link for ${JSON.stringify(code)}: not an invite code`)
  }
  // THE ORIGIN IS CHECKED, NOT CONCATENATED. What comes out of here is pasted into a message and
  // sent to a real person, so an empty string, a bare hostname or a relative path would build
  // something like `/i/7f3a2b` or `app.example/i/7f3a2b` — strings that look like links, do not
  // resolve anywhere, and fail in the invitee's messaging app rather than in ours. `URL.origin`
  // also strips any path, query or fragment somebody passed along with the host, so the link
  // shape stays exactly `<origin>/i/<code>`.
  let base: string
  try {
    base = new URL(origin).origin
  } catch {
    throw new Error(
      `refusing to build a link against ${JSON.stringify(origin)}: an invite link needs an ` +
        'absolute origin like https://app.example, because it is shared with somebody else',
    )
  }
  if (base === 'null' || !/^https?:$/.test(new URL(origin).protocol)) {
    throw new Error(
      `refusing to build a link against ${JSON.stringify(origin)}: an invite link must be http ` +
        'or https, because it has to open in whatever browser the invitee is holding',
    )
  }
  return `${base}${INVITE_LINK_PATH}${normalized}`
}

/**
 * The code in whatever a user pasted, or `null`.
 *
 * Accepts the two shapes a code actually arrives in — a whole link and a bare code — because
 * both are things a person will paste: the link is what was shared, and the bare code is what
 * gets read aloud or retyped when the link did not survive the messaging app.
 *
 * ANYTHING ELSE IS `null`, INCLUDING A NEAR MISS. A link to `/invite/7f3a2b` or a code with a
 * seventh character is refused rather than repaired: a bearer code that can be guessed at
 * loosely is a bearer code with a larger surface than it looks.
 */
export function parseInviteLink(input: string): string | null {
  const trimmed = input.trim()
  const direct = normalizeInviteCode(trimmed)
  if (direct !== null) return direct

  // Parsed as a URL rather than pattern-matched, so a query string, a fragment or a trailing
  // slash cannot smuggle characters into the code. A relative path is resolved against a base
  // that is thrown away — this only ever reads the path.
  let path: string
  try {
    path = new URL(trimmed, 'https://invite.invalid').pathname
  } catch {
    return null
  }
  if (!path.startsWith(INVITE_LINK_PATH)) return null
  return normalizeInviteCode(path.slice(INVITE_LINK_PATH.length))
}

// ── The three relayer round-trips ─────────────────────────────────────────────────────────

/** Why an invite call did not produce an answer. Every branch is data a surface can render. */
export type InviteFailure =
  /**
   * The relayer refused, in its own words. `reason` is its typed token when it sent one.
   *
   * `left` and `nextInHours` ride along because an exhausted-allowance refusal is the ONE
   * refusal that has to render a sentence with a clock in it — `No invites left. One returns in
   * 19 hours.` — and the server is the only party that can compute either number. Dropping them
   * here would leave the exhausted Door B row with nothing to say, which is the locked door the
   * whole feature refuses to be.
   */
  | {
      kind: 'refused'
      status: number
      reason?: InviteRefusalReason
      notice?: string
      error?: string
      left?: number
      nextInHours?: number | null
    }
  /**
   * The code never left this device: it is not six characters from the invite alphabet.
   *
   * ITS OWN KIND, and never a fabricated `invite-not-found`. Whether a code exists is a fact only
   * the ledger can assert, and borrowing that token for a local shape check tells the surface
   * "this invite is gone" when the truth is "check what you pasted" — two different sentences
   * with two different next actions.
   */
  | { kind: 'invalid-code'; reason: string }
  /**
   * The claimant token never left this device: it is missing, too short or too long.
   *
   * ITS OWN KIND, not `invalid-code`, because it is a DIFFERENT DEFECT WITH A DIFFERENT OWNER.
   * The code is something a person pasted and can fix by looking at their link; the claimant
   * token is minted by the app and never typed, so a bad one is a caller bug the user cannot
   * act on. Labelling it as a bad code would send somebody to re-read a link that was fine.
   */
  | { kind: 'invalid-claimant'; reason: string }
  /** Nothing answered: offline, DNS, a dead port, a timeout. Retrying may work. */
  | { kind: 'relayer-unreachable'; reason: string }
  /** Something answered and it was not this protocol. Retrying will not help. */
  | { kind: 'relayer-unreadable'; reason: string }

export type InviteResult<T> = { ok: true; value: T } | { ok: false; failure: InviteFailure }

/** What a successful mint yields — the numbers Door B renders and the link it shares. */
export interface MintedInvite {
  code: string
  expiresAt: number
  left: number
  nextInHours: number | null
}

/** How long to wait on an invite round-trip. Small JSON on the app's own origin. */
export const INVITE_TIMEOUT_MS = 10_000

/** The endpoints, derived from the relayer URL the app already has. */
export function inviteEndpoint(relayerUrl: string, leaf: 'mint' | 'claim' | 'status'): string {
  const url = relayerUrl.replace(/\/submit$/, `/invite/${leaf}`)
  // A relayer URL that is not a `/submit` endpoint leaves the replace a no-op, and this would
  // then POST an invite body at the submit path. Refuse rather than improvise — the same rule
  // `readFeeRecipient` applies to the same class of misconfiguration.
  if (url === relayerUrl) {
    throw new Error(
      `cannot derive an invite endpoint from ${JSON.stringify(relayerUrl)}: it does not end in /submit`,
    )
  }
  return url
}

/** Everything the three calls reach outside themselves. Injected, so no test touches a network. */
export interface InviteDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

/** The local shape refusal, written once so both call sites report it identically. */
const invalidCode = (code: unknown): InviteFailure => ({
  kind: 'invalid-code',
  reason:
    `${JSON.stringify(code)} is not an invite code: it must be ${INVITE_CODE_LENGTH} characters ` +
    `from ${INVITE_ALPHABET}`,
})

/**
 * A fresh claimant token: 128 bits of CSPRNG, as 32 hex characters.
 *
 * WHAT IT IS FOR. A claim POST whose response is lost gets retried by the browser that already
 * won the burn. The token is how the relayer recognises that browser and answers the retry with
 * the same yes, instead of the double-claim refusal meant for somebody else.
 *
 * NOT DERIVED FROM ANYTHING — not the code, not the account, not a key, not a counter, not a
 * clock. A derived token is one an observer can compute, and computing another browser's token
 * means inheriting their burn. This is the same rule the invite code itself is minted under.
 *
 * IT CARRIES NO IDENTITY and must never be made to. It is not a session id, not a device id and
 * not a user handle: it exists for exactly one claim and is meaningless outside it. Reusing one
 * token across different invites would turn an idempotency token into a tracking cookie the
 * relayer could correlate claims by.
 *
 * WHERE IT LIVES IS EPIC 6'S CALL. A caller that wants retry-safety mints ONE token when the
 * user first intends to claim, reuses that same token on every retry of that claim, and needs it
 * to survive a reload for the retry to work across one. Whether that means sessionStorage, a
 * component ref, or nothing at all is a UI decision this module deliberately does not make — and
 * a caller that skips it simply loses retry-safety rather than correctness.
 */
export function mintClaimantToken(): string {
  const bytes = new Uint8Array(16)
  // `globalThis.crypto` rather than a Node import: this module runs in the browser, and
  // `getRandomValues` is the CSPRNG both environments have had for years.
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The local refusal for a token the relayer would reject on sight. */
const invalidClaimant = (claimant: unknown): InviteFailure => ({
  kind: 'invalid-claimant',
  reason:
    `${JSON.stringify(claimant)} is not a usable claimant token: it must be between ` +
    `${CLAIMANT_TOKEN_MIN_LENGTH} and ${CLAIMANT_TOKEN_MAX_LENGTH} characters. Mint one with ` +
    'mintClaimantToken().',
})

async function post<T>(url: string, body: unknown, deps: InviteDeps): Promise<InviteResult<T>> {
  const doFetch = deps.fetch ?? globalThis.fetch
  let res: Response
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? INVITE_TIMEOUT_MS),
    })
  } catch (e) {
    // NOTHING HERE IS IRREVERSIBLE, unlike the submit path. A mint that did not arrive minted
    // nothing and a claim that did not arrive burned nothing, so an unanswered invite call is
    // an honest "try again" rather than the delivery-unknown state `register.ts` has to carry.
    return { ok: false, failure: { kind: 'relayer-unreachable', reason: String(e) } }
  }
  let parsed: unknown
  try {
    parsed = (await res.json()) ?? {}
  } catch (e) {
    return {
      ok: false,
      failure: { kind: 'relayer-unreadable', reason: `the relayer did not answer JSON: ${String(e)}` },
    }
  }
  if (res.status !== 200) {
    const b = parsed as {
      reason?: InviteRefusalReason
      notice?: string
      error?: string
      left?: number
      nextInHours?: number | null
    }
    return {
      ok: false,
      failure: {
        kind: 'refused',
        status: res.status,
        reason: b?.reason,
        notice: b?.notice,
        error: b?.error,
        // Carried through rather than dropped: an exhausted allowance is refused WITH its clock,
        // and the row that renders it has no other source for these numbers.
        left: typeof b?.left === 'number' ? b.left : undefined,
        nextInHours: b?.nextInHours === null || typeof b?.nextInHours === 'number' ? b.nextInHours : undefined,
      },
    }
  }
  return { ok: true, value: parsed as T }
}

/**
 * Door B: asks the relayer for a code out of this inviter's allowance.
 *
 * THE BODY IS EMPTY AND MUST STAY EMPTY. The inviter is whoever is connecting, decided
 * server-side; a body that named one would make the allowance a number the caller picks.
 */
export async function mintInvite(
  relayerUrl: string,
  deps: InviteDeps = {},
): Promise<InviteResult<MintedInvite>> {
  const result = await post<InviteMintResponse>(inviteEndpoint(relayerUrl, 'mint'), {}, deps)
  if (!result.ok) return result
  const { code, expiresAt, left, nextInHours } = result.value
  // CHECKED, NOT TRUSTED — AND EVERY FIELD IS HELD TO THE SAME STANDARD, because coalescing a
  // missing one to a default is how a broken relayer produces a confidently wrong screen. A
  // missing `expiresAt` defaulted to 0 renders as an invite that expired in 1970; a missing
  // `left` defaulted to 0 renders `No invites left` to somebody who has three. Both look like
  // our bug and neither is recoverable by the user, so an incomplete 200 is a relayer this
  // client cannot use, exactly as a missing code already was.
  const normalized = normalizeInviteCode(code)
  const unreadable = (why: string): InviteResult<MintedInvite> => ({
    ok: false,
    failure: { kind: 'relayer-unreadable', reason: `the relayer answered 200 ${why}` },
  })
  if (normalized === null) return unreadable(`with no usable invite code (${JSON.stringify(code)})`)
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return unreadable(`with an unusable invite expiry (${JSON.stringify(expiresAt)})`)
  }
  if (typeof left !== 'number' || !Number.isInteger(left) || left < 0) {
    return unreadable(`with an unusable remaining-invite count (${JSON.stringify(left)})`)
  }
  // `null` IS a legal value here and means "nothing is pending", which is different from absent.
  if (nextInHours !== null && (typeof nextInHours !== 'number' || !Number.isFinite(nextInHours))) {
    return unreadable(`with an unusable next-invite time (${JSON.stringify(nextInHours)})`)
  }
  return { ok: true, value: { code: normalized, expiresAt, left, nextInHours } }
}

/**
 * The invitee's browser burning the code, once, when the link opens the app.
 *
 * A SUCCESS HERE IS NOT A REGISTRATION. It is the entitlement to attempt one: the burn happens
 * server-side before any submission entitlement exists, so exactly one of two simultaneous
 * visitors wins and the other gets `invite-already-used` with the sentence to show for it.
 *
 * `claimant` IS AN IDEMPOTENCY TOKEN AND IS OPTIONAL. Pass one — from `mintClaimantToken` — and
 * a retry of a claim whose response was lost answers with the same yes rather than the
 * double-claim refusal. Reuse THE SAME token across retries of one claim; mint a fresh one per
 * claim intent. Omit it and the call behaves exactly as it did before the parameter existed,
 * losing only retry-safety. See `InviteClaimBody.claimant` for why this cannot be the visitor id.
 */
export async function claimInvite(
  code: string,
  relayerUrl: string,
  deps: InviteDeps = {},
  claimant?: string,
): Promise<InviteResult<true>> {
  const normalized = normalizeInviteCode(code)
  if (normalized === null) {
    // Refused locally, before a request exists, for two reasons. A malformed code is not a claim
    // attempt and must not spend one against the relayer's per-visitor cap — and it is not
    // `invite-not-found` either, because that is a claim about the ledger that only the ledger
    // can make. "Check what you pasted" and "this invite is gone" are different next actions.
    return { ok: false, failure: invalidCode(code) }
  }
  // Checked before the request too, and for the same reason: a token the relayer would reject on
  // sight costs a round-trip and a 400 to discover, and the caller can fix it here.
  if (claimant !== undefined && !isAcceptableClaimant(claimant)) {
    return { ok: false, failure: invalidClaimant(claimant) }
  }
  const result = await post<InviteClaimResponse>(
    inviteEndpoint(relayerUrl, 'claim'),
    // Omitted entirely when absent, so a caller that wants no retry-safety sends the body this
    // function has always sent. A burn with no token recorded simply cannot be replayed.
    { code: normalized, ...(claimant !== undefined ? { claimant } : {}) },
    deps,
  )
  return result.ok ? { ok: true, value: true } : result
}

/** The sender's ladder, polling their own code. `consumed` reads back as `claimed`. */
export async function inviteStatus(
  code: string,
  relayerUrl: string,
  deps: InviteDeps = {},
): Promise<InviteResult<InviteState>> {
  const normalized = normalizeInviteCode(code)
  if (normalized === null) return { ok: false, failure: invalidCode(code) }
  const result = await post<InviteStatusResponse>(
    inviteEndpoint(relayerUrl, 'status'),
    { code: normalized },
    deps,
  )
  if (!result.ok) return result
  const state = result.value.state
  if (state !== 'unclaimed' && state !== 'claimed' && state !== 'expired') {
    return {
      ok: false,
      failure: {
        kind: 'relayer-unreadable',
        reason: `the relayer answered 200 with an unknown invite state (${JSON.stringify(state)})`,
      },
    }
  }
  return { ok: true, value: state }
}

// ── Copy (epic 6 renders these; this story only ships them) ───────────────────────────────

/**
 * Door B's account-menu row: `Invite · 3 left · 1 more in 19h`.
 *
 * BOTH NUMBERS COME FROM THE SERVER and neither is computed here. The window and the clock that
 * measures it are the relayer's, so a client that worked out its own `left` would be rendering
 * a guess at a policy it cannot see — and the first time an operator changed the allowance, the
 * menu would confidently disagree with the refusal the user then got.
 *
 * The second clause is DROPPED when nothing is pending, rather than rendered as `1 more in 0h`.
 */
export function inviteMenuRow(left: number, nextInHours: number | null): string {
  const base = `Invite · ${left} left`
  return nextInHours === null ? base : `${base} · 1 more in ${nextInHours}h`
}

/**
 * The exhausted state, which is a PRESSABLE REFUSAL and never a locked door.
 *
 * The row stays pressable and answers with this sentence — a disabled control that says nothing
 * is the interaction this product refuses to ship, because it leaves the user to guess whether
 * they did something wrong.
 */
export const inviteExhaustedRow = inviteExhaustedNotice

/** The composer, above the optional amount field. */
export const INVITE_COMPOSER = {
  message:
    'They cannot receive private funds until they register. This invite pays their registration.',
  /**
   * Shown only when an amount is attached. It is the take-back promise, and it is true in the
   * strongest sense: there is no escrow, no channel and no transaction — the intent is the only
   * artefact, so revoking it costs nothing and touches no network.
   *
   * WHAT COMES BACK IS THE MONEY, NOT THE INVITE. Taking it back does not un-burn the code or
   * cancel the registration it pays for; that gift stands, and an invitee who already claimed
   * still gets their account. Only the attached amount dies. The sentence says "taking IT back"
   * about the amount the field above it holds, which is what a sender reading this is looking
   * at — see `revokeInviteIntent` in session-invite-store.ts for the same note beside the code.
   */
  attachedAmount:
    'Held as your intent until they claim it. ' +
    'Take it back any time — taking it back is free, because nothing has moved yet.',
} as const

/**
 * The prefilled, editable share text.
 *
 * `appName` is a parameter for the same reason `origin` is: the app's name belongs to the
 * deployment, not to the protocol package.
 */
export function inviteShareText(appName: string, link: string): string {
  return `I set up an account for you on ${appName}. It is already paid for. ${link}`
}

/**
 * The row an invitee sees on the cold open: `abu invited you. …`
 *
 * THE COST IS AN OPTIONAL PARAMETER AND THERE IS NO LITERAL ANYWHERE. Story 1.13 HAS
 * banked the real registration (24 Aug 2026): 8.594 STRK measured, recorded with full
 * provenance in `SPONSORED_REGISTRATION_EVIDENCE` (register.ts) and
 * `evidence/sponsored-registration.json`. Nothing here renders from it yet, and the
 * sentence below is now KNOWN-STALE in a way a number cannot fix: the session also
 * proved a cold-start account is TWO transactions (DEPLOY_ACCOUNT, unsponsored, then
 * the registration), so "costs one Starknet transaction" is false for the embedded-key
 * invitee this row addresses. Reworking the copy and its tests — and wiring the cost
 * from the evidence export — is epic-6's recorded obligation (deferred-work.md); this
 * comment records the fact so the stale sentence cannot pass for a checked one.
 */
export function inviteeRow(inviter: string, cost?: string): string {
  const price = cost ? `, about ${cost}` : ''
  return (
    `${inviter} invited you. Creating an account costs one Starknet transaction${price}. ` +
    `${inviter}'s invite covers it once.`
  )
}

/** Shown to the invitee when the sender attached money: it is waiting, not sent. */
export function inviteMoneyAttached(inviter: string, amount: string, symbol: string): string {
  return `${inviter} also sent you ${amount} ${symbol}. It is waiting for you.`
}

/**
 * Shown to the invitee after they register, while the sender's app has not settled yet.
 *
 * IT NAMES THE DEPENDENCY RATHER THAN HIDING IT. The money lands when the sender's app opens,
 * because the sender is the one who opens the channel; a sentence that implied it was already
 * in flight would be the escrow this design deliberately does not have.
 */
export function inviteMoneyWaiting(inviter: string, amount: string, symbol: string): string {
  return `${inviter} is sending you ${amount} ${symbol}. It lands once ${inviter}'s app is open.`
}

/**
 * The named form of the double-claim refusal, for the one party that can honestly say a name.
 *
 * The relayer sends `INVITE_ALREADY_USED_NOTICE`, which names nobody — it does not know who abu
 * is and should not be told (relayer-wire.ts). An app that DOES know the inviter renders this
 * instead. Same fact, and the named one is the sentence Flow W2 specifies.
 */
export function inviteAlreadyUsedNotice(inviter: string): string {
  return (
    `This invite was already used. ${inviter} can send another, ` +
    'or you can create an account from a funded wallet.'
  )
}

/** The sender's activity row, one line per ladder state. */
export function inviteLadderRow(code: string, state: InviteIntentState, recipientName?: string): string {
  switch (state) {
    case 'not-opened':
      return `Invite ${code} · not opened`
    case 'opened-not-registered':
      return `Invite ${code} · opened, not registered`
    case 'ready-to-settle':
    case 'settled':
      return `${recipientName ? `you → ${recipientName}` : `Invite ${code}`} · registered`
    case 'expired':
      return 'Invite expired. Nothing had moved.'
    case 'revoked':
      return `Invite ${code} · taken back. Nothing had moved.`
  }
}

// ── The watcher ───────────────────────────────────────────────────────────────────────────

/**
 * Where one invite intent stands. The ladder the sender's row walks.
 *
 * `ready-to-settle` is the interesting one: the invitee has a registered key, so the attached
 * amount can now be sent as an ORDINARY `sendShielded`. Nothing in this module sends it — that
 * is the sender's own send, with the sender's own key, from the sender's own channel index.
 */
export type InviteIntentState =
  | 'not-opened'
  | 'opened-not-registered'
  | 'ready-to-settle'
  | 'settled'
  | 'expired'
  | 'revoked'

/**
 * One poll's answer. `blocked-rpc-unknown` is a FIFTH answer, never a fourth reading of one of
 * the others — see `pollInviteSettlement`.
 *
 * `gave-up-watching` can only come out of `watchInviteSettlement`, never out of a single poll:
 * it is the loop reporting that it hit its own round bound without reaching a conclusion, which
 * is a fact about the WATCHER rather than about the invite.
 */
export type InviteWatchOutcome =
  | { state: InviteIntentState }
  | { state: 'blocked-rpc-unknown'; reason: string }
  | { state: 'gave-up-watching'; rounds: number; last: InviteIntentState | 'blocked-rpc-unknown' }

export interface WatchDeps extends InviteDeps {
  /** The free `get_public_key` read. Injected so a watcher test costs nothing and no network. */
  readPublicKey?: (address: string) => Promise<bigint>
  now?: () => number
}

/**
 * One round: where does this intent stand right now?
 *
 * FAILS CLOSED, IN BOTH DIRECTIONS. A relayer that will not answer and an RPC that will not
 * answer both produce `blocked-rpc-unknown` with the reason attached — never `registered` and
 * never `not-opened`. Reading an unavailable chain as "they registered" would tell a sender to
 * send real money to an address that still rejects it (`RECIPIENT_NOT_REGISTERED`), which is the
 * one mistake this whole flow exists to prevent; reading it as "not opened" would quietly stall
 * a ladder that has actually moved.
 *
 * `recipient` IS OPTIONAL, and its absence is a real product state rather than a missing
 * argument. Door A starts from a pasted address, so the sender knows exactly who they invited
 * and this can check the chain. Door B is a link to nobody in particular — the invitee mints a
 * brand-new account whose address the sender has no way to know — so the ladder can go no
 * further than `opened-not-registered` from here. Learning that address is out of scope for this
 * story and is named as such rather than guessed at.
 */
export async function pollInviteSettlement(
  intent: { code: string; recipient?: string | null; state?: InviteIntentState },
  relayerUrl: string,
  deps: WatchDeps = {},
): Promise<InviteWatchOutcome> {
  // Terminal local states are never re-polled. A revoked intent is the sender's decision and no
  // amount of chain state overturns it; a settled one is done.
  if (intent.state === 'revoked' || intent.state === 'settled') return { state: intent.state }

  const status = await inviteStatus(intent.code, relayerUrl, deps)
  if (!status.ok) {
    const f = status.failure
    // A relayer that answers `invite-not-found` has told us something real: the code aged out of
    // its ledger. Everything else — unreachable, unreadable, a refusal we cannot interpret — is
    // an absence of information and must read as one.
    if (f.kind === 'refused' && f.reason === 'invite-not-found') return { state: 'expired' }
    const reason =
      f.kind === 'refused' ? `the relayer refused the status read (${f.status})` : f.reason
    return { state: 'blocked-rpc-unknown', reason }
  }

  if (status.value === 'expired') return { state: 'expired' }
  if (status.value === 'unclaimed') return { state: 'not-opened' }

  // Claimed. Whether they actually REGISTERED is a chain fact, not a relayer one, and it is the
  // fact that decides whether money can move — so it is read from the chain.
  if (!intent.recipient) return { state: 'opened-not-registered' }
  const read = deps.readPublicKey ?? getPublicKey
  let key: bigint
  try {
    key = await read(intent.recipient)
  } catch (e) {
    return { state: 'blocked-rpc-unknown', reason: String(e) }
  }
  return { state: key === 0n ? 'opened-not-registered' : 'ready-to-settle' }
}

export interface WatchOptions extends WatchDeps {
  /** How long between polls. */
  intervalMs?: number
  /** Called after every round, including the `blocked-rpc-unknown` ones. */
  onOutcome?: (outcome: InviteWatchOutcome) => void
  /** Resolves after `ms`. Injected so a test drives the loop without waiting. */
  sleep?: (ms: number) => Promise<void>
  /** Stops the loop. The caller owns it, because the caller owns the tab. */
  signal?: AbortSignal
  /** A hard bound on rounds. Defaults to `INVITE_MAX_WATCH_ROUNDS` — see there for why finite. */
  maxRounds?: number
}

/** Default poll period: slow enough to be free, fast enough that a sender is not left waiting. */
export const INVITE_POLL_INTERVAL_MS = 15_000

/**
 * How many rounds a watcher runs before it gives up: 24 hours at the default interval.
 *
 * FINITE BY DEFAULT, and the default is the whole point. The bound exists for the forgotten tab
 * — the sender who invited somebody on Tuesday and left the page open — and a default of
 * infinity would have documented a bound while shipping none, quietly polling a dead invite
 * every fifteen seconds for as long as the browser lives.
 *
 * A day is chosen against the thing being waited for: an invitee who is going to turn up turns
 * up in minutes or hours, and one who has not turned up in a day is not being waited for by
 * anyone still watching the screen. Giving up is reported as `gave-up-watching`, never as a
 * conclusion about the invite — the intent is still whatever it was, and a caller that wants to
 * keep going passes a larger `maxRounds` deliberately.
 */
export const INVITE_MAX_WATCH_ROUNDS = Math.ceil((24 * 3_600_000) / INVITE_POLL_INTERVAL_MS)

/**
 * Polls until the intent reaches a state worth acting on, the caller stops it, or the round
 * bound is reached.
 *
 * KEEPS POLLING THROUGH `blocked-rpc-unknown`, which is the whole point of that state existing:
 * an RPC blip is not an answer, so the watcher reports it, waits, and asks again. It is NOT a
 * terminal state and it never becomes one — a watcher that gave up on the first failed read
 * would leave a sender staring at a row that had actually moved.
 *
 * EVERY READ IN THIS LOOP IS FREE. `get_public_key` is a view call and the status poll is one
 * small JSON round-trip to the app's own relayer; nothing here signs, proves or spends.
 */
export async function watchInviteSettlement(
  intent: { code: string; recipient?: string | null; state?: InviteIntentState },
  relayerUrl: string,
  options: WatchOptions = {},
): Promise<InviteWatchOutcome> {
  const {
    intervalMs = INVITE_POLL_INTERVAL_MS,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    maxRounds = INVITE_MAX_WATCH_ROUNDS,
    onOutcome,
    signal,
  } = options

  let last: InviteWatchOutcome = { state: 'blocked-rpc-unknown', reason: 'not polled yet' }
  let rounds = 0
  for (; rounds < maxRounds; rounds++) {
    if (signal?.aborted) return last
    last = await pollInviteSettlement(intent, relayerUrl, options)
    try {
      onOutcome?.(last)
    } catch (e) {
      // An observer is for watching, not for voting — the same rule `registerSponsored` applies
      // to `onStage`. A component that unmounted mid-poll must not stop the watch.
      console.warn(`invite: onOutcome observer threw and was ignored: ${String(e)}`)
    }
    // Terminal for the WATCHER's purposes: `ready-to-settle` hands off to the sender's own send,
    // and `expired` is the end of the road. `opened-not-registered` and `not-opened` keep going,
    // and so does `blocked-rpc-unknown`.
    if (last.state === 'ready-to-settle' || last.state === 'expired') return last
    if (signal?.aborted) return last
    await sleep(intervalMs)
  }
  // The bound was reached without a conclusion. Reported as the watcher's own outcome rather
  // than as the last poll's, so a caller cannot mistake "we stopped looking" for "it is still
  // not opened" — the invite may well have moved since.
  return {
    state: 'gave-up-watching',
    rounds,
    last: last.state === 'gave-up-watching' ? 'blocked-rpc-unknown' : last.state,
  }
}
