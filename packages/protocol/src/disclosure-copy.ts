//
// Every sentence the disclosure panel ships (story 6.7, DESIGN §7.5, EXPERIENCE §4.3).
//
// One const per sentence, exported, `toBe`-asserted in `test/disclosure.test.ts`, and imported by
// the panel rather than retyped into it — `activity-copy.ts`'s discipline, for `activity-copy.ts`'s
// reason. A claim about what a third party can see appears on the review screen, on the receipt and
// in `docs/privacy.md`, and three hand-typed copies of a privacy claim will not survive a redesign
// identical.
//
// ── THE VOICE, WHICH IS A RULE AND NOT A STYLE ────────────────────────────────────────────
//
// EXPERIENCE §3 rule 8: verb-first, specific, NAMES THE ACTOR, states what it CANNOT see, and
// disclaims our relationship to it. "This is private" is not a sentence in this file. "The pool
// sees this transaction, not your notes" is, because it names who sees, what they see, and where
// their sight stops — and a reader can check every clause of it.
//
// ── THE LINT TRAP, IN THE ONE PLACE IT BITES HARDEST ──────────────────────────────────────
//
// `forbidden-claims.ts` lists ten claims this product does not make, matched as bare substrings
// over whole files INCLUDING COMMENTS. Three of them are the hyphenated capability words a
// visibility matrix reaches for first, and one of them appears inside the chat room's own sourced
// disclosure — in the clause where that disclosure DISCLAIMS it. The fix is always to reword, never
// to exempt, and every rewording below is recorded on the const that carries it.
//
// ── WHY TWO SENTENCES ARE COPIED RATHER THAN IMPORTED ─────────────────────────────────────
//
// `POOL_SEES` and `SELF_SUBMIT_SENDER` already exist, in `register.ts` and `send.ts`. Importing
// them from here would drag a chain client into the browser bundle behind any component that wants
// a disclosure line — story 6.4's 268 kB lesson, and the reason `degraded.ts` and
// `pipeline-stage.ts` reach nothing either. It would also break
// `scripts/render-privacy-matrix.mjs`, which loads this module with plain `node` under type
// stripping and cannot follow a `.js` specifier onto a `.ts` file.
//
// So they are duplicated, and `test/disclosure.test.ts` asserts both against the originals with
// `toBe`. That is the same device `route-contract.ts` uses to make its duplicated `Mode` list safe:
// a duplicated list is a list that drifts, and the assertion is what stops it.
//

// ── The two that already exist elsewhere ──────────────────────────────────────────────────

/** Byte-identical to `register.ts`'s `POOL_SEES_DISCLOSURE`. Pinned by the test, not by hope. */
export const POOL_SEES = 'The pool sees this transaction, not your notes.'

/**
 * Byte-identical to `send.ts`'s `SELF_SUBMIT_DISCLOSURE`, and built the same way it is.
 *
 * ESCALATION IS STRING CONTAINMENT. `send.test.ts` asserts that the self-submit sentence CONTAINS
 * the pool one — the pool still sees the transaction either way, and what self-submission ADDS is
 * the sender slot in the public record. Composing it here rather than retyping it keeps that shape.
 */
export const SELF_SUBMIT_SENDER =
  `${POOL_SEES} Submitting it yourself puts your own address on it as the sender.`

// ── The lines that recur ──────────────────────────────────────────────────────────────────

/**
 * What the relayer gets, said on every path that uses one.
 *
 * NAMES THE LIMIT IN THE SAME BREATH. "The relayer sees your network address" on its own is read as
 * "the relayer sees everything"; the second sentence is what makes the first a fact instead of an
 * alarm, and it is the sanctioned ceiling rather than a reassurance we invented.
 */
export const RELAYER_SEES =
  'The relayer that submits this sees the network address it came from and the moment it arrived. ' +
  'It cannot read your notes.'

/**
 * The auditor escrow, as STRUCTURE and never as a warning (EXPERIENCE §5.5 / FR-018).
 *
 * "No acknowledgement checkbox, because a warning implies a choice and there is none." The escrow
 * is a property of the protocol, not a setting, so the sentence states it flatly and then closes
 * every door a reader would otherwise go looking for — which is the shape §W5c uses when it says
 * "We can't, we can't compel them, and there is no process to ask."
 */
