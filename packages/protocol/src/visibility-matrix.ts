//
// The visibility matrix (story 6.7, DESIGN §7.5 part 2, EXPERIENCE §4.3, FR-058).
//
// Columns You / Relayer / Everyone / Auditor, rows amount / sender / recipient / timing / IP. The
// rows and the columns were authored a year before this file existed; NOT ONE OF ITS CELL VALUES
// WAS. Story 6.6 hit that and refused to hand-author a copy on the receipt page rather than guess —
// `activity.$id.tsx` carried the refusal in a comment. This module is where the guessing stops: one
// table, three consumers (the `<Disclosure>` panel, the receipt, and `docs/privacy.md`), and no
// fourth place where a privacy claim can be typed.
//
// ── THIS MODULE IMPORTS NOTHING, AND THAT IS A HARD CONSTRAINT ────────────────────────────
//
// `scripts/render-privacy-matrix.mjs` loads this file with plain `node` under type stripping, the
// way `render-topology.mjs:16-18` loads its three. Node's type stripping does NOT rewrite a `.js`
// specifier onto a `.ts` file — measured, it throws ERR_MODULE_NOT_FOUND — so a single relative
// import here would break the generator and, through it, `pnpm run build:web`. That is why the cell
// notes and the unauthored reasons are written in this file rather than in `disclosure-copy.ts`
// beside the panel's sentences: the copy module is a sibling leaf the generator imports separately,
// not something this one can reach.
//
// ── WHY A CONDITIONAL CELL CANNOT EXIST WITHOUT ITS CONDITION ─────────────────────────────
//
// The riskiest cell in a visibility matrix is not `sees` and it is not `hidden` — it is the one
// that is USUALLY hidden. FR-009 (EXPERIENCE §M1.4, verbatim) says a bet's owner is hidden "as long
// as your denomination has company; if you are the only one at this size, your bet is
// identifiable." Rendered as a plain hidden dot that is a false guarantee, and the substring sweep
// in `forbidden-claims.ts` cannot see it, because the sentence carrying the lie is one nobody
// wrote. So the union carries the qualifier STRUCTURALLY: there is no way to spell a conditional
// cell without also saying what the condition is, exactly as `ActivityFee` has no zero variant in
// it. The type does the remembering.
//
// ── AND WHY UNAUTHORED IS A VALUE RATHER THAN AN ABSENCE ──────────────────────────────────
//
// Two of the ten review contexts have no disclosure prose anywhere: the Markets early exit
// (EXPERIENCE §M2.3 drafts it under `[ASSUMPTION]`, gap G4 sends it to an FR-051 hand review) and
// the Launch sell (EXPERIENCE §L6 — "all sell-side microcopy ... unwritten"). Omitting them would
// make `matrixFor` return `undefined` and let a surface render an empty grid, which reads as "we
// checked and there is nothing to see". They are declared instead, with the sentence that says why,
// so the only thing a surface can do with them is print the reason.
//

// ── The two axes, ordered ─────────────────────────────────────────────────────────────────

/**
 * The four columns, in DESIGN §7.5's order. The Auditor column is permanent and honest (§5.5).
 *
 * ORDER IS PART OF THE CONTRACT. `docs/privacy.md` and the React table both iterate this array, so
 * they render the same matrix or they are not rendering the same matrix. A component that spelled
 * its own column order would be a second source of truth wearing a different shape.
 */
export const VISIBILITY_ACTORS = ['you', 'relayer', 'everyone', 'auditor'] as const

export type VisibilityActor = (typeof VISIBILITY_ACTORS)[number]

/** The five rows, in DESIGN §7.5's order. Same contract as the columns. */
export const VISIBILITY_FACTS = ['amount', 'sender', 'recipient', 'timing', 'ip'] as const

export type VisibilityFact = (typeof VISIBILITY_FACTS)[number]

export const ACTOR_LABELS = {
  you: 'You',
  relayer: 'Relayer',
  everyone: 'Everyone',
  auditor: 'Auditor',
} as const satisfies Record<VisibilityActor, string>

