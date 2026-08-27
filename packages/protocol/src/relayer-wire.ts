//
// The `POST /submit` wire contract.
//
// ONE DEFINITION, both ends. The browser builds this body (`register.ts`) and the server
// parses it (`relayer/src/server.ts`); before this existed, each side described the shape
// in its own words and the only thing keeping them agreed was that one person had written
// both. It lives in `protocol` because that is the package both halves already depend on
// — putting it in the relayer would make the browser import server code.
//
// It is a WIRE type, so everything here has to survive `JSON.stringify`: felts are
// strings, never bigints.
//

import type { Call } from 'starknet'

// ── The operator notices this endpoint answers with ───────────────────────────────────────
//
// THEY LIVE HERE, WITH THE WIRE CONTRACT, because they ARE part of it: the server sends them and
// the browser renders them verbatim, so they are as much a shared definition as the field names
// they arrive in. Keeping them in the relayer package meant the browser either imported server
// code to check one, or kept a second copy that would drift — and a notice that drifts is a
// promise made in two different words.

/**
 * Shown when the relayer cannot submit at all, whatever the reason.
 *
 * Says what happened and what still works, in one sentence. Ops learns the cause from the
 * funding monitor's page; the user learns only that this route is closed and the other is open.
 * The relayer's balance never appears here — a number would leak our funding state and read as
 * our bug (FR-053).
 */
export const RELAYER_DOWN_NOTICE =
  'The relayer is not submitting right now. ' +
  'You can still submit from a funded Starknet wallet.'

/**
 * Shown when the cap on RELAYED SENDS is spent (story 1.16).
 *
 * ITS OWN SENTENCE, and it must stay one. A send is not a sponsorship — the fee is reimbursed by
 * a `Withdraw` leg inside the user's own proven action chain — so showing someone the
 * registration notice here would tell them their account creation was paused, which is both
 * false and about a thing they already have. Same voice, same reset promise, different subject
 * and different alternative: submitting a send yourself is a path a registered user actually has.
 */
export const SEND_CAP_NOTICE =
  'Relayed sends are paused until 00:00 UTC. ' +
  'You can still submit this send from your own Starknet wallet.'

/**
 * Shown to the loser of a simultaneous claim on one invite code (story 1.14, Flow W2).
 *
 * NO INVITER NAME IN IT, and that absence is a fact about the relayer rather than a shortened
 * sentence. The invite ledger keys mints on a salted hash of the inviter's IP and stores nothing
 * else about them — it does not know that abu is abu, and giving it a display name to echo back
 * would mean the relayer holding a name next to an address for every invite ever minted. So the
 * server says the true general thing, and the sender's own app — the one party that legitimately
 * knows the name — renders the named sentence through `inviteAlreadyUsedNotice` in `invite.ts`.
 * Both are byte-exact for the party that can honestly say them.
 */
export const INVITE_ALREADY_USED_NOTICE =
  'This invite was already used. The person who invited you can send another, ' +
  'or you can create an account from a funded wallet.'

/**
 * The exhausted-allowance sentence, built around a number ONLY the server can compute.
 *
 * The client never works out how many invites are left or when the next one returns: the window
 * is the relayer's config, the clock that matters is the relayer's, and a client that computed
 * either would be guessing at a policy it cannot see. It receives `nextInHours` and renders it.
 *
 * The singular is handled rather than left as `1 hours`. It is one branch, it is the copy a user
 * sees at the exact moment they are most likely to look twice, and a plural bug there reads as
 * the whole feature being unfinished.
 */
export function inviteExhaustedNotice(nextInHours: number): string {
  return `No invites left. One returns in ${nextInHours} ${nextInHours === 1 ? 'hour' : 'hours'}.`
}

