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
  proofFacts?: string[]
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