export const AUDITOR_ESCROW =
  "StarkWare's auditor holds an escrowed copy of your viewing key and can read this. We cannot " +
  'decrypt it for you, we cannot compel them, and there is no process to ask.'

/** The counterpart to the pool sentence: what actually stays behind. */
export const NOTES_STAY =
  'Your notes stay encrypted to your key — the amount and the counterparty are not in the public ' +
  'record.'

/** The heading above the matrix wherever it renders. DESIGN §7.5 part 2, in the user's words. */
export const WHO_CAN_READ = 'Who can read this'

/**
 * Scopes the matrix's `You` column on a receipt whose amount this browser could not read.
 *
 * ── THE CONTRADICTION THIS EXISTS TO DELETE ───────────────────────────────────────────────
 *
 * A settled receipt for an encrypted note prints `AMOUNT_NOT_OURS_TO_READ` — "the amount is not in
 * the public record" — and, four inches below it, a matrix whose You/Amount cell reads `Sees`. Two
 * claims about the same number, on one screen, in opposite directions.
 *
 * Neither claim is wrong. The matrix's `You` is the party who TOOK the action, and on a row this
 * browser did not originate the reader is not that party. Saying so is the whole fix, and it is
 * better than hiding the matrix: the baseline is what is honestly true of any pool transaction, and
 * a receipt that dropped it would be a receipt that stopped disclosing.
 *
 * "Not readable here" rather than "not yours": a row that IS ours can still arrive with a `null`
 * amount when no discovered note matched it, and calling that row somebody else's would be a second
 * false claim replacing the first.
 */
export const RECEIPT_YOU_IS_THE_ACTOR =
  'The amount on this row is not readable here, so "You" in the table below means whoever made ' +
  'this transaction.'

// ── Sending ───────────────────────────────────────────────────────────────────────────────

/** Self-submission has a safer path and it is a real one, so the panel offers it as a button. */
export const SELF_SUBMIT_WAY_OUT = 'Submit through the relayer instead'

/**
 * What replaces the relayer, and it is the SAME SENTENCE the matrix carries on the network cell.
 *
 * `visibility-matrix.ts`'s `SELF_SUBMIT_NODE_SEES` is this string byte for byte, pinned by
 * `test/disclosure.test.ts`, because the panel states it as a line and the matrix carries it as the
 * qualifier on the same claim. The two modules cannot import each other — both are loaded by
 * `render-privacy-matrix.mjs` under plain Node — so an assertion is what keeps them one sentence,
 * and `footnoteText` is what stops both renderers printing it twice on one screen.
 *
 * The cell it belongs to is `conditional`, not `absent`: "no relayer" is true and, left unqualified,
 * paints as "nobody on the network sees you". The observer moved; it did not disappear.
 */
export const SELF_SUBMIT_NO_RELAYER =
  'No relayer carries this, so nothing about it reaches us — but your wallet still hands the ' +
  'transaction to a Starknet node, and that node sees the request and the network address it came ' +
  'from.'

// ── Registration ──────────────────────────────────────────────────────────────────────────

/**
 * Registration is public by construction, and there is no version of it that is not.
 *
 * Stated at `low` severity for the escrow row's reason: a warning implies a choice, and an account
 * that is not registered cannot be sent to at all (`activity-copy.ts`'s `BOOK_NOT_REGISTERED`).
 */
export const REGISTRATION_PUBLIC =
  'Registering writes your account address and a public key to the pool, so this account is ' +
  'publicly registered from then on. Anyone can look it up.'

/** EXPERIENCE §W5c, with the live block number left where it can be true — on screen. */
export const REGISTRATION_ESCROW_PINNED =
  'An encrypted copy of your key is written on-chain in the same transaction, encrypted to the ' +
  'auditor key as it stands at your registration block.'

export const REGISTRATION_NO_VALUE =
  'Registering moves no tokens. There is no amount and no counterparty in this transaction.'

// ── Chat ──────────────────────────────────────────────────────────────────────────────────

