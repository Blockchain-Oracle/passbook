//
// Every user-facing sentence the book ships (FR-011a, story 1.9 AC5).
//
// One const per sentence, exported, `toBe`-asserted in `test/activity-copy.test.ts`, and
// imported by epic 6 rather than retyped into it. The reason is drift: the sentence about what
// the RPC host can see appears on the balance tile, the feed header and the disclosure panel,
// and three hand-typed copies of a claim about observability will not survive a redesign
// identical. `backup-copy.ts` is the same file for the same reason.
//
// ── THE LINT TRAP, AND WHY IT BITES HARDEST HERE ─────────────────────────────────────────
//
// Ten bare claim substrings are forbidden in user-facing copy, line-based over whole
// files, comments included. THREE of them are the hyphenated capability words for "can see but
// cannot spend" — which is precisely the concept an export disclosure and a visibility matrix
// reach for first. The export in this story exists because that capability does not exist on
// this protocol: the key that reads notes is the key that signs spends, so there is no lesser
// credential to hand a bookkeeper, and a file is the honest replacement for one.
//
// So the sentences below say what the file DOES and what the key WOULD do, and never name the
// capability. That is a rewording, not a loophole: the lint is protecting a real prohibition
// (spec §11), and the fix for a surface that wants the banned phrase is always to reword.
//

// ── The standing line (AC5) ───────────────────────────────────────────────────────────────

/**
 * The feed header's standing line, in its AMENDED form.
 *
 * The original claim — that nobody can join the six surfaces up — is false on this protocol
 * and would be falsifiable by a judge in one call: the auditor holds an escrowed copy of every
 * viewing key, and the relayer sees each submission it carries. What IS true is the narrower
 * claim, so the narrower claim is what ships, with the two parties who see more named in the
 * same sentence rather than in a footnote under it.
 *
 * The second half is not filler either. "Assembled in your browser" is the fact that makes the
 * first half hold: the cross-surface account view is a client-side reconstruction (AD-6) and
 * never an on-chain link, so there is nothing on the chain for another user to follow.
 */
export const SURFACES_STANDING_LINE =
  'Your six surfaces are unlinkable to other users — this view is assembled in your browser, ' +
  'not stored on-chain. The auditor and the relayer see more.'

// ── Discovery honesty: what reading your own notes exposes (AC5) ──────────────────────────

/**
 * What the RPC host observes while the book is being read.
 *
 * Stated because it is the one leak this design chose to keep. Walking the pool from the
 * browser means the viewing key stays here; it also means a third-party RPC host sees the
 * requests, and browser-direct Starknet RPC is already a disclosed `PROXY_EXCEPTIONS` entry
 * rather than something this sentence is confessing for the first time.
 *
 * "Which parts of the pool" rather than "your notes": the host sees storage addresses — channel
 * slots and note ids — and not their contents, and overstating that in either direction would
 * be its own inaccuracy.
 */
export const DISCOVERY_RPC_HOST_SEES =
  'Your viewing key stays in this browser. The Starknet node answering these reads sees which ' +
  'parts of the pool this browser asks for, and the network address asking.'

/**
 * The counterpart: what walking the pool directly avoids.
 *
 * The alternative is a hosted discovery service, which requires the viewing key in the clear —
 * OHTTP would hide the network address and not the key. Worth saying plainly, because "we read
 * the chain ourselves" sounds like an implementation detail until it is put next to the thing
 * it replaced.
 */
export const DISCOVERY_NO_KEY_HANDOVER =
  'Nothing here hands your viewing key to a service to read your notes for you.'

// ── Balance states — three sentences that must never be interchangeable (AC2) ─────────────

/**
 * A completed walk over a registered account holding nothing.
 *
 * The point of the wording is that it is not an error and not a warning. An empty account is
 * the ordinary first state of every account that ever existed.
 */
export const BOOK_EMPTY = 'No notes yet. Anything sent to you shows up here.'

/**
 * A completed walk over an address the pool holds no viewing key for.
 *
 * DIFFERENT FROM EMPTY, and the difference is actionable: an unregistered account cannot be
 * sent to at all, so "nothing has arrived" would be a misleading description of a state where
 * nothing COULD arrive. Registration is the fix, and the sentence points at it without
 * becoming a prompt — the gate for that is registration-at-intent's, not the balance tile's.
 */
export const BOOK_NOT_REGISTERED =
  "This account isn't registered on the pool yet, so nothing can have been sent to it."

/**
 * A walk that did not complete.
 *
 * NEVER SHARES A SENTENCE WITH `BOOK_EMPTY`, which is the fail-closed rule stated as copy: an
 * unreachable host and an empty account are the same picture and opposite facts, and a user
 * who reads "no notes yet" during an outage has been told their money is gone.
 */
export const BOOK_UNKNOWN =
  "We couldn't finish reading your notes, so this isn't your balance — it's what we could reach. " +
  'Try again in a moment.'

