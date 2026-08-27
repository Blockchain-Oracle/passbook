//
// ONE transaction union, ONE renderer, ONE feed (story 6.6, FR-056 / FR-011a / FR-025 / AD-6).
//
// ── THE TWO SIDES, AND WHY ONE OF THEM IS ALMOST ALWAYS NULL ──────────────────────────────
//
// The story asks for "one closed union covering all six surfaces". The chain does not agree that
// six surfaces exist: a swap, a bridge exit, a market bet and a chat payment all land as some
// arrangement of `NoteUsed` and `EncNoteCreated`, and from the public record they are
// indistinguishable. That is the product's central claim, not a gap in it.
//
// So a row carries two things that are true in different ways. `chain` is what anyone reading the
// pool would see. `surface` is what only THIS browser knows, because this browser is what
// submitted it — and it is `null` on every row reconstructed from the record, including our own
// past ones. A Global row wearing a `Swap` tag would falsify the standing line printed three
// inches above it (`activity-copy.ts:39`): six identities unlinkable to other users, assembled
// here rather than joined up on chain. Inferring intent from a nullifier is exactly the linkage
// the sentence says does not exist.
//
// ── WHAT THIS MODULE MAY IMPORT ──────────────────────────────────────────────────────────
//
// Browser-safe modules only. `activity-entry.js` exists precisely so this file can name
// `ActivityEntry` without reaching `activity.js`, which imports the privacy SDK and `starknet`.
// The value imports below (`constants`, `progress`, `note-lifecycle`, `option-row`, `amount`) are
// each already in the app's eager graph or free of one; adding an import here is a 268 kB
// regression that compiles clean, and only `build:web` would eventually say so.
//

import { NET } from './constants.js'
import { groupDigits } from './amount.js'
import { blockCountdown } from './progress.js'
import { lifecycleChip, type MaturationProgress } from './note-lifecycle.js'
import { badgeFromChip } from './option-row.js'
import { STAGE_TITLES } from './pipeline-stage.js'
import { NOT_YET_INDEXED, SYSTEM_NOTE_LABEL } from './activity-copy.js'
import type { OptionRow } from './option-row.js'
import type { ActivityEntry, ActivityKind } from './activity-entry.js'
import type { PipelineStage } from './pipeline-stage.js'

// ── The six surfaces ──────────────────────────────────────────────────────────────────────

/**
 * Every surface that can originate a transaction. In nav order.
 *
 * A seventh member is a compile error in `apps/web/src/route-contract.ts`, which pins this list
 * against the router's `Mode` enum in both directions — a surface with no mode and a mode with no
 * surface are different mistakes and both are TS2344. The list is duplicated rather than imported
 * because `modes.ts` reaches the router's types and this package must not.
 */
export const ACTIVITY_SURFACES = ['wallet', 'chat', 'swap', 'bridge', 'markets', 'launch'] as const

export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number]

// ── The union ─────────────────────────────────────────────────────────────────────────────

/**
 * How far along the chain a transaction is. Three states, closed.
 *
 * `not-indexed` is deliberately NOT a member. A row that was submitted and has not appeared is
 * still `optimistic` — the difference is elapsed time, and storing it as a fourth state would mean
 * a timer somewhere had to move rows between two states that describe the same fact. `rightSlot`
 * derives it from `submittedAt` instead, which is a pure function of the clock and cannot be
 * forgotten, double-fired, or left running after unmount.
 */
export type TransactionChain =
  /** Submitted from here; the chain has not published it yet. Ours by construction. */
  | {
      state: 'optimistic'
      /** `Date.now()` at submission. Never read from inside this module — always passed in. */
      submittedAt: number
      stage: PipelineStage
      /** Known once the relayer answers; `null` before that, and never a placeholder. */
      transactionHash: string | null
    }
  /** On chain and decoded. The record's own row, untouched. */
  | {
      state: 'settled'
      entry: ActivityEntry
      /**
       * How far a young note has matured, when we know. Absent means matured or not applicable —
       * never "zero of ten", which would render a static ring over a note that is spendable.
       */
      maturation?: MaturationProgress
    }
  /**
   * It stopped before it settled.
   *
   * `retryable` is what decides amber-with-Retry versus a grey administrative stop, and it is
   * carried rather than derived from `reason`: §5's rule is that classification precedes copy, and
   * a component pattern-matching a reason string is classification happening in the wrong place.
   */
  | { state: 'failed'; retryable: boolean; reason: string }

