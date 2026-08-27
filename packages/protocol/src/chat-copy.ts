//
// What the chat surface says about itself (Wave 2).
//
// ── THE THREE SENTENCES THE DESIGN SAYS MAY NEVER BE CUT ─────────────────────────────────
//
// A conversation list changes what silence means. Single-thread chat could shrug at the relayer's
// bounded buffer — you opened a thread, you saw what was in it. A sidebar cannot: it shows a
// conversation whose middle is missing and says nothing, and the user reads that as the app losing
// their messages rather than as the design working exactly as documented.
//
// So three facts ship as copy rather than as comments:
//
//   1. LOCAL HISTORY IS THE ONLY HISTORY. Clear site data and it is gone; the relayer's 50-envelope
//      30-minute buffer cannot restore it, because nothing durable was ever written.
//   2. THE MULTIPLEX IS VISIBLE TO THE RELAYER. One socket carrying N rooms tells that host these N
//      conversations share one participant. It could already infer that from N subscribes arriving
//      on one IP at one instant — so this makes explicit what timing already leaked, and pretending
//      the N-stream version was hiding it would be the overclaim.
//   3. A PUBLIC DIRECTORY IS PUBLIC. Claiming a name publishes name→address for anyone to read.
//
// ── AND THE ONE THIS SURFACE HAS ALWAYS OWED ─────────────────────────────────────────────
//
// The room key derives from pool viewing keys, and the auditor holds an escrowed copy of those, so
// the auditor can read any conversation here without asking. `CHAT_AUDITOR_DERIVES` in
// `disclosure-copy.ts` already carries that and the panel already renders it; nothing below
// weakens it, and none of these sentences may imply otherwise.
//

// ── Retention ─────────────────────────────────────────────────────────────────────────────

/**
 * What this browser keeps, and what nobody keeps.
 *
 * The number is not in the sentence on purpose: `CHAT_LOG_BOUND` is the bound and a second copy of
 * it here would be a figure nothing keeps in step. What the sentence has to carry is the SHAPE —
 * local, bounded, and the only copy.
 */
export const CHAT_HISTORY_IS_LOCAL =
  'These conversations live in this browser and nowhere else. Clearing site data deletes them, and ' +
  'nothing can bring them back — the relay keeps a short buffer to reconnect through, not a record.'

/**
 * The gap a conversation list makes visible.
 *
 * Said plainly because the alternative is a user watching a thread with a hole in it and
 * concluding the product is broken. It is the design's own "riskiest assumption", answered in copy.
 */
export const CHAT_OFFLINE_GAP =
  'Anything sent while this browser was closed for more than half an hour is not here — it was ' +
  'never stored anywhere it could be fetched from later.'

// ── The socket ────────────────────────────────────────────────────────────────────────────

/**
 * What one multiplexed socket tells the relayer.
 *
 * NOT PRESENTED AS A COST OF THE NEW DESIGN, because it is not one: N separate subscribes arriving
 * from one address at one instant already grouped these rooms. The sentence says what is true now
 * rather than implying the previous shape was private.
 */
export const CHAT_MULTIPLEX_DISCLOSURE =
  'Your open conversations share one connection, so the relay can see that they belong to the same ' +
  'person. It could already tell from the timing; this does not hide it and does not pretend to.'

// ── The directory ─────────────────────────────────────────────────────────────────────────

export const DIRECTORY_TITLE = 'Claim a name'

/**
 * The warning that has to sit on the claim screen.
 *
 * Registration is already publicly enumerable on chain; what a directory adds is the link from a
 * handle somebody chose to that address. "Forever" is the honest word — the ledger is file-backed
 * and restorable, so a delete cannot be sold as an erasure.
 */
export const DIRECTORY_IS_PUBLIC =
  'A name in the directory is public. Anyone can read the list and see which address it points to, ' +
  'and taking it back removes it from the list rather than from anyone who already copied it.'

export const DIRECTORY_SEARCH_PLACEHOLDER = 'A name, or an address starting 0x'

/**
 * Why a search never leaves the browser.
 *
 * The client fetches the whole (small) directory and matches locally, so the relayer learns that
 * you fetched it and not who you looked for. Worth saying: it is the kind of design decision users
 * assume was made the other way.
 */
export const DIRECTORY_SEARCH_IS_LOCAL =
  'Search runs in this browser against the whole list, so the relay never learns who you looked for.'

/** Names are not identity, and the address is. Said where a name is about to be trusted. */
export const DIRECTORY_NAME_IS_NOT_IDENTITY =
  'A name is a label somebody claimed, not proof of who they are. The address underneath it is the ' +
  'part that cannot be swapped.'

export const DIRECTORY_NAME_TAKEN = 'That name is already claimed by another address.'

export const DIRECTORY_NAME_MALFORMED =
  'Names are 3 to 20 characters, lower-case letters, numbers and underscores.'

export const DIRECTORY_CLAIM_NEEDS_REGISTRATION =
  'Claiming a name proves you hold the key registered to this address, so the account has to be ' +
  'registered with the pool first.'

// ── The empty and unreachable states ──────────────────────────────────────────────────────

export const CHAT_NO_CONVERSATIONS =
  'No conversations yet. Anyone who has registered with the pool can be reached — starting one ' +
  'publishes nothing and asks nobody.'

export const CHAT_PICK_A_CONVERSATION = 'Pick a conversation, or start a new one.'

/** The unregistered peer. A product state with an action, not an error. */
export const CHAT_PEER_UNREGISTERED =
  'This address has not registered with the pool, so there is no key to derive a room from. They ' +
  'need to open the app once.'

export const CHAT_PEER_SELF = 'That is your own address.'

export const CHAT_PEER_INVALID = 'That is not a Starknet address.'

/** First message in a room that is open. What it says is a property of the transport. */
export const CHAT_THREAD_EMPTY =
  'No messages yet. What you type is sealed in this browser before it leaves.'
