//
// The history's own sentences — the words the feed says when it groups, categorises, or has
// nothing to show (Wave 1).
//
// ── WHY THE GROUP HEADERS ARE NOT DATES, AND WHY THAT IS NOT A SHORTFALL ─────────────────
//
// Every wallet groups its history by day. This one cannot, and the reason is a fact about the
// data rather than a gap in the build: a pool event carries a BLOCK NUMBER and nothing else.
// `transaction.ts:387` already refuses to render "3 days ago" from a height nobody timed, and
// that refusal is right — a clock time computed from a block count is an invented runtime value,
// which is the class of thing this repository fails builds over.
//
// So the headers group by DISTANCE FROM THE HEAD, in blocks, and they say approximately how far
// that is rather than naming a day. The precedent is `describeSpan`, which already converts a
// block count into "about 3 days" for the window note and is read by users today: a SPAN is a
// measurement, an absolute DATE is a claim about a calendar, and only the first survives having
// no timestamps. `HISTORY_GROUPING_NOTE` states the whole mechanism in one line, in the UI,
// because a reader who thinks these are dates will misread every row under them.
//
// ── AND THE EMPTY STATES ARE PER-TAB, NOT ONE SENTENCE WITH A SHRUG ──────────────────────
//
// `activity-copy.ts` already draws the hardest distinction — unread versus empty versus filtered.
// What it does not do is tell the two TABS apart, so both said "No activity yet". Global empty
// means the pool published nothing in the window; Personal empty means nothing in it was ours.
// Those are different facts about different things, and the second one has an action attached.
//

// ── Group headers ─────────────────────────────────────────────────────────────────────────

/**
 * The line that makes the headers below readable.
 *
 * Without it "About the last day" looks like a date and reads as a promise the data cannot keep.
 */
export const HISTORY_GROUPING_NOTE =
  'The pool publishes block numbers, not clock times, so these groups are block distance from the ' +
  'head — near enough to read at a glance, and never a date we did not measure.'

/** Rows this browser started and the chain has not published yet. */
export const HISTORY_GROUP_IN_PROGRESS = 'In progress'

/** Settled within roughly a day of the block the balance was read beside. */
export const HISTORY_GROUP_RECENT = 'About the last day'

/** Settled inside the read window but older than that. */
export const HISTORY_GROUP_WEEK = 'Earlier this week'

/** Everything further back than the window's usual span. */
export const HISTORY_GROUP_OLDER = 'Older'

// ── Category labels ───────────────────────────────────────────────────────────────────────

/** Value left this account. */
export const CATEGORY_SENT = 'Sent'

/** Value arrived. */
export const CATEGORY_RECEIVED = 'Received'

/** Public money crossing into the pool. Visible on chain, and the label does not hide it. */
export const CATEGORY_DEPOSIT = 'Deposit'

/** Value leaving the pool to a public address. */
export const CATEGORY_WITHDRAWAL = 'Withdrawal'

/** The write-once viewing-key write. */
export const CATEGORY_REGISTRATION = 'Registration'

/** A swap this browser submitted. Only ever set from our own submission — never inferred. */
export const CATEGORY_SWAP = 'Swap'

/** A bridge exit this browser submitted. */
export const CATEGORY_BRIDGE = 'Bridge'

/** A payment sent inside a chat room. */
export const CATEGORY_MESSAGE = 'Message'

/** The 1-wei companion every message-only pool transaction carries. Structure, not anomaly. */
export const CATEGORY_SYSTEM = 'System note'

/** The chain published a note movement we cannot attribute further than that. */
export const CATEGORY_NOTE = 'Note'

// ── Empty states, one per tab ─────────────────────────────────────────────────────────────

/**
 * Global, read, and genuinely nothing in it.
 *
 * A claim about the WINDOW rather than about the pool, because the read is a window — saying "the
 * pool is empty" would be a claim about blocks nobody looked at.
 */
export const HISTORY_GLOBAL_EMPTY =
  'Nothing was published to the pool in the blocks this read covers. That is a quiet window, not ' +
  'an empty pool.'

/** Personal, read, and nothing in it was ours. Carries the action, because there is one. */
export const HISTORY_PERSONAL_EMPTY =
  'None of the transactions in this window are yours. Receive something, or make your first ' +
  'send, and it appears here.'

/** Every row hidden by the system-note filter. */
export const HISTORY_FILTERED_EMPTY =
  'Every row in this window is a system note, and the filter is hiding them. Turn it back on to ' +
  'see them.'

// ── Amount grammar ────────────────────────────────────────────────────────────────────────

/**
 * What an unreadable amount says.
 *
 * An encrypted note publishes ciphertext, so most Global rows have no number at all — and a zero
 * there would be a claim that nothing moved. The em dash is the app-wide "we do not know" mark.
 */
export const AMOUNT_UNREADABLE = '—'

/** The tooltip behind that dash, for the reader who wonders whether it is a bug. */
export const AMOUNT_UNREADABLE_WHY =
  'This note’s amount is encrypted to its owner, so the pool does not publish a number for it.'
