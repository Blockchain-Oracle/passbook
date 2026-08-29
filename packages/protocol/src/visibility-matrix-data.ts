//
// The visibility matrix DATA: the review contexts, their labels, and every cell (FR-058).
//
// Every cell here is a privacy claim, and each traces to a sentence in the planning documents.
// Three recur: the relayer cannot read notes (it sees the network address and the moment a request
// arrived, nothing inside a note); the auditor sees whatever the viewing key sees (escrowed copy,
// not a network party, so no network address); and `absent` is not `hidden` — a registration moves
// no tokens and a swap returns to the same account, so painting those cells hidden would claim we
// protect something that does not exist.
//
// A conditional cell cannot be spelled without its condition (FR-009's "as long as your
// denomination has company"), and an unauthored context is a declared value with the reason, so a
// surface can only print the reason rather than render an empty grid that reads as "nothing to see".
//

import type { VisibilityActor, VisibilityCell, VisibilityFact } from './visibility-matrix.js'

// ── The review contexts ───────────────────────────────────────────────────────────────────

/**
 * Every action that reaches a Review screen. Closed. `pool-send` is also the BASELINE: what is
 * true of any pool transaction, and what a receipt falls back to for a row this browser did not
 * originate (`Transaction.surface` is `null` on every reconstructed row).
 */
export const VISIBILITY_CONTEXTS = [
  'pool-send',
  'self-submit',
  'registration',
  'chat-payment',
  'swap',
  'bridge-exit',
  'markets-bet',
  'markets-exit',
  'launch-buy',
  'launch-sell',
  'gov-ballot',
  'gov-join',
  'gov-delegate',
  'gov-fund',
  'gov-reclaim',
] as const

export type VisibilityContext = (typeof VISIBILITY_CONTEXTS)[number]

export const CONTEXT_LABELS = {
  'pool-send': 'Sending through the relayer',
  'self-submit': 'Submitting it yourself',
  registration: 'Registering with the pool',
  'chat-payment': 'Paying inside a chat room',
  swap: 'Swapping',
  'bridge-exit': 'Crossing to another chain',
  'markets-bet': 'Placing a bet',
  'markets-exit': 'Selling a position early',
  'launch-buy': 'Buying into a launch',
  'launch-sell': 'Selling before graduation',
  'gov-ballot': 'Casting a sealed ballot',
  'gov-join': 'Joining a House',
  'gov-delegate': 'Delegating voting weight',
  'gov-fund': 'Funding a House treasury',
  'gov-reclaim': 'Reclaiming ballot escrow',
} as const satisfies Record<VisibilityContext, string>

// ── The notes, and the two refusals ───────────────────────────────────────────────────────

/** FR-009, verbatim (EXPERIENCE §M1.4). The condition IS the honesty. */
const MARKETS_BET_COMPANY =
  'Who bet is hidden — as long as your denomination has company; if you are the only one at this ' +
  'size, your bet is identifiable.'

/** Byte-identical to `disclosure-copy.ts`'s `LAUNCH_CROWD`. */
const LAUNCH_BUY_COMPANY =
  'Your buy looks identical to the other buys at the same size in this launch. If yours is the ' +
  'only one at that size, you are alone.'

/** Byte-identical to `disclosure-copy.ts`'s `SELF_SUBMIT_NO_RELAYER`. The observer moved, it did not disappear. */
const SELF_SUBMIT_NODE_SEES =
  'No relayer carries this, so nothing about it reaches us — but your wallet still hands the ' +
  'transaction to a Starknet node, and that node sees the request and the network address it came ' +
  'from.'

const MARKETS_EXIT_UNAUTHORED =
  'Nobody has written the disclosure for an early market exit. EXPERIENCE §M2.3 drafts it under ' +
  '[ASSUMPTION] and gap G4 sends it to an FR-051 hand review, because a market-priced exit is a ' +
  'unique amount with none of the denomination cover an entry has — so the cells that would make ' +
  'it look like a bet are exactly the claim nobody has checked.'

const LAUNCH_SELL_UNAUTHORED =
  'Nobody has written the disclosure for selling before graduation. FR-046 pins the mechanism and ' +
  'EXPERIENCE §L6 records every sell-side sentence as unwritten, flagged for the sell spec when it ' +
  'is sequenced. Until then the product says the true thing instead: selling before graduation is ' +
  'not yet available.'

// docs/governance.md §15's sentences, cell-sized.
const GOV_BALLOT_SEALED =
  'Your ballot’s weight is public. Your choice is sealed — until close, our Teller can read ' +
  'choices early; it cannot forge, drop or miscount them, because the contract checks the math ' +
  'before a tally can publish. Your identity is neither on the ballot nor derivable from it.'

const GOV_JOIN_COUNT_ONLY =
  'The public sees the House’s member COUNT move; the roll stores pool-derived handles instead ' +
  'of addresses. The transaction submitter remains visible.'

const GOV_DELEGATE_SOURCE =
  'The pot grew by this amount in public. The House stores a derived delegator handle, and the ' +
  'transaction submitter remains visible.'

// ── The matrices ──────────────────────────────────────────────────────────────────────────

export type CellRow = Readonly<Record<VisibilityActor, VisibilityCell>>