/** The body `POST /submit` accepts. */
export interface SubmitBody {
  /** The calls to sign, in order. The relayer's allowlist decides which are permitted. */
  calls: Call[]
  /**
   * Prover facts for a proven pool submission (story 1.12). OPTIONAL and additive: a
   * body without it is an ordinary submission and behaves exactly as it did before this
   * field existed. When present it must be a non-empty array of felt strings — the
   * server validates it, because these ride in the V3 transaction details rather than in
   * any call's calldata and so never pass the allowlist.
   */
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
  resourceBounds?: {
    l1_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
    l2_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
    l1_data_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
  }
  proofFacts?: string[]
  /**
   * The proof blob the facts belong to — the prover's `proof` string (~300KB of base64),
   * carried whole and unparsed. BOTH-OR-NEITHER with `proofFacts`, and that rule is the
   * sequencer's before it is ours: `starknet_addInvokeTransaction` rejects a v3 invoke
   * carrying `proof_facts` without `proof` ("must either both be present or both be
   * absent" — learned from story 1.13's first real broadcast, 2026-08-24). The server
   * refuses one-without-the-other at the free layer so the mismatch costs a 400 instead
   * of a signed, paid-for broadcast rejection.
   *
   * Receipts do NOT echo this field back, which is why it was invisible to every
   * receipt-sampling probe: an accepted proven transaction looks proof-less when read
   * back. Do not "verify" its presence by fetching transactions.
   */
  proof?: string
  /**
   * Present, and `true`, only on a submission the relayer is being asked to PAY FOR out of its
   * own budget — today exactly one thing: a sponsored registration (story 1.12).
   *
   * OPTIONAL IN SHAPE, BUT IT CHANGED THE DEFAULT BRANCH — and that is worth stating plainly
   * rather than calling this purely additive. Before story 1.16 an unflagged body was charged to
   * the sponsorship budget, because the server treated every accepted submission as a
   * sponsorship. Now an unflagged body is charged to the send cap instead. The shape is
   * backwards-compatible; the METERING is not, and a client that predated the flag would find
   * its registrations counted against the wrong ceiling. None does — `register.ts` is the only
   * producer of a registration body and it sets the flag in the same commit that split the
   * budgets — which is what makes the change safe, not the field being optional.
   *
   * WHY THE SPLIT. A sponsored registration is a lone `SetViewingKey` that mints nothing, so
   * there is no value in the transaction to reimburse the fee from and the relayer's own STRK
   * pays it — that is what the sponsorship budget bounds. A send reimburses the fee with a
   * `Withdraw` leg folded into its own proven action chain, so it must not spend the budget that
   * gives cold visitors their one free account, nor be refused with copy about registrations.
   *
   * `true` is the only accepted value. A `false` or a `"yes"` is refused rather than read as
   * absence, because "sponsored: false" and "not sponsored" reaching the same branch by
   * truthiness is how a flag stops meaning anything.
   *
   * THE RELAYER CANNOT VERIFY THE CLAIM THIS FLAG MAKES, and that is by design rather than an
   * oversight: `apply_actions` calldata is deliberately uninspected (allowlist.ts:179-182), so
   * nothing here can tell a batch that reimburses from one that does not. The flag routes to a
   * cap; it does not grant anything.
   *
   * BOTH LIES ARE BOUNDED, and both are worth naming. Flagging a SEND as sponsored burns the
   * visitor's sponsored-registration allowance — bounded by the sponsorship caps, and it costs
   * the liar their own free account rather than the relayer's balance. Omitting the flag on a
   * REGISTRATION charges it to the send cap, which meters it just as strictly and simply shows
   * the wrong notice if it is refused. Neither direction escapes a ceiling, which is what makes
   * an unverifiable flag acceptable here at all.
   */
  sponsored?: true
  /**
   * A burned invite code, presented by the INVITEE on their own sponsored registration (story
   * 1.14). Six characters from the invite alphabet; the relayer validates the shape and then the
   * ledger.
   *
   * WHAT IT BUYS IS EXACTLY ONE THING: the per-visitor sponsorship cap is waived for this
   * submission. It is not a budget bypass and not a discount. The global daily budget is checked
   * unchanged, and when that budget is spent an invited visitor sees the same honest degrade
   * everyone else does. "abu's invite covers it once" has to hold for someone on a NAT-shared
   * mobile IP whose per-visitor cap strangers already exhausted — that is the whole reason the
   * waiver exists — but it must never become a promise the relayer's balance cannot keep.
   *
   * ONLY MEANINGFUL ALONGSIDE `sponsored: true`, and refused without it. The cap it waives is the
   * sponsorship cap; on a plain submission there is nothing for it to do, so accepting it there
   * would be accepting a field that silently means nothing.
   *
   * UNLIKE `sponsored`, THIS CLAIM IS VERIFIED. The relayer holds the ledger the code was minted
   * and burned in, so an unclaimed, unknown, expired or already-consumed code is a 400 rather
   * than a routing hint. The code is consumed on acceptance, so it waives exactly one cap once.
   */
  invite?: string
}

// ── The invite code: alphabet, length, and the one normaliser ─────────────────────────────
//
// DEFINED HERE, ONCE, BECAUSE THE CODE IS PART OF THE WIRE CONTRACT. The relayer mints from
// this alphabet and the browser parses links against it, so two independent copies is two
// copies of a rule that has to agree byte for byte — and the drift is silent in the worst
// direction: a relayer whose alphabet gained a character would mint codes its own tests accept
// and the client rejects as malformed, which a user experiences as an invite that simply does
// not work.