/**
 * The relay metadata line (FR-021), which is the one place we see more than we do anywhere else.
 *
 * Every relayed action gives us a network address and a timestamp. A ROOM gives us the graph — who
 * is talking to whom, and how often — and that is a genuine step up, which is why this context
 * carries `medium` where an ordinary send carries `low`.
 */
export const CHAT_RELAY_METADATA =
  'The relay that carries this room sees who is talking to whom, when, how often, and how big each ' +
  'message is — and, because your conversation list rides one connection, which conversations ' +
  'share you. What is inside them stays ciphertext.'

/**
 * EXPERIENCE §C1.3's room disclosure, REWORDED IN ITS LAST CLAUSE AND NOWHERE ELSE.
 *
 * The sourced sentence ends "We don't call this ⟨the banned hyphenated phrase for encryption that
 * no third party can break⟩" — and that phrase is one of the ten refused claims, matched as a bare
 * substring, so the shipped sentence would trip the sweep in the exact clause where it disclaims
 * the claim. Reworded to say the same thing without naming it. The first two sentences are verbatim.
 */
export const CHAT_AUDITOR_DERIVES =
  "Encrypted in transit. Free key agreement uses keys already on-chain — which means StarkWare's " +
  "auditor escrow can derive this conversation's secret and read these messages, including old " +
  'ones, without asking you. So we do not use the strongest word the industry has for this.'

// ── Swap ──────────────────────────────────────────────────────────────────────────────────

/** EXPERIENCE §S1.4, the block headline, verbatim. */
export const SWAP_VISIBLE =
  'Visible on-chain: both amounts, both tokens, the timing. Hidden: which account owns them.'

/**
 * FR-033's observer's-voice sentence, with the placeholders taken out.
 *
 * The source writes it with symbols ("swapping X→Y for amount A") because it is describing a
 * template. A shipped sentence cannot carry a placeholder, and the live figures are already on the
 * screen beside it, so the sentence says what an observer sees and lets the numbers speak for
 * themselves.
 */
export const SWAP_OBSERVER =
  'On-chain this appears as the router contract swapping one token for another; the amounts and ' +
  'the timing are public, and which account owns them is not.'

/** FR-029 / the swap brief §2, verbatim. */
export const SWAP_RELAY_QUOTE =
  'Quotes are fetched through our relay — the aggregator sees the pair and amount from the ' +
  "relay's address, never yours."

/** Why the recipient row of the matrix is empty rather than hidden. */
export const SWAP_RETURNS_TO_YOU =
  'The output returns to your own shielded pool in the same transaction, so there is no recipient ' +
  'to reveal.'

// ── Bridge ────────────────────────────────────────────────────────────────────────────────

/** 09-bridge §4, MANDATORY PHRASING. Not paraphrasable — the scope is the claim. */
export const BRIDGE_SCOPE =
  'The crossing hides which shielded note funded the withdrawal. It does not hide the amount, the ' +
  'destination address, the destination chain, or the timing.'

/** 09-bridge §4, verbatim. The one `high` line in the story, and the one irreversible CTA. */
export const BRIDGE_IRREVERSIBLE =
  'Once burned, USDC can only arrive at the destination — never be refunded.'

/** EXPERIENCE §B1.8 / FR-041, verbatim — "the row every demo skips". */
export const BRIDGE_DESTINATION_GAS =
  'The receiving address has USDC but no gas. It can hold and receive; it cannot send anything ' +
  'onward until it has gas — and topping it up from an address you control recreates exactly the ' +
  'link this exit removes.'

/** D27 / FR-036, verbatim. The third panel of the rebuilt anatomy: a way out that is a button. */
export const BRIDGE_WAY_OUT = 'Use a fresh address instead'

// ── Markets ───────────────────────────────────────────────────────────────────────────────

/** FR-009, verbatim (EXPERIENCE §M1.4). The conditional half is the sentence's whole value. */
export const MARKETS_BET_VISIBLE =
  'Visible on-chain: the amount and the timing. Who bet is hidden — as long as your denomination ' +
  'has company; if you are the only one at this size, your bet is identifiable.'

/** Why fixed sizes exist at all, said as the thing that protects rather than as a limitation. */
export const MARKETS_DENOMINATIONS =
  'Fixed bet sizes are what give you company — a bet at a size other people are also betting on ' +
  'looks like theirs.'