/**
 * The block-stamp grammar.
 *
 * "About" is not hedging for its own sake. The walk cannot be pinned to a block — the SDK
 * accepts a block identifier and ignores it — so the height is read beside the walk rather
 * than during it, and a stamp reading "as of block N" would claim a precision the read does
 * not have. Takes the number rather than embedding one, because there are no hardcoded
 * runtime numbers anywhere in this product.
 */
export const asOfBlock = (blockNumber: number): string => `as of about block ${blockNumber}`

/**
 * Shown beside a balance small enough to round to zero at display precision.
 *
 * The tile renders the exact figure in subscript notation (epic 6's job); this is the sentence
 * that explains why it looks unusual, so a real balance is never mistaken for a rendering bug.
 */
export const DUST_EXACT_VALUE = 'Shown to the last unit — this balance is smaller than the display rounds to.'

// ── The feed (AC3) ────────────────────────────────────────────────────────────────────────

/** Personal is empty, so the feed shows Global rather than a blank panel. */
export const PERSONAL_FEED_EMPTY =
  'Nothing of yours in this range yet. Showing everything the pool did instead.'

/**
 * The feed reached its page cap before the range ran out.
 *
 * A window is not a history, and a feed that quietly truncated would make "your last
 * transaction" wrong with nothing failing. The cap exists because the browser pays for every
 * page (AD-14); saying so is what makes it a bound rather than a bug.
 */
export const FEED_RANGE_INCOMPLETE =
  'This is a window, not your whole history — there are older entries past the range loaded here.'

/**
 * A row whose transaction receipt we could not read.
 *
 * The alternative everyone reaches for is a zero, and a zero in a fee column is a claim that
 * the transaction was free. This says the true thing instead.
 */
export const FEE_UNREADABLE = "We couldn't read what this transaction was charged."

/**
 * A row for an encrypted note that is not ours.
 *
 * The Global feed shows that a note was created without showing its value, because the value
 * is ciphertext to everyone but the note's owner. Saying so turns a blank cell into a fact.
 */
export const AMOUNT_NOT_OURS_TO_READ = 'Encrypted to its owner. The amount is not in the public record.'

// ── Export (AC4) ──────────────────────────────────────────────────────────────────────────

/**
 * The export disclosure, verbatim and non-negotiable.
 *
 * This is the sentence the whole feature is built around. On this protocol the key that reads
 * an account is the key that spends it — there is no lesser credential that could be handed to
 * an accountant — so the honest product is a file that carries the history and nothing that
 * can move money. The first clause is the warning; the second is the alternative, in the same
 * breath, because a warning with no alternative just gets ignored.
 */
export const EXPORT_KEY_DISCLOSURE =
  'Your Account Key can also spend, so never hand it over. Hand over this file instead.'

/**
 * What the exported file is, said at the top of the file itself.
 *
 * In the CSV's own disclosure block rather than only in the UI, because the file outlives the
 * screen that made it: whoever opens it next did not see the export dialog.
 */
export const EXPORT_FILE_SCOPE =
  'This file lists activity only. It carries no key, and nothing in it can move money.'

/** Says the export never left the machine, which is true: the builder is a pure function. */
export const EXPORT_IN_BROWSER = 'This file was built in your browser. Nothing was uploaded.'

/**
 * Stamped into the export beside the block height.
 *
 * A statement without a range is a statement that claims to be complete, and this one is
 * bounded by whatever range the feed loaded. Takes both numbers rather than carrying any.
 */
export const exportRangeLine = (fromBlock: number, toBlock: number): string =>
  `Covers blocks ${fromBlock} to ${toBlock}.`

/** Warns, in the file, that the range did not reach the end of the chain. */
export const EXPORT_RANGE_INCOMPLETE =
  'The range above stopped at a page limit, so older entries exist that are not in this file.'

/**
 * The fee convention, stated in the file because the file outlives the explanation.
 *
 * One pool transaction emits several rows, and the network fee was charged once for all of
 * them. Printing it on every row would give a bookkeeper a column that sums to several times
 * what was actually paid — so it appears once per transaction, and this is the sentence that
 * stops the blanks from looking like missing data.
 */
export const EXPORT_FEE_ONCE_PER_TRANSACTION =
  'Network fees are charged once per transaction, so a fee appears on the first row of each ' +
  'transaction and is blank on the rest. Sum the column as-is.'

/**
 * Points a spreadsheet or a script at whichever half of the file it needs.
 *
 * These first lines are prose, which is right for a person and wrong for `read_csv` — an
 * importer that assumes line 1 is the header will name a column after a sentence. Rather than
 * pick one audience, the builder also returns a preamble-free copy, and this says so.
 */
export const EXPORT_PREAMBLE_NOTE =
  'These opening lines are notes, not data. The table starts at the row headed Block.'
