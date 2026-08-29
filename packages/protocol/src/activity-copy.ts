//
// Every user-facing sentence the activity book ships. One const per sentence, imported rather
// than retyped, so a claim about observability cannot drift between the surfaces that show it.
//
// The forbidden-claim words for "can see but cannot spend" are exactly what an activity view
// reaches for first; on this protocol the key that reads notes is the key that spends them, so the
// sentences say what a thing DOES and never name the capability.
//

// ── Balance states — three sentences that must never be interchangeable ───────────────────

/** A completed walk over a registered account holding nothing. Not an error, not a warning. */
export const BOOK_EMPTY = 'No notes yet. Anything sent to you shows up here.'

/**
 * A completed walk over an address the pool holds no viewing key for. Different from empty and
 * actionable: nothing COULD have arrived. Points at registration without becoming a prompt.
 */
export const BOOK_NOT_REGISTERED =
  "This account isn't registered on the pool yet, so nothing can have been sent to it."

/**
 * A walk that did not complete. Never shares a sentence with `BOOK_EMPTY`: an unreachable host and
 * an empty account are the same picture and opposite facts.
 */
export const BOOK_UNKNOWN =
  "We couldn't finish reading your notes, so this isn't your balance — it's what we could reach. " +
  'Try again in a moment.'

/**
 * The block-stamp grammar. "About" because the SDK ignores the block identifier on a walk, so the
 * height is read beside the walk rather than during it.
 */
export const asOfBlock = (blockNumber: number): string => `as of about block ${blockNumber}`

// ── The feed ──────────────────────────────────────────────────────────────────────────────

/** Personal is empty, so the feed shows Global rather than a blank panel. */
export const PERSONAL_FEED_EMPTY =
  'Nothing of yours in this range yet. Showing everything the pool did instead.'

/** A completed read that found nothing. "As they confirm" says the list records settled facts. */
export const ACTIVITY_EMPTY_NOTHING = 'No activity yet. Actions you take appear here as they confirm.'

/**
 * No read has run. Not the sentence above: `No activity yet` is a claim about the chain, and before
 * a read has run we have not looked.
 */
export const FEED_UNREAD = "The pool hasn't been read yet — this list is unread, not empty."

/**
 * The 1-wei companion, labelled as structure rather than anomaly: every message-only pool
 * transaction must write a write-once slot, so a message costs a note whether or not it moves value.
 */
export const SYSTEM_NOTE_LABEL = 'System note — the pool requires one per message-only transaction.'

/**
 * A submitted row the chain has not published yet, past the patience bound. Two parts because the
 * second is a link. The row never vanishes on this state.
 */
export const NOT_YET_INDEXED = 'Submitted, not yet indexed'

/** The anchor text for the sentence above. Lowercase, because it continues the sentence. */
export const CHECK_ON_VOYAGER = 'check on Voyager'

/** A list the filter emptied — the third way to reach a blank feed, and the third sentence. */
export const FILTERED_ALL_HIDDEN =
  'Everything in this range is a system note, and system notes are hidden.'

/** An id that a completed read did not turn up. "In the range loaded here", never "does not exist". */
export const RECEIPT_NOT_FOUND = "There's no entry with that id in the range loaded here."

/** A row this browser submitted, on a page whose other fields only exist once it has settled. */
export const RECEIPT_NOT_YET_ON_CHAIN =
  'Submitted from this browser. Nothing has been published on chain for it yet.'

/** The receipt's two honest blanks. Neither is an error, and neither is an empty cell. */
export const RECEIPT_NO_COUNTERPARTY = 'Not named in the record.'
export const RECEIPT_NOT_A_NOTE = 'This row is not about a note.'

/** A row whose receipt we could not read. A zero here would claim the transaction was free. */
export const FEE_UNREADABLE = "We couldn't read what this transaction was charged."