/**
 * The 32 characters a code is drawn from — Crockford's base32, lowercased.
 *
 * `i`, `l`, `o` and `u` are absent: the first three are the classic transcription collisions
 * with `1`, `1` and `0`, and `u` is left out so a random draw cannot spell something a user has
 * to read aloud to a stranger. Exactly 32 characters is also what lets the relayer draw a
 * character with `byte & 31` without bias, since 256 is a whole multiple of 32.
 */
export const INVITE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Six characters: what the link shows, and what the ledger keys on. */
export const INVITE_CODE_LENGTH = 6

const CODE_SHAPE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

/**
 * The canonical form of a presented code, or `null` when it is not one.
 *
 * Returns the canonical form rather than a boolean so no caller can validate one string and
 * then look up a different one — the trim-and-lowercase has to happen exactly once, on the way
 * in, and on both sides of the wire it has to happen the same way.
 *
 * NO CHARACTER-SUBSTITUTION NORMALISATION, deliberately. Mapping a typed `o` to `0` would make
 * two different strings name one code, and for a bearer token that is a cheap widening of the
 * guessing surface in exchange for fixing a typo the alphabet was chosen to prevent. Case is
 * folded, because case is not information here and a phone keyboard capitalises.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toLowerCase()
  return CODE_SHAPE.test(code) ? code : null
}

// ── The invite substrate (story 1.14 / FR-014) ────────────────────────────────────────────
//
// Three routes, all JSON POSTs behind the same gates as `/submit`. There is deliberately NO
// `/i/<code>` path route on the relayer: the link's job is to open the WEB APP, which then
// claims over JSON like everything else. Path-param routing would mean editing the one function
// every security gate in the relayer lives in, to buy nothing.

/**
 * Why an invite call was refused, in a token the client branches on rather than parsing prose.
 *
 *   - `invite-allowance-exhausted` — this inviter has spent their rolling window. Carries
 *     `nextInHours`, so the refusal can say when one returns. NEVER a locked door.
 *   - `invite-mint-daily-cap` — no inviter can mint right now, because the GLOBAL daily mint
 *     ceiling is reached. A different fact from the one above and deliberately a separate token:
 *     the first is "you have used yours", the second is "the relayer has used everyone's". Both
 *     carry `nextInHours` and both are pressable refusals rather than locked doors, but only the
 *     second is a fact about the relayer's day, so ops can tell them apart in a log.
 *   - `invite-already-used` — the code was claimed by someone else first. The loser of a
 *     simultaneous claim sees this; exactly one winner, always.
 *   - `invite-expired` — the code was real and its TTL passed.
 *   - `invite-not-found` — no such code was ever minted, or it aged out of the ledger.
 *   - `invite-too-many-attempts` — this visitor has spent their claim attempts for the UTC day.
 *     A six-character bearer code has to be guess-resistant by rate rather than by length.
 *   - `invite-not-claimed` — `/submit` was handed a code nobody has claimed. The burn happens
 *     before any submission entitlement exists, so an unclaimed code entitles nothing.
 *   - `invite-consumed` — the code already paid for a registration. One code, one waiver.
 *   - `invites-not-offered` — this relayer has no invite ledger configured. A refusal rather
 *     than a silent ignore, so a client cannot believe a waiver applied when none did.
 */
export type InviteRefusalReason =
  | 'invite-allowance-exhausted'
  | 'invite-mint-daily-cap'
  | 'invite-already-used'
  | 'invite-expired'
  | 'invite-not-found'
  | 'invite-too-many-attempts'
  | 'invite-not-claimed'
  | 'invite-consumed'
  | 'invites-not-offered'

/**
 * `POST /invite/mint` takes no fields at all.
 *
 * The inviter is identified the same way every other gate here identifies a caller — a salted
 * hash of the connecting address, computed server-side. Letting the body name an inviter would
 * make the rolling allowance a number the caller chooses, which is not an allowance.
 */
export type InviteMintBody = Record<string, never>

/** What `POST /invite/mint` answers. */
export interface InviteMintResponse {
  /** Present only on a 200: six characters the inviter shares. */
  code?: string
  /** When the code stops being claimable, in epoch ms. Present with `code`. */
  expiresAt?: number
  /**
   * Invites remaining in this inviter's rolling window AFTER this call, and `0` on a refusal.
   * The Door B row renders this number; it never derives one.
   */
  left?: number
  /**
   * Hours until the next invite returns to the window, or `null` when the window is empty and
   * nothing is pending. Server-computed against the server's own clock and window.
   */
  nextInHours?: number | null
  reason?: InviteRefusalReason
  notice?: string
  error?: string
}

/**
 * The length bounds a claimant token must fall inside.
 *
 * A floor because a short token is guessable, and guessing one lets a stranger inherit somebody
 * else's burn; a ceiling because this is stored per invite in a file rewritten whole on every
 * write, and an unbounded string is an unbounded ledger.
 */
