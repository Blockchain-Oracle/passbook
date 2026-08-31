//
// The `POST /submit` wire contract.
//
// ONE DEFINITION, both ends. The browser builds this body (`register.ts`) and the server
// parses it (`relayer/src/routes/submit.ts`); before this existed, each side described the shape
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
 * our bug.
 */
export const RELAYER_DOWN_NOTICE =
  'The relayer is not submitting right now. ' +
  'You can still submit from a funded Starknet wallet.'

/**
 * Shown when the cap on RELAYED SENDS is spent.
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
   * The account this submission is for, so its sponsored allowance is counted down and can be
   * shown back. Optional — a body without one is metered by hashed IP alone.
   *
   * SELF-REPORTED, AND THEREFORE NOT A SECURITY CONTROL. Nothing here proves the sender owns this
   * address, and a caller willing to make new accounts gets new allowances. That is deliberate:
   * the IP-keyed budgets and the relayer's own balance are what bound the spend, and this field
   * exists so a person can be shown a number that matches their experience rather than their
   * network's. Do not add a check here and start treating it as an entitlement.
   */
  account?: string
  /**
   * True when this batch folds NO reimbursement leg, so the relayer's own STRK pays `collect_fee`
   * and is not paid back. Implied by `sponsored`, which is never reimbursed either.
   *
   * ── IT IS WHAT SPENDS THE ACCOUNT ALLOWANCE, AND ONLY IT ──────────────────────────────────
   *
   * A reimbursed send costs this relayer gas alone — the 6 STRK returns inside the same
   * transaction — so it must NOT consume one of the transactions we advertised as covered. Metering
   * every relayed submission alike would burn a user's three on sends they were paying for
   * themselves, and then refuse the ones they were owed.
   *
   * UNVERIFIABLE BY THE RELAYER, like `sponsored`: `apply_actions` calldata is deliberately
   * uninspected, so nothing here can tell a batch that reimburses from one that does not. The flag
   * routes to a meter; it grants nothing. A client that lies gets what the allowance permits and
   * no more, which is precisely why the allowance exists.
   */
  covered?: boolean
  /**
   * Explicit v3 resource bounds, so the submitter SKIPS fee estimation. `Account.execute` forwards
   * the proof pair to the broadcast and to nothing else, so `starknet_estimateFee` simulates the
   * transaction with the proof ABSENT and every value-moving pool transaction reverts inside the
   * estimate. Bounds make `prepareInvoke` skip it; they are CEILINGS, not charges.
   */
  resourceBounds?: {
    l1_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
    l2_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
    l1_data_gas: { max_amount: string | bigint; max_price_per_unit: string | bigint }
  }
  /** Prover facts for a proven pool submission: a non-empty array of felt strings, validated server-side. */
  proofFacts?: string[]
  /**
   * The proof blob the facts belong to (~300KB of base64), carried whole. BOTH-OR-NEITHER with
   * `proofFacts` — the sequencer rejects one without the other, and the server refuses the mismatch
   * at the free layer so it costs a 400 instead of a paid broadcast rejection. Receipts do NOT echo
   * this field back: an accepted proven transaction looks proof-less when read.
   */
  proof?: string
  /**
   * Present, and `true`, only on a submission the relayer is being asked to PAY FOR out of its own
   * budget — a sponsored registration. An unflagged body is charged to the send cap instead.
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
   * Present, and `true`, only on a STARTER DRIP — the shielded balance we GIVE a new account.
   *
   * ── A DRIP IS NOT A SPONSORED TRANSACTION, AND THE COUNTER MUST NOT SAY IT IS ─────────────
   *
   * The two words name different money. A sponsored transaction is us paying the pool fee and gas
   * so a user can do something THEY wanted; that is what the three covered transactions are, and
   * spending one is the user spending a unit of their own. A drip is us handing over principal —
   * the 2 STRK that buys a deploy, and this, the first shielded note. Nobody spends a covered
   * transaction to receive a gift, so this flag routes AROUND the account allowance: the drip still
   * costs the IP-keyed sponsorship budget (it is a real submission our key pays for) and is gated
   * once per account by the faucet ledger's claim set, but the number on the user's screen does not
   * move.
   *
   * Requires `sponsored: true` and an `account`: the address the note is minted to is also the key
   * the one-time claim is burned under. `true` is the only accepted value, like `sponsored`.
   */
  drip?: true
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
   *   - `allowance-spent` — this ACCOUNT has used its sponsored transactions. Distinct from
   *     `send-cap-reached` because it is a per-account count the user has been watching count
   *     down, not a shared rate limit they have no way to see coming.
   *   - `relayer-down` — the relayer cannot pay at all right now (503, funding-monitor.ts).
   */
  reason?: string
  /** Operator-authored copy the client shows verbatim rather than paraphrasing. */
  notice?: string
  /** This account's sponsored-transaction allowance AFTER this request. See `AllowanceBody`. */
  sponsorship?: Allowance
}