export const FACT_LABELS = {
  amount: 'Amount',
  sender: 'Sender',
  recipient: 'Recipient',
  timing: 'Timing',
  ip: 'Network address',
} as const satisfies Record<VisibilityFact, string>

// ── One cell ──────────────────────────────────────────────────────────────────────────────

/**
 * What one party can learn about one fact.
 *
 * `note` is non-optional on exactly the arm that needs it. Four states rather than three because
 * "there is nothing here" and "there is something here and it is hidden" are opposite claims: a
 * swap has no recipient at all — its output returns to the same shielded account — and rendering
 * that as `hidden` would advertise that we are protecting something that does not exist.
 */
export type VisibilityCell =
  | { readonly state: 'sees' }
  | { readonly state: 'hidden' }
  | { readonly state: 'conditional'; readonly note: string }
  | { readonly state: 'absent' }

export type VisibilityCellState = VisibilityCell['state']

/**
 * The word each state carries. THE WORD IS A CHANNEL, not a tooltip.
 *
 * DESIGN §2.3's ratified finding is that under red-green colour blindness `settled` and
 * `irreversible` collapse toward each other at ΔE 9.26–11.90, which makes the icon-and-word rule
 * "load-bearing and must be enforced in code with a test". A twenty-cell grid with nothing but hue
 * between its cells is the densest possible place to break that rule, so every cell renders its
 * word for assistive technology and its shape for everyone else, and colour is the third channel.
 */
export const CELL_LABEL = {
  sees: 'Sees',
  hidden: 'Hidden',
  conditional: 'Conditional',
  absent: 'Not applicable',
} as const satisfies Record<VisibilityCellState, string>

/**
 * The NON-COLOUR channel each state carries, named so the legend in `docs/privacy.md` and the
 * stylesheet cannot describe different encodings.
 *
 * Fill · hollow · half · dash survives greyscale, survives every form of colour vision deficiency,
 * and survives a screenshot in a slide deck. `.visibility-dot[data-state]` is built to match, and
 * `disclosureProblems` in the build gate resolves those rules to numbers rather than trusting them.
 */
export const CELL_ENCODING = {
  sees: 'filled',
  hidden: 'hollow',
  conditional: 'half filled',
  absent: 'a dash',
} as const satisfies Record<VisibilityCellState, string>

/**
 * What each state actually claims, in a sentence.
 *
 * Here rather than in the generator that prints the legend, for the rule this whole module exists
 * to keep: a privacy claim is authored in exactly one file. A legend written in `.mjs` would be a
 * second place where "hidden" is defined, and the day the two disagree the document is the one
 * people believe.
 */
export const CELL_MEANING = {
  sees: 'This party can read it.',
  hidden: 'This party cannot read it.',
  //
  // DELIBERATELY WIDER THAN "IT DEPENDS ON A CONDITION". The arm carries two shapes of qualifier
  // and both are real: a claim that holds only while some condition does (a bet with company at its
  // denomination), and a claim that is true of this party while a DIFFERENT party sees it anyway
  // (no relayer carries a self-submitted transaction, but a node still does). Narrowing the meaning
  // to the first would make the second read as an unqualified "no", which is the overclaim the arm
  // exists to prevent.
  //
  conditional: 'Not a plain yes or no — the qualifier is printed with the table, and it is part of the claim.',
  absent: 'This action has no such fact, so there is nothing here to read and nothing being hidden.',
} as const satisfies Record<VisibilityCellState, string>

/** The four states in the order the legend prints them. Derived, so it cannot fall out of step. */
export const VISIBILITY_CELL_STATES = Object.keys(CELL_LABEL) as readonly VisibilityCellState[]

const SEES: VisibilityCell = { state: 'sees' }
const HIDDEN: VisibilityCell = { state: 'hidden' }
const ABSENT: VisibilityCell = { state: 'absent' }

