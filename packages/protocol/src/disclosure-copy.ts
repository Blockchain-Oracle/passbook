//
// Every sentence the disclosure panel ships. One const per sentence, imported by the panel rather
// than retyped: a claim about what a third party can see appears on the review screen and on the
// receipt, and hand-typed copies of a privacy claim drift.
//
// The voice is a rule: verb-first, specific, NAMES THE ACTOR, states what it CANNOT see, and
// disclaims our relationship to it. "This is private" is not a sentence in this file.
//
// `POOL_SEES` and `SELF_SUBMIT_SENDER` duplicate `register.ts` / `pipeline.ts` rather than import
// them: importing would drag a chain client into the browser bundle behind any component that
// wants a disclosure line.
//

// ── The two that already exist elsewhere ──────────────────────────────────────────────────

/** Byte-identical to `register.ts`'s `POOL_SEES_DISCLOSURE`. */
export const POOL_SEES = 'The pool sees this transaction, not your notes.'

/** Byte-identical to `pipeline.ts`'s `SELF_SUBMIT_DISCLOSURE`: the pool sentence plus what self-submission adds. */
export const SELF_SUBMIT_SENDER =
  `${POOL_SEES} Submitting it yourself puts your own address on it as the sender.`

// ── The lines that recur ──────────────────────────────────────────────────────────────────

/** What the relayer gets, with its limit named in the same breath — the sanctioned ceiling, not a reassurance. */
export const RELAYER_SEES =
  'The relayer that submits this sees the network address it came from and the moment it arrived. ' +
  'It cannot read your notes.'

/** The auditor escrow, as STRUCTURE and never as a warning: a warning implies a choice and there is none. */
export const AUDITOR_ESCROW =
  "StarkWare's auditor holds an escrowed copy of your viewing key and can read this. We cannot " +
  'decrypt it for you, we cannot compel them, and there is no process to ask.'

/** The counterpart to the pool sentence: what actually stays behind. */
export const NOTES_STAY =
  'Your notes stay encrypted to your key — the amount and the counterparty are not in the public ' +
  'record.'

/** The heading above the matrix wherever it renders, in the user's words. */
export const WHO_CAN_READ = 'Who can read this'

// ── Sending ───────────────────────────────────────────────────────────────────────────────

/** Self-submission has a safer path and it is a real one, so the panel offers it as a button. */
export const SELF_SUBMIT_WAY_OUT = 'Submit through the relayer instead'

/**
 * Byte-identical to `visibility-matrix-data.ts`'s `SELF_SUBMIT_NODE_SEES`. The cell it belongs to
 * is `conditional`, not `absent`: "no relayer" is true and, left unqualified, paints as "nobody on
 * the network sees you". The observer moved; it did not disappear.
 */
export const SELF_SUBMIT_NO_RELAYER =
  'No relayer carries this, so nothing about it reaches us — but your wallet still hands the ' +
  'transaction to a Starknet node, and that node sees the request and the network address it came ' +
  'from.'

// ── Registration ──────────────────────────────────────────────────────────────────────────

/** Registration is public by construction; stated at `low` because an unregistered account cannot be sent to at all. */
export const REGISTRATION_PUBLIC =
  'Registering writes your account address and a public key to the pool, so this account is ' +
  'publicly registered from then on. Anyone can look it up.'

/** The live block number is left where it can be true — on screen. */
export const REGISTRATION_ESCROW_PINNED =
  'An encrypted copy of your key is written on-chain in the same transaction, encrypted to the ' +
  'auditor key as it stands at your registration block.'

export const REGISTRATION_NO_VALUE =
  'Registering moves no tokens. There is no amount and no counterparty in this transaction.'

// ── Chat ──────────────────────────────────────────────────────────────────────────────────

/** A ROOM gives the relay the graph — who talks to whom, how often — a real step up from an ordinary send. */
export const CHAT_RELAY_METADATA =
  'The relay that carries this room sees who is talking to whom, when, how often, and how big each ' +
  'message is — and, because your conversation list rides one connection, which conversations ' +
  'share you. What is inside them stays ciphertext.'

/** The last clause is reworded to disclaim the industry's strongest phrase without naming it (`forbidden-claims.ts`). */
export const CHAT_AUDITOR_DERIVES =
  "Encrypted in transit. Free key agreement uses keys already on-chain — which means StarkWare's " +
  "auditor escrow can derive this conversation's secret and read these messages, including old " +
  'ones, without asking you. So we do not use the strongest word the industry has for this.'