export interface Transaction {
  /** `<txHash>-<ordinal>` for a settled row; whatever the submitter minted for an optimistic one. */
  id: string
  chain: TransactionChain
  /**
   * Which surface produced it — ONLY for actions this browser originated. See the file header.
   * Never inferred, never defaulted, never guessed from the row's kind.
   */
  surface: ActivitySurface | null
  /**
   * What the user called it, in their words, for a row we started. `null` for a reconstructed row,
   * where the title comes from what the chain published instead.
   *
   * Same field as `RunningPipeline.label`, for the same reason: the pipeline's row and the feed's
   * row are the same action seen at two moments, and they must not describe it differently.
   */
  label: string | null
}

/**
 * What the chain published, as a word.
 *
 * Written out rather than capitalised from the key, for `MODE_LABELS`' reason (`modes.ts:58`): the
 * union member is an identifier and the label is copy, and the day the two need to differ must not
 * be the day someone discovers they were the same string.
 */
export const ACTIVITY_KIND_LABELS = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  'note-created': 'Note created',
  'note-spent': 'Note spent',
  'open-note-created': 'Open note created',
  'open-note-deposited': 'Open note deposited',
  registration: 'Registration',
} as const satisfies Record<ActivityKind, string>

// ── System notes ──────────────────────────────────────────────────────────────────────────

/**
 * The companion note every message-only pool transaction carries.
 *
 * One wei, because the pool requires each invoke to be accompanied by an action that writes a
 * write-once slot (`actions.ts`) — so a message costs a note whether or not it moves value. Told
 * as structure, never as anomaly (§5).
 */
export const SYSTEM_NOTE_WEI = 1n

/**
 * True for a row that is a 1-wei companion.
 *
 * AN UNREADABLE AMOUNT IS NOT A SYSTEM NOTE, and that asymmetry is the whole design of this
 * predicate. An encrypted note publishes no amount, so `amount` is `null` for most `note-created`
 * rows in a Global feed. If `null` counted as a match, hiding system notes would hide every
 * encrypted note in the pool — the filter would quietly empty the feed and look like it worked.
 * A filter may only hide what it can prove.
 */
export function isSystemNote(tx: Transaction): boolean {
  if (tx.chain.state !== 'settled') return false
  const { entry } = tx.chain
  const creates = entry.kind === 'note-created' || entry.kind === 'open-note-created' || entry.kind === 'open-note-deposited'
  return creates && entry.amount === SYSTEM_NOTE_WEI
}

/** The feed with system notes hidden, or the feed. */
export function visibleTransactions(
  transactions: readonly Transaction[],
  showSystemNotes: boolean,
): Transaction[] {
  return showSystemNotes ? [...transactions] : transactions.filter((tx) => !isSystemNote(tx))
}

// ── The two tabs ──────────────────────────────────────────────────────────────────────────

export type FeedTab = 'global' | 'personal'

export const FEED_TAB_LABELS = {
  global: 'Global',
  personal: 'Personal',
} as const satisfies Record<FeedTab, string>

/**
 * Whether a row is ours.
 *
 * TWO KINDS OF KNOWLEDGE, and they are not fused. A settled row is ours because its note id or
 * nullifier recomputes from a channel we hold, or because it names an address we are looking at —
 * `activity.ts` already draws that distinction and it is not re-drawn here. An in-flight row is
 * ours because nothing else could have put it in this store: only this browser submits from this
 * browser. A failed one likewise.
 */
export function isMine(tx: Transaction): boolean {
  return tx.chain.state === 'settled' ? tx.chain.entry.mine : true
}