/** The only way to build the qualified cell, and it cannot be built without its qualifier. */
function conditional(note: string): VisibilityCell {
  return { state: 'conditional', note }
}

type CellRow = Readonly<Record<VisibilityActor, VisibilityCell>>

/** Positional, in `VISIBILITY_ACTORS` order, so a row reads like the table it renders as. */
function row(you: VisibilityCell, relayer: VisibilityCell, everyone: VisibilityCell, auditor: VisibilityCell): CellRow {
  return { you, relayer, everyone, auditor }
}

// ── The review contexts ───────────────────────────────────────────────────────────────────

/**
 * Every action in this product that reaches a Review screen. Ten, closed.
 *
 * `pool-send` is also the BASELINE: it is what is true of any pool transaction, and it is what a
 * receipt falls back to for a row this browser did not originate. Story 6.6 made
 * `Transaction.surface` `null` on every reconstructed row precisely so a Global row could not wear
 * a `Swap` tag; that decision propagates here, and the baseline is the honest thing to render when
 * the chain cannot say which surface an action came from.
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
} as const satisfies Record<VisibilityContext, string>

/**
 * Which mode of the app each review context belongs to.
 *
 * The values are the six `ActivitySurface` members and they are written as plain strings because
 * this module imports nothing — `apps/web/src/route-contract.ts` pins them against
 * `ActivitySurface` in both directions, which is the same device that file already uses to make the
 * duplicated `Mode` list safe.
 */
export const CONTEXT_SURFACE = {
  'pool-send': 'wallet',
  'self-submit': 'wallet',
  registration: 'wallet',
  'chat-payment': 'chat',
  swap: 'swap',
  'bridge-exit': 'bridge',
  'markets-bet': 'markets',
  'markets-exit': 'markets',
  'launch-buy': 'launch',
  'launch-sell': 'launch',
} as const satisfies Record<VisibilityContext, string>

/**
 * The inverse, and it is NOT derivable from the map above — three surfaces name two contexts each,
 * so the reverse relation needs a decision about which one a bare surface means.
 *
 * A receipt has a surface and no finer detail, so each surface resolves to the action that surface
 * ordinarily performs. Wallet resolves to `pool-send` rather than `self-submit` for the same reason
 * `degradedFromHealth` defaults to the retryable state: the relayed path is the default one, and
 * claiming a user's own address was published when it was not is the worse of the two mistakes.
 */
export const SURFACE_CONTEXT = {
  wallet: 'pool-send',
  chat: 'chat-payment',
  swap: 'swap',
  bridge: 'bridge-exit',
  markets: 'markets-bet',
  launch: 'launch-buy',
} as const satisfies Record<string, VisibilityContext>

// ── The notes, and the two refusals ───────────────────────────────────────────────────────

/**
 * FR-009, verbatim (EXPERIENCE §M1.4). The condition IS the honesty.
 *
 * Byte-exact from the requirement rather than paraphrased: the clause after the semicolon is the
 * whole reason this cell is not a plain hidden dot, and a paraphrase would be a new privacy claim
 * written by whoever paraphrased it.
 */
const MARKETS_BET_COMPANY =
  'Who bet is hidden — as long as your denomination has company; if you are the only one at this ' +
  'size, your bet is identifiable.'

/**
 * FR-049 / the launch brief §7.2, with the live count taken out.
 *
 * The sourced sentence names a number ("the other {N} 100-USDC buys"), and EXPERIENCE §3 rule 7
 * requires those to be live exact integers. A matrix cell cannot carry a live read, so the note
 * states the CONDITION and the crowd number stays where it can be true: on screen, beside the
 * denomination picker.
 */