export interface AuthoredMatrix {
  readonly authored: true
  readonly context: VisibilityContext
  readonly cells: Readonly<Record<VisibilityFact, CellRow>>
}

export interface UnauthoredMatrix {
  readonly authored: false
  readonly context: VisibilityContext
  /** One sentence naming why there is no matrix, in the voice a reader can act on. */
  readonly because: string
}

export type VisibilityMatrix = AuthoredMatrix | UnauthoredMatrix

const SEES: VisibilityCell = { state: 'sees' }
const HIDDEN: VisibilityCell = { state: 'hidden' }
const ABSENT: VisibilityCell = { state: 'absent' }

/** The only way to build the qualified cell, and it cannot be built without its qualifier. */
function conditional(note: string): VisibilityCell {
  return { state: 'conditional', note }
}

/** Positional, in `VISIBILITY_ACTORS` order, so a row reads like the table it renders as. */
function row(you: VisibilityCell, relayer: VisibilityCell, everyone: VisibilityCell, auditor: VisibilityCell): CellRow {
  return { you, relayer, everyone, auditor }
}

const BASELINE_IP = row(SEES, SEES, HIDDEN, HIDDEN)
const ALL_SEE = row(SEES, SEES, SEES, SEES)
const NONE = row(ABSENT, ABSENT, ABSENT, ABSENT)

export const MATRICES = {
  // The baseline: everything true of any relayed pool transaction, and nothing else.
  'pool-send': {
    authored: true,
    context: 'pool-send',
    cells: {
      amount: row(SEES, HIDDEN, HIDDEN, SEES),
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: row(SEES, HIDDEN, HIDDEN, SEES),
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // No relayer in this path at all; `send.ts`'s disclosure says the sender goes on it.
  'self-submit': {
    authored: true,
    context: 'self-submit',
    cells: {
      amount: row(SEES, ABSENT, HIDDEN, SEES),
      sender: row(SEES, ABSENT, SEES, SEES),
      recipient: row(SEES, ABSENT, HIDDEN, SEES),
      timing: row(SEES, ABSENT, SEES, SEES),
      ip: row(SEES, conditional(SELF_SUBMIT_NODE_SEES), HIDDEN, HIDDEN),
    },
  },
  // Public by construction (`get_public_key` is a free view), and it moves no value.
  registration: {
    authored: true,
    context: 'registration',
    cells: { amount: NONE, sender: ALL_SEE, recipient: NONE, timing: ALL_SEE, ip: BASELINE_IP },
  },
  // FR-021: the relay sees who-talks-to-whom; a payment inside a room travels the same relay.
  'chat-payment': {
    authored: true,
    context: 'chat-payment',
    cells: {
      amount: row(SEES, HIDDEN, HIDDEN, SEES),
      sender: row(SEES, SEES, HIDDEN, SEES),
      recipient: row(SEES, SEES, HIDDEN, SEES),
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // EXPERIENCE §S1.4: both amounts, both tokens and the timing are on-chain; the owner is not.
  swap: {
    authored: true,
    context: 'swap',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: NONE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // 09-bridge §4: hides which note funded it; not the amount, destination, chain or timing.
  'bridge-exit': {
    authored: true,
    context: 'bridge-exit',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: ALL_SEE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // FR-009 verbatim — the one cell that carries its own qualifier.
  'markets-bet': {
    authored: true,
    context: 'markets-bet',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, conditional(MARKETS_BET_COMPANY), SEES),
      recipient: NONE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  'markets-exit': { authored: false, context: 'markets-exit', because: MARKETS_EXIT_UNAUTHORED },
  // FR-049: identity hidden, amount not; fixed denominations hide which one is you.
  'launch-buy': {
    authored: true,
    context: 'launch-buy',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, conditional(LAUNCH_BUY_COMPANY), SEES),
      recipient: NONE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  'launch-sell': { authored: false, context: 'launch-sell', because: LAUNCH_SELL_UNAUTHORED },
  // The Houses (docs/governance.md §4.2): weight public, choice sealed, no address on the ballot.
  'gov-ballot': {
    authored: true,
    context: 'gov-ballot',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, conditional(GOV_BALLOT_SEALED), SEES),
      recipient: ALL_SEE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // A join moves no value at all — the zero-value ComputeAndInvoke.
  'gov-join': {
    authored: true,
    context: 'gov-join',
    cells: {
      amount: NONE,
      sender: row(SEES, HIDDEN, conditional(GOV_JOIN_COUNT_ONLY), SEES),
      recipient: ALL_SEE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  'gov-delegate': {
    authored: true,
    context: 'gov-delegate',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, conditional(GOV_DELEGATE_SOURCE), SEES),
      recipient: ALL_SEE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  'gov-fund': {
    authored: true,
    context: 'gov-fund',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: ALL_SEE,
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
  // The claim is a bearer secret: whoever presents it is nobody in particular.
  'gov-reclaim': {
    authored: true,
    context: 'gov-reclaim',
    cells: {
      amount: ALL_SEE,
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: row(SEES, HIDDEN, HIDDEN, SEES),
      timing: ALL_SEE,
      ip: BASELINE_IP,
    },
  },
} as const satisfies Record<VisibilityContext, VisibilityMatrix>