export const CLAIMANT_TOKEN_MIN_LENGTH = 8
export const CLAIMANT_TOKEN_MAX_LENGTH = 128

/** True while `value` is a usable claimant token. One rule, checked identically on both sides. */
export function isAcceptableClaimant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= CLAIMANT_TOKEN_MIN_LENGTH &&
    value.length <= CLAIMANT_TOKEN_MAX_LENGTH
  )
}

/** `POST /invite/claim` — the invitee's browser, once, when the link opens the app. */
export interface InviteClaimBody {
  code: string
  /**
   * A client-minted idempotency token: random, 8–128 characters, carrying NO identity.
   *
   * WHAT IT FIXES. A claim POST whose response is lost — a dropped radio, a killed tab, a
   * backgrounded phone — gets retried by the very browser that won the burn. Without a way to
   * recognise that browser, the retry reads as a second claimant and the real invitee is shown
   * `invite-already-used`: locked out of the invite they hold by a network blip.
   *
   * WHY NOT THE VISITOR ID. The obvious answer — recognise the winner by the id the caps already
   * key on — is wrong, and wrong in the direction that hands out invites. Visitor ids are derived
   * from the client ADDRESS, so every browser behind one NAT shares one: the LOSER of a genuine
   * double-claim race in the same cafe, office or household would match the winner's id and be
   * told they had won. The whole point of the burn is that exactly one claimant wins, and an
   * address is not a claimant. A token the browser mints itself is: a different browser behind
   * the same address holds a different token and correctly loses.
   *
   * OPTIONAL, AND ITS ABSENCE IS SAFE. A burn that recorded no token can never be replayed — a
   * retry without one is treated as a fresh claim and refused. That fails toward refusing, which
   * is the correct direction for a bearer credential; the cost is only that a caller who did not
   * offer a token does not get retry-safety.
   *
   * IT MUST NOT BE DERIVED FROM ANYTHING. Not the code, not the account, not a key, not a
   * counter. A derived token is one an observer can compute, and computing another browser's
   * token means inheriting their burn.
   */
  claimant?: string
}

/** What `POST /invite/claim` answers. A 200 means this caller is the one winner. */
export interface InviteClaimResponse {
  claimed?: true
  reason?: InviteRefusalReason
  notice?: string
  error?: string
}

/** `POST /invite/status` — the sender's ladder, polling their own code. */
export interface InviteStatusBody {
  code: string
}

/**
 * Where a code stands, from the ledger.
 *
 * `consumed` READS AS `claimed` on purpose. The sender's ladder is about whether their invitee
 * turned up, and "claimed" already answers that; splitting out `consumed` would tell the sender
 * that a registration submission has been made, which is a fact about someone else's traffic
 * and is not theirs to watch. Whether the invitee actually registered is answered by the free
 * `get_public_key` read the watcher does against the chain, not by this.
 */
export type InviteState = 'unclaimed' | 'claimed' | 'expired'

/** What `POST /invite/status` answers. */
export interface InviteStatusResponse {
  state?: InviteState
  reason?: InviteRefusalReason
  error?: string
}

/** What `POST /submit` answers, whatever the status. */
export interface SubmitResponseBody {
  /** Present, and non-empty, only on a 200. */
  transactionHash?: string
  error?: string
  /**
   * Why a 403 or 503 happened, in a token the client can branch on:
   *
   *   - `sponsorship-paused` — the SPONSORSHIP budget is spent. Only a `sponsored` submission
   *     can see this, and its notice talks about registrations.
   *   - `send-cap-reached` — the relayer's cap on plain submissions is spent for this visitor
   *     or this day. Distinct from the above so a send never renders registration copy, and so
   *     the client can offer self-submission rather than a dead end.
   *   - `relayer-down` — the relayer cannot pay at all right now (503, funding-monitor.ts).
   *   - Any `InviteRefusalReason` — the body carried an `invite` the ledger refused (400). These
   *     arrive on a 400 rather than a 403 because a code that is unclaimed, unknown, expired or
   *     already spent makes the REQUEST wrong, not the caller unwelcome; nothing was refused on
   *     policy and nothing was metered.
   */
  reason?: string
  /** Operator-authored copy the client shows verbatim rather than paraphrasing. */
  notice?: string
}

/** What `GET /fee-recipient` answers: the address a reimbursement `Withdraw` must name. */
export interface FeeRecipientBody {
  /**
   * The relayer's own address, read from ITS configuration and never guessed by the client.
   *
   * The fee fold has to happen client-side — the proof binds the action list, so only the
   * prover's caller can add the reimbursement leg — which means the client has to know where to
   * send it. Hardcoding the relayer address in browser code would make rotating the signing
   * wallet a front-end release; asking for it is one free GET.
   */
  feeRecipient?: string
  error?: string
}