/**
 * ONE SENTENCE, TWO HOMES, PINNED BYTE-EXACT.
 *
 * This is also `disclosure-copy.ts`'s `LAUNCH_CROWD`, and it has to be — the panel states the
 * condition as a line and the matrix carries it as the qualifier on the same claim. The two modules
 * cannot import each other (both are loaded by `render-privacy-matrix.mjs` under plain Node, which
 * does not follow a `.js` specifier onto a `.ts` file), so `test/disclosure.test.ts` asserts them
 * equal with `toBe` and `footnoteText` stops the renderers printing it twice on one screen.
 *
 * NEAR-DUPLICATES ARE THE FAILURE, NOT EXACT ONES. Two sentences that differ by a word are two
 * privacy claims nobody decided to make differently; an identical pair with an assertion over it is
 * one claim with a mechanism keeping it that way.
 *
 * The mechanism clause the launch brief pairs with this ("fixed denominations hide which one is
 * you") is not repeated here: it is already in the headline, which renders directly above.
 */
const LAUNCH_BUY_COMPANY =
  'Your buy looks identical to the other buys at the same size in this launch. If yours is the ' +
  'only one at that size, you are alone.'

/**
 * Self-submission's network cell, and it is `conditional` rather than `absent` for one reason.
 *
 * `absent` on the Relayer column would be TRUE about the relayer and FALSE as a picture: it renders
 * as "nobody on the network sees you", when the honest fact is that the observer moved rather than
 * disappeared. `send.ts`'s own disclosure says the wallet submits it, and `activity-copy.ts`'s
 * `DISCOVERY_RPC_HOST_SEES` names what the node on the other end of that submission gets. Naming
 * the node here is transcription, not invention — the columns are authored and may not grow a
 * fifth, so the qualifier is where the second observer has to appear.
 */
const SELF_SUBMIT_NODE_SEES =
  'No relayer carries this, so nothing about it reaches us — but your wallet still hands the ' +
  'transaction to a Starknet node, and that node sees the request and the network address it came ' +
  'from.'

//
// AND IT IS `disclosure-copy.ts`'s `SELF_SUBMIT_NO_RELAYER`, byte for byte, for `LAUNCH_BUY_COMPANY`'s
// reason: the panel states it as a line and the matrix carries it as the qualifier on the same
// claim. Pinned in `test/disclosure.test.ts`; deduped on render by `footnoteText`.
//

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

// ── The matrices ──────────────────────────────────────────────────────────────────────────

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

/**
 * EVERY CELL BELOW IS A PRIVACY CLAIM, and each one traces to a sentence in the planning documents.
 * The three that recur, stated once here rather than on twenty cells:
 *
 *   THE RELAYER CANNOT READ NOTES. `register.ts`'s sanctioned sentence — "The pool sees this
 *   transaction, not your notes." — is the ceiling on what a relayed submission exposes, and it is
 *   the only relayer claim allowed until it is proven on mainnet (FR-051). What the relayer DOES
 *   get is the network address the request came from and the moment it arrived, which is why the
 *   `ip` and `timing` rows are the two where it sees.
 *
 *   THE AUDITOR SEES WHATEVER THE VIEWING KEY SEES. `get_enc_private_key` is permissionless and
 *   StarkWare's auditor holds an escrowed copy, so every fact that lives inside a note is legible
 *   to it. It is not a network party, so it does not see a network address — the one cell in that
 *   column that is `hidden` rather than `sees`.
 *
 *   `absent` IS NOT `hidden`. A registration moves no tokens, so there is no amount to protect; a
 *   swap's output returns to the same shielded account, so there is no recipient. Painting those
 *   cells as hidden would claim we are protecting something that does not exist, which is the same
 *   class of overclaim as a fabricated zero in a fee column.
 */