/**
 * The sponsored-transaction allowance for one account: what is left, and what it started at.
 *
 * BOTH NUMBERS TRAVEL, because the client renders "2 of 3" and must not learn the denominator from
 * a constant of its own — the cap is an operator setting that can change between deploys, and a
 * hardcoded 3 would quietly start lying the day it does.
 */
export interface Allowance {
  remaining: number
  of: number
}

/**
 * What `GET /allowance/:address` answers, so the shell can show the counter without submitting.
 *
 * A MISSING `allowance` IS NOT A ZERO. It means this deployment does not meter per account, or the
 * ledger could not be read — and a counter that renders "0 of 0" on a read failure would tell every
 * user their offer had been withdrawn. The client shows nothing when it is absent.
 */
export interface AllowanceBody {
  allowance?: Allowance
  error?: string
}

/**
 * Shown when an ACCOUNT has spent the transactions we cover. Names what is gone and what is not:
 * the account still works, it now pays its own pool fee like any other.
 */
export const ALLOWANCE_SPENT_NOTICE =
  'You have used the transactions we cover. Your account still works — ' +
  'each transaction now pays the pool fee from your own balance.'

/**
 * Shown when this account has already taken its starting balance.
 *
 * ITS OWN SENTENCE, like every other refusal here. "The budget is spent" would be false — the drip
 * is refused because this account already HAS one, which is a fact about them rather than about us,
 * and someone who reads a budget message will simply come back tomorrow and be refused again.
 */
export const STARTER_CLAIMED_NOTICE =
  'This account already has its starting balance. The pool fee for what you do next comes from that balance.'

/**
 * What `GET /faucet/:address` answers: whether this address can still take the starter drip.
 *
 * TWO FIELDS BECAUSE THERE ARE TWO WAYS TO HAVE NOTHING TO OFFER, and a screen must not confuse
 * them. `claimed: true` means this address already took its one drip — say so, do not offer.
 * `available: false` means this deployment hands none out to anybody — say nothing at all, because
 * "you have used it" would be a lie told to someone who never had one.
 *
 * An unreachable relayer answers neither, and the client resolves `null`: also say nothing. The
 * offer only appears when the ledger that will actually be spent says it is there.
 */
export interface FaucetClaimBody {
  claimed?: boolean
  /**
   * The SHIELDED starter: how much a registered account is given as its first note, and whether
   * this one already took it. Absent from a deployment that hands none out.
   *
   * `wei` IS A STRING because JSON has no bigint and a number would lose precision above 2^53. It
   * is read rather than hardcoded in the browser for the same reason the pool fee is: the amount
   * our relayer will actually pay for is the relayer's to state.
   */
  starter?: { wei: string; claimed: boolean }
  available?: boolean
  error?: string
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

/**
 * The relayer's endpoints, as the browser addresses them.
 *
 * ── RELATIVE, AND THEY LIVE HERE RATHER THAN IN `register.ts` ─────────────────────────────
 *
 * Relative because the browser resolves them against the app's own origin, so the proxy in front
 * of the relayer is what carries `x-relayer-auth` and the page never holds it.
 *
 * HERE because this module is a runtime LEAF — its only import is a type, which is erased — and
 * `register.ts` is the head of the crypto graph. A caller that needs nothing but a URL string
 * must be able to get one without pulling `starknet` into its chunk, and `build:web`'s eager
 * budget is not a style preference: it failed a build over exactly this import, from
 * `shell/faucet.ts`, which is a fetch wrapper with no cryptography in it at all.
 *
 * ONE OBJECT, so the two paths cannot drift apart. `register.ts` re-exports `submit` as
 * `DEFAULT_RELAYER_URL`, which is the name every existing caller already uses.
 */
export const RELAYER_PATHS = {
  submit: '/api/submit',
  faucet: '/api/faucet',
} as const