/**
 * What the feed should actually render, given the tab the user picked.
 *
 * FOUR STATES AND NOT THREE. `unread` and `empty` are the same picture and opposite facts, which
 * is the entire reason EXPERIENCE §5 requires an `initialized` flag: "no activity yet" is a claim
 * about the chain, and before a read has run we have not looked. Collapsing them tells a user
 * their history is empty during an outage — the same fail-closed rule `BOOK_UNKNOWN` exists for.
 *
 * `showing` is what rendered, which can differ from `tab`: a Personal tab with nothing in it falls
 * back to Global so the app is never blank. Returned as data rather than decided in the component,
 * so the fallback is testable and one behaviour rather than one per caller.
 */
export interface FeedView {
  /** The tab the user selected. */
  tab: FeedTab
  /** The tab whose rows are in `rows`. Differs from `tab` only on the Personal-empty fallback. */
  showing: FeedTab
  rows: Transaction[]
  state: 'unread' | 'empty' | 'filtered-empty' | 'personal-empty' | 'rows'
}

/**
 * @param transactions  ALREADY FILTERED. `visibleTransactions` runs first.
 * @param hiddenByFilter how many rows the filter removed — see `'filtered-empty'` below.
 */
export function feedFor(
  tab: FeedTab,
  transactions: readonly Transaction[],
  initialized: boolean,
  hiddenByFilter = 0,
): FeedView {
  if (!initialized) return { tab, showing: tab, rows: [], state: 'unread' }

  //
  // AN EMPTY LIST THE FILTER EMPTIED IS NOT AN EMPTY POOL, and the distinction is the same one
  // `initialized` draws one step earlier. Turning off system notes in a feed that holds only
  // system notes would otherwise print "No activity yet" — a claim about the chain, made because
  // of a switch the user flicked. Three ways to reach a blank list, three different sentences.
  //
  const nothing = (): FeedView['state'] => (hiddenByFilter > 0 ? 'filtered-empty' : 'empty')

  const global = orderTransactions(transactions)
  if (tab === 'global') {
    return { tab, showing: 'global', rows: global, state: global.length ? 'rows' : nothing() }
  }

  const personal = global.filter(isMine)
  if (personal.length) return { tab, showing: 'personal', rows: personal, state: 'rows' }
  // Nothing of ours. Fall back to Global — and when Global is empty too, this is not a fallback at
  // all, it is the ordinary empty feed, so it must not carry the "showing everything instead"
  // sentence over a list that shows nothing.
  return {
    tab,
    showing: 'global',
    rows: global,
    state: global.length ? 'personal-empty' : nothing(),
  }
}

/**
 * The one order the feed is ever read in.
 *
 * NEWEST FIRST, and an in-flight row is the newest thing there is — it has no block yet because
 * the block has not happened. So the unsettled rows lead, ordered by when they were submitted, and
 * the settled ones follow in `buildActivity`'s own order (block descending, then hash, then
 * ordinal) so a row does not swap places between two renders of the same data.
 *
 * WITHOUT THIS THE FEED HAS NO ORDER AT ALL — it would render whatever order the store happened to
 * be handed, and a record surface whose rows move between renders is not a record. `buildActivity`
 * already sorts what it produces; this is what survives an optimistic row being mixed in.
 */
export function orderTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => rank(a) - rank(b) || tieBreak(a, b))
}

/** Unsettled rows lead. Two ranks, not three: a failed row is still something we started. */
function rank(tx: Transaction): number {
  return tx.chain.state === 'settled' ? 1 : 0
}

function tieBreak(a: Transaction, b: Transaction): number {
  if (a.chain.state === 'settled' && b.chain.state === 'settled') {
    return (
      b.chain.entry.blockNumber - a.chain.entry.blockNumber ||
      a.chain.entry.transactionHash.localeCompare(b.chain.entry.transactionHash) ||
      // NUMERIC, not the composed id string: `'0xtx-10' < '0xtx-2'` lexicographically, and a batch
      // emitting ten decodable events is an ordinary send with change notes.
      a.chain.entry.ordinal - b.chain.entry.ordinal
    )
  }
  const at = a.chain.state === 'optimistic' ? a.chain.submittedAt : 0
  const bt = b.chain.state === 'optimistic' ? b.chain.submittedAt : 0
  return bt - at || a.id.localeCompare(b.id)
}

