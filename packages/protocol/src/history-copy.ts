//
// The history's own sentences — the words the feed says when it groups rows or cannot read one.
//
// The group headers are block distance from the head, never dates: a pool event carries a block
// number and nothing else, and a clock time computed from a block count would be invented.
//

// ── Group headers ─────────────────────────────────────────────────────────────────────────

/** Rows this browser started and the chain has not published yet. */
export const HISTORY_GROUP_IN_PROGRESS = 'In progress'

/** Settled within roughly a day of the block the balance was read beside. */
export const HISTORY_GROUP_RECENT = 'About the last day'

/** Settled inside the read window but older than that. */
export const HISTORY_GROUP_WEEK = 'Earlier this week'

/** Everything further back than the window's usual span. */
export const HISTORY_GROUP_OLDER = 'Older'

// ── Amount grammar ────────────────────────────────────────────────────────────────────────

/** The tooltip behind the em dash an unreadable amount renders as. */
export const AMOUNT_UNREADABLE_WHY =
  'This note’s amount is encrypted to its owner, so the pool does not publish a number for it.'
