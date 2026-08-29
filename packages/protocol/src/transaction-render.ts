//
// How one `Transaction` renders: the right-edge slot, the row model, category and direction.
//
// Browser-safe modules only — this sits in the eager graph of the cold-open route, so nothing here
// may reach `starknet` or the privacy SDK. Surface attribution rule (see `transaction.ts`): a
// settled row reconstructed from the record MUST NOT be labelled by intent; only `kind` and `mine`.
//

import { NET } from './constants.js'
import { groupDigits } from './amount.js'
import { blockCountdown } from './progress.js'
import { lifecycleChip } from './note-lifecycle.js'
import { badgeFromChip } from './option-row.js'
import { STAGE_TITLES } from './pipeline-stage.js'
import { NOT_YET_INDEXED, SYSTEM_NOTE_LABEL } from './activity-copy.js'
import type { OptionRow } from './option-row.js'
import type { ActivityKind } from './activity-entry.js'
import type { Transaction } from './transaction.js'

/** What the chain published, as a word. Copy, not a capitalised key. */
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

/** The 1-wei companion note every message-only pool transaction carries. */
export const SYSTEM_NOTE_WEI = 1n

/**
 * True for a row that is a 1-wei companion. AN UNREADABLE AMOUNT (`null`) IS NOT A SYSTEM NOTE —
 * otherwise hiding system notes would hide every encrypted note in the pool.
 */
export function isSystemNote(tx: Transaction): boolean {
  if (tx.chain.state !== 'settled') return false
  const { entry } = tx.chain
  const creates = entry.kind === 'note-created' || entry.kind === 'open-note-created' || entry.kind === 'open-note-deposited'
  return creates && entry.amount === SYSTEM_NOTE_WEI
}

// ── The right-edge slot ───────────────────────────────────────────────────────────────────

/** A patience bound, not a protocol constant: several mainnet blocks of slack before "not indexed". */
export const NOT_INDEXED_AFTER_MS = 120_000

/** The right edge of an activity row (§4.8's slot-swap). Closed — a sixth shape is a compile error. */
export type RightSlot =
  | { kind: 'block'; text: string }
  /** In flight: the animated ring, named by its `STAGE_TITLES` stage. */
  | { kind: 'spinner'; text: string }
  /** Maturing or queued. A STATIC ring — nothing is being watched. */
  | { kind: 'static-ring'; text: string }
  | { kind: 'failed'; retryable: boolean }
  /** Submitted and still not on chain past the patience bound. Never vanishes. */
  | { kind: 'not-indexed'; href: string | null }

export function rightSlot(tx: Transaction, now: number): RightSlot {
  switch (tx.chain.state) {
    case 'failed':
      return { kind: 'failed', retryable: tx.chain.retryable }

    case 'optimistic': {
      const elapsed = now - tx.chain.submittedAt
      // A bad clock gets the spinner — the state that claims the least.
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

/** A block height as it renders. A block is a measurement; "3 days ago" from an untimed height is not. */
export function blockLabel(blockNumber: number): string {
  return `Block ${groupDigits(String(blockNumber))}`
}

/** The explorer link for a transaction, or `null` — never a bracketed link to a front page. */
export function voyagerTxUrl(transactionHash: string | null): string | null {
  return transactionHash ? `${NET.explorer}/tx/${transactionHash}` : null
}

// ── The one row projection ────────────────────────────────────────────────────────────────

/** One transaction as the app's row model. Pure data; the right slot is answered separately. */
export function activityRowModel(tx: Transaction, now: number): OptionRow {
  const base = {
    id: tx.id,
    title: rowTitle(tx),
  } satisfies Partial<OptionRow> & { id: string; title: string }

  if (tx.chain.state !== 'settled') {
    // The sentence goes in the subtitle, not the right slot: the slot is `flex: none` and a sentence
    // in it collapses the title column.
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

/** Our own label wins; a reconstructed row falls back to what the chain published. No third option. */
export function rowTitle(tx: Transaction): string {
  if (tx.label !== null) return tx.label
  return tx.chain.state === 'settled' ? ACTIVITY_KIND_LABELS[tx.chain.entry.kind] : 'Submitted'
}

// ── Category, direction ───────────────────────────────────────────────────────────────────

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

/**
 * The one place surface attribution is allowed: an unsettled row's `surface` is a record of what
 * THIS browser did. A settled row reads only `kind` and `mine`, never `label`.
 */
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
      // `markets` and `launch` have no disc of their own yet; `note` claims nothing.
      default:
        return 'note'
    }
  }

  const { entry } = tx.chain
  // Every owned kind is gated on `mine`: a stranger's deposit is a fact about the pool, not money
  // arriving in this book.
  switch (entry.kind) {
    case 'registration':
      return entry.mine ? 'registration' : 'note'
    case 'deposit':
      return entry.mine ? 'deposit' : 'note'
    case 'withdrawal':
      return entry.mine ? 'withdrawal' : 'note'
    case 'note-spent':
      return entry.mine ? 'sent' : 'note'
    case 'note-created':
    case 'open-note-created':
    case 'open-note-deposited':
      return entry.mine ? 'received' : 'note'
  }
}

/** `none` is not "zero" — it is the answer where a sign would be a claim. */
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

/** The amount this row moved, when the chain published one we can read. `null`, never a zero. */
export function rowAmountWei(tx: Transaction): bigint | null {
  return tx.chain.state === 'settled' ? tx.chain.entry.amount : null
}