/** What `/activity/<id>` resolves to. Three answers, and two of them are not "no such thing". */
export type ReceiptView =
  /** No read has run, so this id has not been looked for. Not the same as absent. */
  | { state: 'unread' }
  /** A read has run and this id is not in the range it loaded. Still not "does not exist". */
  | { state: 'not-found' }
  | { state: 'found'; transaction: Transaction }

/**
 * Resolves one addressable id.
 *
 * IT CANNOT THROW, and that is the whole contract. `scripts/build-web.mjs` names `/activity/$id`
 * verbatim, so `params.id` really can be the three-character string `"$id"` — and a receipt route
 * that raised on an id it did not recognise would ship wearing `__error__` on every build.
 * `Array.find` returning `undefined` is the mechanism; this function exists so the mechanism is
 * pinned by a test rather than re-derived in a component that no runner executes.
 */
export function receiptFor(
  transactions: readonly Transaction[],
  id: string,
  initialized: boolean,
): ReceiptView {
  if (!initialized) return { state: 'unread' }
  const transaction = transactions.find((tx) => tx.id === id)
  return transaction ? { state: 'found', transaction } : { state: 'not-found' }
}

// ── The right-edge slot ───────────────────────────────────────────────────────────────────

/**
 * How long a submitted row may go unseen before it says so.
 *
 * A PATIENCE BOUND, not a protocol constant — the same kind of number as `PROVING_PATIENCE_MS`
 * (`progress.ts:218`), and chosen the same way: long enough that an ordinary confirmation never
 * trips it, short enough that a user staring at a spinner is told something true before they
 * decide the app is broken. Mainnet blocks land in tens of seconds, so two minutes is several
 * blocks of slack.
 *
 * Passing it is never optional and the clock is never read in here: `rightSlot` takes `now`, so
 * every state this module produces is reproducible from its inputs.
 */
export const NOT_INDEXED_AFTER_MS = 120_000

/**
 * The right edge of an activity row. Closed — a sixth shape is a compile error.
 *
 * §4.8's grammar: "pending/confirmed is a slot-swap at the right edge (timestamp ↔ spinner ↔
 * static ring)". The swap is why these are five variants of one slot rather than five conditional
 * elements: the slot is reserved once and its contents change, so nothing below it moves.
 */
export type RightSlot =
  /** Settled and matured. The block, because a block is a measurement and a clock time is not. */
  | { kind: 'block'; text: string }
  /**
   * In flight. The animated ring, and the stage it is on.
   *
   * NAMED, because an unlabelled spinner is the least informative thing a row can show. The stage
   * word comes from `STAGE_TITLES` — the same table the progress machine renders — so a send
   * cannot be called `Relay` in the pipeline row and something else in the feed.
   */
  | { kind: 'spinner'; text: string }
  /**
   * Maturing or queued. A STATIC ring: "the clock runs, nothing is stuck" (§4.8). Never animated —
   * a spinner here would claim we are watching a computation, and nothing is being watched.
   */
  | { kind: 'static-ring'; text: string }
  /** Stopped. `retryable` decides amber-with-Retry versus a grey administrative stop. */
  | { kind: 'failed'; retryable: boolean }
  /** Submitted and still not on chain past the patience bound. Never vanishes, never a zero state. */
  | { kind: 'not-indexed'; href: string | null }