// ── Swap ──────────────────────────────────────────────────────────────────────────────────

export const SWAP_VISIBLE =
  'Visible on-chain: both amounts, both tokens, the timing. Hidden: which account owns them.'

/** The observer's-voice sentence; the live figures are on the screen beside it. */
export const SWAP_OBSERVER =
  'On-chain this appears as the router contract swapping one token for another; the amounts and ' +
  'the timing are public, and which account owns them is not.'

export const SWAP_RELAY_QUOTE =
  'Quotes are fetched through our relay — the aggregator sees the pair and amount from the ' +
  "relay's address, never yours."

/** Why the recipient row of the matrix is empty rather than hidden. */
export const SWAP_RETURNS_TO_YOU =
  'The output returns to your own shielded pool in the same transaction, so there is no recipient ' +
  'to reveal.'

// ── Bridge ────────────────────────────────────────────────────────────────────────────────

/** Mandatory phrasing. Not paraphrasable — the scope is the claim. */
export const BRIDGE_SCOPE =
  'The crossing hides which shielded note funded the withdrawal. It does not hide the amount, the ' +
  'destination address, the destination chain, or the timing.'

/** The one `high` line, and the one irreversible CTA. */
export const BRIDGE_IRREVERSIBLE =
  'Once burned, USDC can only arrive at the destination — never be refunded.'

/** The row every demo skips. */
export const BRIDGE_DESTINATION_GAS =
  'The receiving address has USDC but no gas. It can hold and receive; it cannot send anything ' +
  'onward until it has gas — and topping it up from an address you control recreates exactly the ' +
  'link this exit removes.'

/** A way out that is a button. */
export const BRIDGE_WAY_OUT = 'Use a fresh address instead'

// ── Markets ───────────────────────────────────────────────────────────────────────────────

/** The conditional half is the sentence's whole value. */
export const MARKETS_BET_VISIBLE =
  'Visible on-chain: the amount and the timing. Who bet is hidden — as long as your denomination ' +
  'has company; if you are the only one at this size, your bet is identifiable.'

/** Why fixed sizes exist at all, said as the thing that protects rather than as a limitation. */
export const MARKETS_DENOMINATIONS =
  'Fixed bet sizes are what give you company — a bet at a size other people are also betting on ' +
  'looks like theirs.'

// ── Launch ────────────────────────────────────────────────────────────────────────────────

export const LAUNCH_IDENTITY =
  'Your identity is hidden. Your amount is not. Every buy is a plaintext event; the pool hides ' +
  'who, and fixed denominations hide which one is you.'

/**
 * The crowd number stays on the denomination picker, read live; a constant cannot hold one.
 * Byte-identical to `visibility-matrix-data.ts`'s `LAUNCH_BUY_COMPANY`.
 */
export const LAUNCH_CROWD =
  'Your buy looks identical to the other buys at the same size in this launch. If yours is the ' +
  'only one at that size, you are alone.'

// ── The Houses (docs/architecture.md — Houses; the sentences we ship, verbatim) ────

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

/**
 * The voter handle, said honestly.
 *
 * The POOL's own comment calls it reproducible "only by the user". That is true of the pool in the
 * abstract and false of this deployment, where the auditor escrow reaches the same key — and
 * "only you can" is on `FORBIDDEN_CLAIMS` for exactly that reason. What survives is the useful
 * half: the roll holds this instead of an address.
 */
export const GOV_HANDLE_IS_YOURS =
  'The pool derives this from your account and this contract, so the roll carries it instead of ' +
  'your address. Give it to anyone who wants to delegate their weight to you. This is privacy, ' +
  'not anonymity from the protocol — StarkWare’s auditor escrow applies here as everywhere.'

export const GOV_HANDLE_UNCONFIRMED =
  'Not on this roll — join the House and your handle appears here.'

export const GOV_RECLAIM_BEARER =
  'The escrow comes back as a fresh note to whoever presents the bearer secret. The settlement ' +
  'transaction and its submitter remain visible.'

/**
 * The one line per review context that takes the panel's semantic colour. Keyed by the context id
 * as a plain string because this module imports nothing; `disclosure.ts` pins the key set. The two
 * unauthored contexts are absent on purpose.
 */
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