// ── Launch ────────────────────────────────────────────────────────────────────────────────

/** FR-049 / the launch brief §7.1, verbatim. */
export const LAUNCH_IDENTITY =
  'Your identity is hidden. Your amount is not. Every buy is a plaintext event; the pool hides ' +
  'who, and fixed denominations hide which one is you.'

/**
 * The blending line (launch brief §7.2) with the live count taken out.
 *
 * The sourced sentence names the crowd number twice, and EXPERIENCE §3 rule 7 requires those to be
 * live exact integers read at render time. A constant cannot hold one, so this states the condition
 * and the number stays on the denomination picker where it is read from the chain.
 *
 * AND IT IS THE MATRIX'S QUALIFIER TOO. `visibility-matrix.ts`'s `LAUNCH_BUY_COMPANY` is this
 * string byte for byte — see `SELF_SUBMIT_NO_RELAYER` above for why the pin is an assertion rather
 * than an import, and `footnoteText` for what stops it printing twice on one screen.
 */
export const LAUNCH_CROWD =
  'Your buy looks identical to the other buys at the same size in this launch. If yours is the ' +
  'only one at that size, you are alone.'

// ── The headline per context ──────────────────────────────────────────────────────────────

/**
 * The one line that takes the panel's semantic colour, per review context.
 *
 * IT LIVES HERE RATHER THAN IN `disclosure.ts` so that both consumers read the same object:
 * `docs/privacy.md` is rendered by a `.mjs` script that imports this module directly under Node
 * type stripping and cannot reach `disclosure.ts` (which imports three siblings). Keyed by the
 * context id as a plain string for the same reason — this module imports nothing, so it cannot name
 * `VisibilityContext`. `disclosure.ts` is where the key set is pinned to that union.
 *
 * The two unauthored contexts are absent on purpose: a headline for a context whose disclosure
 * nobody wrote is the guess this story exists to refuse.
 */
// ── The Houses (docs/governance.md §15 — the sentences we ship, verbatim from the spec) ────

export const GOV_BALLOT_VISIBLE =
  'Your ballot’s weight is public. Your ballot’s choice is sealed. Your identity is neither on ' +
  'the ballot nor derivable from it.'

export const GOV_TELLER_PEEK =
  'Until close, our Teller can read choices early; it cannot forge, drop, or miscount them — ' +
  'the contract checks the math before a tally can publish.'

export const GOV_NOT_ANONYMITY =
  'Voting requires a registered pool account. This is privacy, not anonymity from the protocol — ' +
  'StarkWare’s auditor escrow applies here as everywhere.'

export const GOV_JOIN_ROLL =
  'Joining puts a pool-derived handle, not your address, on the House’s roll. The submitting ' +
  'account remains visible on the transaction.'

export const GOV_DELEGATE_POT =
  'The delegate’s pot grows by this amount in public. The House stores a derived delegator handle, ' +
  'while the transaction submitter remains visible.'

export const GOV_FUND_GIVEN =
  'The treasury grows by this amount, in public, and the gift has no way back — a treasury that ' +
  'could be clawed back one donor at a time would not be a treasury.'

export const GOV_RECLAIM_BEARER =
  'The escrow comes back as a fresh note to whoever presents the bearer secret. The settlement ' +
  'transaction and its submitter remain visible.'

export const DISCLOSURE_HEADLINE = {
  'pool-send': POOL_SEES,
  'self-submit': SELF_SUBMIT_SENDER,
  registration: REGISTRATION_PUBLIC,
  'chat-payment': CHAT_RELAY_METADATA,
  swap: SWAP_VISIBLE,
  'bridge-exit': BRIDGE_SCOPE,
  'markets-bet': MARKETS_BET_VISIBLE,
  'launch-buy': LAUNCH_IDENTITY,
  'gov-ballot': GOV_BALLOT_VISIBLE,
  'gov-join': GOV_JOIN_ROLL,
  'gov-delegate': GOV_DELEGATE_POT,
  'gov-fund': GOV_FUND_GIVEN,
  'gov-reclaim': GOV_RECLAIM_BEARER,
} as const