export function rightSlot(tx: Transaction, now: number): RightSlot {
  switch (tx.chain.state) {
    case 'failed':
      return { kind: 'failed', retryable: tx.chain.retryable }

    case 'optimistic': {
      const elapsed = now - tx.chain.submittedAt
      // `Number.isFinite` rather than a bare comparison: a caller that passed a bad clock gets the
      // spinner, which is the state that claims the least. Deciding "not indexed" off a NaN would
      // tell a user their transaction is missing on the strength of arithmetic that never ran.
      if (Number.isFinite(elapsed) && elapsed >= NOT_INDEXED_AFTER_MS) {
        return { kind: 'not-indexed', href: voyagerTxUrl(tx.chain.transactionHash) }
      }
      return { kind: 'spinner', text: STAGE_TITLES[tx.chain.stage] }
    }

    case 'settled': {
      const { entry, maturation } = tx.chain
      if (maturation && maturation.confirmed < maturation.required) {
        return { kind: 'static-ring', text: blockCountdown(maturation.confirmed, maturation.required) }
      }
      return { kind: 'block', text: blockLabel(entry.blockNumber) }
    }
  }
}

/**
 * A block height as it renders.
 *
 * THIS IS THE "TIMESTAMP" §4.8 ASKS FOR, and the substitution is deliberate rather than a
 * shortfall. An entry carries a block number; a wall-clock time needs a second chain read that
 * nothing in this epic performs. `Block 13,412,880` is a number a reader can paste into an
 * explorer and check. `3 days ago`, computed from a height we never timed, would be the invented
 * runtime value this project fails builds over.
 */
export function blockLabel(blockNumber: number): string {
  return `Block ${groupDigits(String(blockNumber))}`
}

/**
 * The explorer link for a transaction, or `null`.
 *
 * `null` rather than a base URL when there is no hash, because §5's sentence renders the link in
 * brackets — `Submitted, not yet indexed — [check on Voyager ↗]` — and a bracketed link that lands
 * on an explorer's front page in front of an already-worried user is worse than the sentence
 * alone. The same call 6.5 made about `[Prover status ↗]`, except here the base URL genuinely
 * exists (`constants.ts:35`), so only the missing hash can suppress it.
 */
export function voyagerTxUrl(transactionHash: string | null): string | null {
  return transactionHash ? `${NET.explorer}/tx/${transactionHash}` : null
}

// ── The one row projection ────────────────────────────────────────────────────────────────

/**
 * One transaction as the app's one row model.
 *
 * PURE DATA OUT, no React node in sight — `option-row.ts:36` explains why the model refuses to
 * hold markup, and this is the function that would break that rule first if it could. The right
 * slot is deliberately NOT set here: `OptionRow.right` is a `Valued<string>`, a formatted value,
 * and the activity row's right edge is a state. `rightSlot()` answers that separately and the
 * component puts the two together.
 */
export function activityRowModel(tx: Transaction, now: number): OptionRow {
  const base = {
    id: tx.id,
    title: rowTitle(tx),
  } satisfies Partial<OptionRow> & { id: string; title: string }

  if (tx.chain.state !== 'settled') {
    //
    // THE SENTENCE GOES IN THE SUBTITLE, NOT IN THE RIGHT SLOT, and that is a layout fact rather
    // than a preference. The slot is `flex: none` with a reserved minimum, so a sentence in it
    // sizes the slot to the sentence and collapses the title column to pay — the row re-wraps on
    // exactly the transition the reserve exists to prevent. "Submitted, not yet indexed" is a fact
    // about the row, and the anatomy's middle column is where facts about rows go; the right slot
    // keeps the ACTION, which is two words wide.
    //
    const reason =
      tx.chain.state === 'failed'
        ? tx.chain.reason
        : rightSlot(tx, now).kind === 'not-indexed'
          ? NOT_YET_INDEXED
          : undefined
    return { ...base, ...(reason === undefined ? {} : { subtitle: reason }) }
  }

  const { entry, maturation } = tx.chain
  const badge =
    maturation && maturation.confirmed < maturation.required
      ? badgeFromChip(lifecycleChip('maturing', maturation))
      : undefined

  // A system note says what it is, verbatim (§5), and that sentence is more use in the subtitle
  // than a hash would be. Everything else shows the counterparty, or the note it is about.
  const system = isSystemNote(tx)
  const subtitle = system ? SYSTEM_NOTE_LABEL : (entry.counterparty ?? entry.noteCommitment ?? undefined)

  return {
    ...base,
    ...(badge ? { badge } : {}),
    ...(subtitle === undefined ? {} : { subtitle }),
    subtitleIsMono: !system && subtitle !== undefined,
    ...(system ? { tag: 'System note' } : {}),
  }
}