export const MATRICES = {
  //
  // THE BASELINE. Everything true of any relayed pool transaction, and nothing else — this is what
  // a receipt renders when the chain cannot say which surface an action came from.
  //
  'pool-send': {
    authored: true,
    context: 'pool-send',
    cells: {
      amount: row(SEES, HIDDEN, HIDDEN, SEES),
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: row(SEES, HIDDEN, HIDDEN, SEES),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  //
  // The same send with the relayer taken out of it. TWO changes, and they pull in opposite
  // directions: the relayer column becomes `absent` because there is no relayer in this path at
  // all, and `sender` becomes public because `send.ts`'s own disclosure says so — "Submitting it
  // yourself puts your own address on it as the sender."
  //
  'self-submit': {
    authored: true,
    context: 'self-submit',
    cells: {
      amount: row(SEES, ABSENT, HIDDEN, SEES),
      sender: row(SEES, ABSENT, SEES, SEES),
      recipient: row(SEES, ABSENT, HIDDEN, SEES),
      timing: row(SEES, ABSENT, SEES, SEES),
      // NOT `absent`. See `SELF_SUBMIT_NODE_SEES` — the observer moved, it did not disappear.
      ip: row(SEES, conditional(SELF_SUBMIT_NODE_SEES), HIDDEN, HIDDEN),
    },
  },

  //
  // Registration is public by construction: the pool stores a key against an account address and
  // `get_public_key(address)` is a free view anyone can call. It moves no value, which is why two
  // whole rows are `absent` rather than hidden.
  //
  registration: {
    authored: true,
    context: 'registration',
    cells: {
      amount: row(ABSENT, ABSENT, ABSENT, ABSENT),
      sender: row(SEES, SEES, SEES, SEES),
      recipient: row(ABSENT, ABSENT, ABSENT, ABSENT),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  //
  // The one context where the relayer sees MORE than it does anywhere else, and saying so is the
  // point. FR-021: the relay we run "sees who-talks-to-whom, when, how often, sizes, IPs — content
  // stays ciphertext". A payment made inside a room travels the same relay, so the social graph is
  // ours whether or not the value is.
  //
  'chat-payment': {
    authored: true,
    context: 'chat-payment',
    cells: {
      amount: row(SEES, HIDDEN, HIDDEN, SEES),
      sender: row(SEES, SEES, HIDDEN, SEES),
      recipient: row(SEES, SEES, HIDDEN, SEES),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  //
  // EXPERIENCE §S1.4, block headline: "Visible on-chain: both amounts, both tokens, the timing.
  // Hidden: which account owns them." The relayer row's `amount` is `sees` for a second, separate
  // reason (FR-029): the quote is fetched through our relay, so the pair and the amount pass
  // through it on the way to the aggregator.
  //
  swap: {
    authored: true,
    context: 'swap',
    cells: {
      amount: row(SEES, SEES, SEES, SEES),
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: row(ABSENT, ABSENT, ABSENT, ABSENT),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  //
  // The bridge's mandatory phrasing (09-bridge §4), transcribed as cells: "The crossing hides which
  // shielded note funded the withdrawal. It does not hide the amount, the destination address, the
  // destination chain, or the timing." So `sender` is the one hidden row and `recipient` — the
  // destination address — is public to everybody including us.
  //
  'bridge-exit': {
    authored: true,
    context: 'bridge-exit',
    cells: {
      amount: row(SEES, SEES, SEES, SEES),
      sender: row(SEES, HIDDEN, HIDDEN, SEES),
      recipient: row(SEES, SEES, SEES, SEES),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  //
  // FR-009 verbatim, and the one cell in the whole table that carries its own qualifier.
  //
  'markets-bet': {
    authored: true,
    context: 'markets-bet',
    cells: {
      amount: row(SEES, SEES, SEES, SEES),
      sender: row(SEES, HIDDEN, conditional(MARKETS_BET_COMPANY), SEES),
      recipient: row(ABSENT, ABSENT, ABSENT, ABSENT),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  'markets-exit': {
    authored: false,
    context: 'markets-exit',
    because: MARKETS_EXIT_UNAUTHORED,
  },

  //
  // FR-049: "Your identity is hidden. Your amount is not. Every buy is a plaintext event; the pool
  // hides who, and fixed denominations hide which one is you." The last clause is a condition, so
  // the cell that carries it is conditional for the same reason the Markets one is.
  //
  'launch-buy': {
    authored: true,
    context: 'launch-buy',
    cells: {
      amount: row(SEES, SEES, SEES, SEES),
      sender: row(SEES, HIDDEN, conditional(LAUNCH_BUY_COMPANY), SEES),
      recipient: row(ABSENT, ABSENT, ABSENT, ABSENT),
      timing: row(SEES, SEES, SEES, SEES),
      ip: row(SEES, SEES, HIDDEN, HIDDEN),
    },
  },

  'launch-sell': {
    authored: false,
    context: 'launch-sell',
    because: LAUNCH_SELL_UNAUTHORED,
  },
} as const satisfies Record<VisibilityContext, VisibilityMatrix>

/**
 * The matrix for one context. NEVER `undefined`, and never a partially-filled grid.
 *
 * The `satisfies` above is what makes that true rather than hoped for: a context added to
 * `VISIBILITY_CONTEXTS` with no entry here is TS1360 at the table, not a runtime `undefined` at
 * whichever surface asked for it first.
 */
export function matrixFor(context: VisibilityContext): VisibilityMatrix {
  return MATRICES[context]
}

/**
 * Which matrix a RECEIPT shows, given the only thing a receipt knows.
 *
 * `Transaction.surface` is `null` on every reconstructed row — 6.6 made it so, because a Global row
 * wearing a `Swap` tag would falsify the feed header printed three inches above it. So the fallback
 * is not an error branch: a row this browser did not originate can only honestly render what is true
 * of ANY pool transaction, and `pool-send` is that baseline.
 *
 * THIS LIVES HERE RATHER THAN IN THE ROUTE, and the reason is 6.6's fifth review finding repeated
 * back at us: `vitest.config.ts:12` collects test files under this package only, so a ternary typed
 * into `activity.$id.tsx` is a privacy decision no runner executes. Flipping the fallback to
 * `self-submit` in one word would make every reconstructed receipt claim the user's own address was
 * published, with every gate still green. The same shape of finding as `receiptFor`, and the same
 * fix.
 *
 * The parameter is keyed off `SURFACE_CONTEXT` rather than importing `ActivitySurface`, because this
 * module imports nothing — `render-privacy-matrix.mjs` loads it under Node type stripping, which
 * cannot resolve a `.js` specifier onto a `.ts` file. `route-contract.ts:145-146` pins the two
 * vocabularies together in both directions, which is what makes the duplication safe.
 */
export function receiptContext(surface: keyof typeof SURFACE_CONTEXT | null): VisibilityContext {
  return surface === null ? 'pool-send' : SURFACE_CONTEXT[surface]
}

// ── How a cell reaches a reader ───────────────────────────────────────────────────────────

/**
 * What a cell says out loud — the WORD, plus the qualifier when it has one.
 *
 * ── WHY THIS IS A FUNCTION IN THIS MODULE AND NOT A TERNARY IN A COMPONENT ────────────────
 *
 * It was a ternary in `VisibilityMatrix.tsx`, and that made the qualifier the one part of the
 * matrix reachable only through code no runner executes. Collapsing it to `CELL_LABEL[cell.state]`
 * is a one-word edit: `markets-bet` then announces "Conditional" with its condition nowhere on
 * screen, and the whole suite plus `build:web` stay green. That is precisely the false guarantee the
 * discriminated union was built to make unspellable — the type carried the note all the way to the
 * component and the component quietly dropped it.
 *
 * So the union's promise is kept where it can be asserted: over every authored context, in
 * `test/visibility-matrix.test.ts`.
 */
export function cellAnnouncement(cell: VisibilityCell): string {
  const word = CELL_LABEL[cell.state]
  return cell.state === 'conditional' ? `${word} — ${cell.note}` : word
}

/**
 * Every distinct qualifier in a matrix, in row-then-column order.
 *
 * ONE NUMBERING, TWO CONSUMERS. The React table and `docs/privacy.md` both footnote conditional
 * cells, and both used to derive the numbering themselves — a `Set` walk in the component and a
 * closure in the generator — agreeing only because they happened to iterate in the same order, with
 * nothing pinning them. The day one of them iterated columns first, the doc's footnote 1 and the
 * app's footnote 1 became different sentences and nothing failed.
 */
export function matrixNotes(matrix: AuthoredMatrix): readonly string[] {
  const notes: string[] = []
  for (const fact of VISIBILITY_FACTS) {
    for (const actor of VISIBILITY_ACTORS) {
      const cell = matrix.cells[fact][actor]
      if (cell.state === 'conditional' && !notes.includes(cell.note)) notes.push(cell.note)
    }
  }
  return notes
}

/** The 1-based footnote number for a qualifier, or `null` when the cell carries none. */
export function noteNumber(notes: readonly string[], cell: VisibilityCell): number | null {
  if (cell.state !== 'conditional') return null
  const at = notes.indexOf(cell.note)
  return at < 0 ? null : at + 1
}

/**
 * What a footnote prints when the prose above the table already says it.
 *
 * The headline of a Markets review IS FR-009 in full, and FR-009's second clause is the qualifier on
 * the sender cell — so the panel and the generated page both printed the same twenty-seven words
 * twice, four lines apart. That is the drift this story exists to prevent arriving as redundancy
 * rather than as disagreement, and the reader who meets it stops reading footnotes.
 */
export const NOTE_STATED_ABOVE = 'Stated in full in the line above this table.'

/**
 * A footnote's text, given whatever prose is rendered directly above the table.
 *
 * Pass `''` where there is none — the receipt renders the matrix with no headline over it, and
 * there the note has to print in full or the qualifier is nowhere at all.
 */
export function footnoteText(note: string, statedAbove: string): string {
  return statedAbove.includes(note) ? NOTE_STATED_ABOVE : note
}

// ── The delta, for the trust-boundary modal (6.8) ─────────────────────────────────────────

export interface MatrixChange {
  readonly fact: VisibilityFact
  readonly actor: VisibilityActor
  readonly from: VisibilityCell
  readonly to: VisibilityCell
}

function sameCell(a: VisibilityCell, b: VisibilityCell): boolean {
  if (a.state !== b.state) return false
  // The note is part of the cell's meaning: two conditional cells qualified differently are two
  // different claims, and a delta that called them equal would hide the change that matters most.
  return a.state !== 'conditional' || b.state !== 'conditional' || a.note === b.note
}

function unauthoredDiff(
  from: VisibilityContext,
  to: VisibilityContext,
  side: UnauthoredMatrix,
): Error {
  return new Error(
    `refusing to diff \`${from}\` against \`${to}\`: \`${side.context}\` has no authored matrix, ` +
      `so the difference between them is unknown rather than empty. ${side.because}`,
  )
}

/**
 * Only the cells that change between two contexts.
 *
 * The trust-boundary modal (story 6.8) shows a user what crossing a boundary costs them, and the
 * honest answer is the difference rather than the whole grid again — twenty cells, eighteen of them
 * identical, is a picture that hides the two that moved.
 *
 * THROWS ON AN UNAUTHORED CONTEXT rather than returning an empty delta. "Nothing changed" and "one
 * side of this comparison was never written" are opposite claims, and an empty array is how the
 * second silently becomes the first.
 */
export function matrixDelta(from: VisibilityContext, to: VisibilityContext): MatrixChange[] {
  const before = matrixFor(from)
  const after = matrixFor(to)
  // Two statements rather than a loop, because the loop cannot narrow: TypeScript would still see
  // `before` as the union afterwards and the function would need an unreachable `return []` to
  // compile — a branch that contradicts this function's whole contract sitting in its body.
  if (!before.authored) throw unauthoredDiff(from, to, before)
  if (!after.authored) throw unauthoredDiff(from, to, after)

  const changes: MatrixChange[] = []
  for (const fact of VISIBILITY_FACTS) {
    for (const actor of VISIBILITY_ACTORS) {
      const a = before.cells[fact][actor]
      const b = after.cells[fact][actor]
      if (!sameCell(a, b)) changes.push({ fact, actor, from: a, to: b })
    }
  }
  return changes
}
