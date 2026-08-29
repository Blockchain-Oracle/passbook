//
// ONE transaction union, ONE feed (story 6.6, FR-056 / FR-011a / FR-025 / AD-6).
//
// A row carries two things true in different ways. `chain` is what anyone reading the pool would
// see. `surface` is what only THIS browser knows because it submitted the row — and it is `null`
// on every row reconstructed from the record, including our own past ones. Inferring intent from a
// nullifier is exactly the linkage the standing line says does not exist.
//
// Browser-safe modules only: this sits in the eager graph of the cold-open route, so nothing here
// may reach `starknet` or the privacy SDK (`activity-entry.js` exists for that reason).
//

import { isSystemNote } from './transaction-render.js'
import type { MaturationProgress } from './note-lifecycle.js'
import type { ActivityEntry } from './activity-entry.js'
import type { PipelineStage } from './pipeline-stage.js'

export * from './transaction-render.js'

// ── The seven surfaces ────────────────────────────────────────────────────────────────────

/** Every surface that can originate a transaction, in nav order. Pinned against the router's modes. */
export const ACTIVITY_SURFACES = ['wallet', 'chat', 'swap', 'bridge', 'markets', 'launch', 'houses'] as const

export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number]

// ── The union ─────────────────────────────────────────────────────────────────────────────

/**
 * How far along the chain a transaction is. `not-indexed` is deliberately NOT a member: it is
 * elapsed time on an `optimistic` row, derived from `submittedAt` by `rightSlot`.
 */
export type TransactionChain =
  /** Submitted from here; the chain has not published it yet. Ours by construction. */
  | {
      state: 'optimistic'
      /** `Date.now()` at submission. Always passed in, never read here. */
      submittedAt: number
      stage: PipelineStage
      /** Known once the relayer answers; `null` before that, never a placeholder. */
      transactionHash: string | null
    }
  /** On chain and decoded. The record's own row, untouched. */
  | {
      state: 'settled'
      entry: ActivityEntry
      /** Absent means matured or not applicable — never "zero of ten". */
      maturation?: MaturationProgress
    }
  /** It stopped before it settled. `retryable` is carried, not derived from `reason`. */
  | {
      state: 'failed'
      retryable: boolean
      reason: string
      /** Present when broadcast succeeded but confirmation did not. */
      transactionHash?: string | null
      submitted?: boolean
    }

export interface Transaction {
  /** `<txHash>-<ordinal>` for a settled row; whatever the submitter minted for an optimistic one. */
  id: string
  chain: TransactionChain
  /** Which surface produced it — ONLY for actions this browser originated. Never inferred. */
  surface: ActivitySurface | null
  /** What the user called it, for a row we started. `null` for a reconstructed row. */
  label: string | null
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

/** A settled row is ours by its registry match; an in-flight or failed one because only this browser submits here. */
export function isMine(tx: Transaction): boolean {
  return tx.chain.state === 'settled' ? tx.chain.entry.mine : true
}

/**
 * What the feed renders. `unread` and `empty` are the same picture and opposite facts — before a
 * read has run we have not looked. `showing` always equals `tab` since the Personal fallback was
 * removed (it put the pool's rows inside a personal history).
 */
export interface FeedView {
  tab: FeedTab
  showing: FeedTab
  rows: Transaction[]
  state: 'unread' | 'empty' | 'filtered-empty' | 'personal-empty' | 'rows'
}

/**
 * @param transactions  ALREADY FILTERED. `visibleTransactions` runs first.
 * @param hiddenByFilter how many rows the filter removed — an emptied list is not an empty pool.
 */
export function feedFor(
  tab: FeedTab,
  transactions: readonly Transaction[],
  initialized: boolean,
  hiddenByFilter = 0,
): FeedView {
  if (!initialized) return { tab, showing: tab, rows: [], state: 'unread' }

  const nothing = (): FeedView['state'] => (hiddenByFilter > 0 ? 'filtered-empty' : 'empty')

  const global = orderTransactions(transactions)
  if (tab === 'global') {
    return { tab, showing: 'global', rows: global, state: global.length ? 'rows' : nothing() }
  }

  const personal = global.filter(isMine)
  if (personal.length) return { tab, showing: 'personal', rows: personal, state: 'rows' }
  // Nothing of ours renders nothing; `personal-empty` keeps its own sentence.
  return {
    tab,
    showing: 'personal',
    rows: [],
    state: global.length ? 'personal-empty' : nothing(),
  }
}

/**
 * The one order the feed is ever read in: unsettled rows lead (newest submission first), then the
 * settled ones in `buildActivity`'s own order (block descending, hash, ordinal).
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
      // NUMERIC, not the composed id string: `'0xtx-10' < '0xtx-2'` lexicographically.
      a.chain.entry.ordinal - b.chain.entry.ordinal
    )
  }
  const at = a.chain.state === 'optimistic' ? a.chain.submittedAt : 0
  const bt = b.chain.state === 'optimistic' ? b.chain.submittedAt : 0
  return bt - at || a.id.localeCompare(b.id)
}

/** What `/activity/<id>` resolves to. Two of the three answers are not "no such thing". */
export type ReceiptView =
  | { state: 'unread' }
  | { state: 'not-found' }
  | { state: 'found'; transaction: Transaction }

/** Resolves one addressable id. IT CANNOT THROW — `params.id` can be anything. */
export function receiptFor(
  transactions: readonly Transaction[],
  id: string,
  initialized: boolean,
): ReceiptView {
  if (!initialized) return { state: 'unread' }
  const transaction = transactions.find((tx) => tx.id === id)
  return transaction ? { state: 'found', transaction } : { state: 'not-found' }
}

// ── Grouping by distance from the head ────────────────────────────────────────────────────

/**
 * Mainnet's measured block cadence, in seconds. Duplicated from `activity-window.ts` rather than
 * imported: that module reaches `pool-events.js` and `starknet`, and this one is eager.
 */
export const BLOCK_SECONDS = 1.7

/** One day, in blocks. */
export const BLOCKS_PER_DAY = Math.round((24 * 60 * 60) / BLOCK_SECONDS)

/** One week, in blocks — the read window's own span. */
export const BLOCKS_PER_WEEK = BLOCKS_PER_DAY * 7

/** Distances from the head, not dates: a pool event carries a block number and nothing else. */
export type ActivityGroup = 'in-progress' | 'recent' | 'week' | 'older'

export const ACTIVITY_GROUP_ORDER: readonly ActivityGroup[] = [
  'in-progress',
  'recent',
  'week',
  'older',
]

/** @param headBlock the height the record was read beside; `null` puts every settled row in `older`. */
export function activityGroup(tx: Transaction, headBlock: number | null): ActivityGroup {
  if (tx.chain.state !== 'settled') return 'in-progress'
  if (headBlock === null || !Number.isFinite(headBlock)) return 'older'

  // A row ahead of the head (two reads a beat apart) belongs in the newest group.
  const behind = Math.max(0, headBlock - tx.chain.entry.blockNumber)
  if (behind <= BLOCKS_PER_DAY) return 'recent'
  if (behind <= BLOCKS_PER_WEEK) return 'week'
  return 'older'
}

export interface ActivitySection {
  group: ActivityGroup
  rows: Transaction[]
}

/** The feed's rows, in their given order, cut into sections. Empty groups are omitted. */
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