/**
 * What the row is called.
 *
 * Our own label wins when we have one, because it is what the user called the action; a
 * reconstructed row falls back to what the chain published. There is no third option — inventing
 * a name for someone else's note-spent is the surface attribution this module exists to refuse.
 */
export function rowTitle(tx: Transaction): string {
  if (tx.label !== null) return tx.label
  return tx.chain.state === 'settled' ? ACTIVITY_KIND_LABELS[tx.chain.entry.kind] : 'Submitted'
}

// ── The wallet-grade presentation: category, direction, group ─────────────────────────────

/**
 * What KIND of thing a row is, for the tinted disc at its left edge.
 *
 * ── THIS IS THE ONE PLACE SURFACE ATTRIBUTION IS ALLOWED, AND ONLY ONE WAY ───────────────
 *
 * The file header's rule stands: a settled row reconstructed from the record carries
 * `surface: null` and MUST NOT be labelled `Swap`, because inferring intent from a nullifier is
 * exactly the linkage the standing line says does not exist. So the settled branch below reads
 * only `kind` and `mine` — both facts the chain published or this browser's own registry proved —
 * and never `label`.
 *
 * The unsettled branch is the opposite case and it is safe for the opposite reason: an
 * `optimistic` row exists because THIS browser submitted it, so its `surface` is a record of what
 * we did rather than a guess about what somebody else did. `wallet` resolves to `sent` because
 * sending is the only value movement the wallet surface submits; registration drives the pipeline
 * store, not this one, so it never arrives here wearing that surface.
 */
export type ActivityCategory =
  | 'sent'
  | 'received'
  | 'deposit'
  | 'withdrawal'
  | 'registration'
  | 'swap'
  | 'bridge'
  | 'message'
  | 'system'
  | 'note'

export function activityCategory(tx: Transaction): ActivityCategory {
  if (isSystemNote(tx)) return 'system'

  if (tx.chain.state !== 'settled') {
    switch (tx.surface) {
      case 'swap':
        return 'swap'
      case 'bridge':
        return 'bridge'
      case 'chat':
        return 'message'
      case 'wallet':
        return 'sent'
      // `markets` and `launch` submit through the pool the same way everything else does, and
      // neither has a disc of its own yet. `note` is the honest placeholder: it claims nothing.
      default:
        return 'note'
    }
  }

  const { entry } = tx.chain
  switch (entry.kind) {
    case 'registration':
      return 'registration'
    case 'deposit':
      return 'deposit'
    case 'withdrawal':
      return 'withdrawal'
    case 'note-spent':
      return entry.mine ? 'sent' : 'note'
    case 'note-created':
    case 'open-note-created':
    case 'open-note-deposited':
      return entry.mine ? 'received' : 'note'
  }
}

/**
 * Which way the value moved, from this account's point of view.
 *
 * `none` is not "zero" — it is the answer for a row where a sign would be a claim. Somebody
 * else's note movement has no direction relative to us, and a registration moves no value at all.
 * Rendering `+` on those would put a number on the wrong side of a ledger.
 */
export type AmountDirection = 'in' | 'out' | 'none'

export function amountDirection(tx: Transaction): AmountDirection {
  switch (activityCategory(tx)) {
    case 'received':
    case 'deposit':
      return 'in'
    case 'sent':
    case 'withdrawal':
    case 'swap':
    case 'bridge':
    case 'message':
      return 'out'
    case 'registration':
    case 'system':
    case 'note':
      return 'none'
  }
}

/**
 * The amount this row moved, when the chain published one we can read.
 *
 * `null` covers two different situations that render the same way and must not be collapsed into
 * a zero: an encrypted note whose amount is ciphertext to everyone but its owner, and a row that
 * has not settled and therefore has no published amount at all.
 */
export function rowAmountWei(tx: Transaction): bigint | null {
  return tx.chain.state === 'settled' ? tx.chain.entry.amount : null
}

/** The other party, when the event named one. Never inferred — `activity-entry.ts`'s rule. */
export function rowCounterparty(tx: Transaction): string | null {
  return tx.chain.state === 'settled' ? tx.chain.entry.counterparty : null
}

/**
 * Mainnet's measured block cadence, in seconds.
 *
 * DUPLICATED FROM `activity-window.ts` RATHER THAN IMPORTED, and the duplication is deliberate:
 * that module reaches `pool-events.js`, which imports `starknet` for the selector hash, and this
 * one is in the eager graph of the cold-open route. Importing it here is a 268 kB regression that
 * compiles clean — the exact trap this file's header names.
 *
 * `test/activity-presentation.test.ts` asserts the two constants are the same number, so the copy
 * cannot drift silently. When Starknet's block time falls again, both move together or the suite
 * fails.
 */
export const BLOCK_SECONDS = 1.7

/** One day, in blocks. The boundary between the first group and the second. */
export const BLOCKS_PER_DAY = Math.round((24 * 60 * 60) / BLOCK_SECONDS)

/** One week, in blocks — the read window's own span, and the last group boundary. */
export const BLOCKS_PER_WEEK = BLOCKS_PER_DAY * 7

/**
 * Which section of the history a row belongs in.
 *
 * ── WHY THESE ARE DISTANCES AND NOT DATES ────────────────────────────────────────────────
 *
 * A pool event carries a block number and nothing else. `blockLabel` already refuses to render
 * "3 days ago" from a height nobody timed, and that refusal is right — so grouping by calendar day
 * is not available at any price short of a second chain read per block.
 *
 * What IS available is distance from the head, which is a measurement. `describeSpan` already
 * converts block counts to "about 3 days" in the window note, so the vocabulary is one a user of
 * this app has already met. `history-copy.ts`'s `HISTORY_GROUPING_NOTE` states the mechanism on
 * screen, because a reader who mistakes these for dates misreads every row underneath them.
 *
 * @param headBlock the height the record was read beside, or `null` when no read has completed.
 *                  A `null` head puts every settled row in `older` rather than inventing a
 *                  distance from a number we do not have.
 */
export type ActivityGroup = 'in-progress' | 'recent' | 'week' | 'older'

export const ACTIVITY_GROUP_ORDER: readonly ActivityGroup[] = [
  'in-progress',
  'recent',
  'week',
  'older',
]

export function activityGroup(tx: Transaction, headBlock: number | null): ActivityGroup {
  if (tx.chain.state !== 'settled') return 'in-progress'
  if (headBlock === null || !Number.isFinite(headBlock)) return 'older'

  // A row from a block AHEAD of the head is not an error worth a state of its own: the walk and
  // the event read are two reads a beat apart, so a row can legitimately be newer than the height
  // the balance was taken at. `Math.max` puts it in the newest group, which is where it belongs.
  const behind = Math.max(0, headBlock - tx.chain.entry.blockNumber)
  if (behind <= BLOCKS_PER_DAY) return 'recent'
  if (behind <= BLOCKS_PER_WEEK) return 'week'
  return 'older'
}

/** One section of the rendered history. */
export interface ActivitySection {
  group: ActivityGroup
  rows: Transaction[]
}

/**
 * The feed's rows, in order, cut into sections.
 *
 * ORDER IS PRESERVED, NOT RE-SORTED. `orderTransactions` already decided the one order this feed
 * is read in, and its header explains why a record whose rows move between renders is not a
 * record. This only inserts the boundaries — every group's rows arrive in the order they came in,
 * and an empty group is omitted rather than rendered as a header with nothing under it.
 */
export function activitySections(
  transactions: readonly Transaction[],
  headBlock: number | null,
): ActivitySection[] {
  const sections: ActivitySection[] = []
  for (const group of ACTIVITY_GROUP_ORDER) {
    const rows = transactions.filter((tx) => activityGroup(tx, headBlock) === group)
    if (rows.length) sections.push({ group, rows })
  }
  return sections
}
