//
// The union, the two tabs, the filter, the order and the one row projection (story 6.6).
//
// Every row of the spec's I/O & Edge-Case Matrix has a case here. The two that matter most are the
// ones about what this module REFUSES to say: a filter may only hide what it can prove, and a row
// reconstructed from the public record may never claim a surface.
//
// ── THE FIXTURES DO NOT CAST ─────────────────────────────────────────────────────────────
//
// An earlier version built entries with `as ActivityEntry` and overrode discriminants with
// `as Partial<ActivityEntry>` — which meant adding, removing or re-typing a member of the union
// would not have failed a single test here. That is the exact drift the two `Assert<Ext<…>>`
// aliases in `activity.ts` were added to catch, undone one layer down. One factory per kind,
// each returning `ActivityEntry` with no assertion in sight.
//
import { describe, it, expect } from 'vitest'

import { FEE_NOT_READ, entryById, type ActivityBase, type ActivityEntry } from '../src/activity-entry.js'
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_SURFACES,
  NOT_INDEXED_AFTER_MS,
  SYSTEM_NOTE_WEI,
  activityRowModel,
  blockLabel,
  feedFor,
  isMine,
  isSystemNote,
  orderTransactions,
  receiptFor,
  rightSlot,
  rowTitle,
  visibleTransactions,
  voyagerTxUrl,
  type Transaction,
} from '../src/transaction.js'
import { NET } from '../src/constants.js'
import { NOT_YET_INDEXED, SYSTEM_NOTE_LABEL } from '../src/activity-copy.js'

const NOW = 1_700_000_000_000

function base(over: Partial<ActivityBase> = {}): ActivityBase {
  return {
    id: '0xabc-0',
    ordinal: 0,
    blockNumber: 13_412_880,
    transactionHash: '0xabc',
    mine: false,
    fee: FEE_NOT_READ,
    token: null,
    amount: null,
    counterparty: null,
    noteCommitment: null,
    ...over,
  }
}

const deposit = (over: Partial<ActivityBase> = {}): ActivityEntry => ({ ...base(over), kind: 'deposit' })
const noteCreated = (open: boolean, over: Partial<ActivityBase> = {}): ActivityEntry => ({
  ...base(over),
  kind: 'note-created',
  open,
})
const noteSpent = (nullifier: string, over: Partial<ActivityBase> = {}): ActivityEntry => ({
  ...base(over),
  kind: 'note-spent',
  nullifier,
})

function settled(entry: ActivityEntry, tx: Partial<Transaction> = {}): Transaction {
  return { id: entry.id, chain: { state: 'settled', entry }, surface: null, label: null, ...tx }
}

function maturing(entry: ActivityEntry, confirmed: number, required: number): Transaction {
  return {
    id: entry.id,
    chain: { state: 'settled', entry, maturation: { confirmed, required } },
    surface: null,
    label: null,
  }
}

function inFlight(over: Partial<Transaction> = {}, hash: string | null = null): Transaction {
  return {
    id: 'local-1',
    chain: { state: 'optimistic', submittedAt: NOW, stage: 'relay', transactionHash: hash },
    surface: 'swap',
    label: 'Swap',
    ...over,
  }
}

function failed(retryable: boolean, reason: string): Transaction {
  return { id: 'local-2', chain: { state: 'failed', retryable, reason }, surface: 'chat', label: 'Send' }
}

describe('the seven surfaces', () => {
  it('is closed at seven, in nav order — houses joined with the governance story', () => {
    expect(ACTIVITY_SURFACES).toEqual(['wallet', 'chat', 'swap', 'bridge', 'markets', 'launch', 'houses'])
  })

  it('labels every kind the record can hold', () => {
    expect(Object.keys(ACTIVITY_KIND_LABELS)).toHaveLength(7)
    expect(ACTIVITY_KIND_LABELS['note-spent']).toBe('Note spent')
  })
})

describe('surface attribution — the honesty invariant', () => {
  it('a reconstructed row carries no surface', () => {
    expect(settled(deposit()).surface).toBeNull()
  })

  it('nothing in the projection can invent one', () => {
    // The title of a reconstructed row comes from what the CHAIN published, never from a guess at
    // which of the six surfaces produced it. A `note-spent` is a swap, a bridge exit, a bet and a
    // chat payment all at once as far as the record is concerned.
    const row = activityRowModel(settled(noteSpent('0x1')), NOW)
    expect(row.title).toBe('Note spent')
    expect(JSON.stringify(row)).not.toMatch(/swap|bridge|markets|launch|chat/i)
  })

  it('but a row we started keeps the words its user used', () => {
    expect(rowTitle(settled(deposit(), { surface: 'swap', label: 'Swap 10 STRK for USDC' }))).toBe(
      'Swap 10 STRK for USDC',
    )
  })
})

describe('feedFor', () => {
  it('unread is not empty', () => {
    const view = feedFor('global', [], false)
    expect(view.state).toBe('unread')
    expect(view.rows).toEqual([])
  })

  it('a completed read that found nothing is empty', () => {
    expect(feedFor('global', [], true).state).toBe('empty')
  })

  it('a list the FILTER emptied is neither', () => {
    // The third way to reach a blank feed. Without its own state, hiding system notes in a range
    // that holds only system notes prints "No activity yet" — a claim about the chain, made
    // because of a switch the user flicked.
    expect(feedFor('global', [], true, 3).state).toBe('filtered-empty')
    expect(feedFor('personal', [], true, 3).state).toBe('filtered-empty')
    // And it never outranks unread: nothing was filtered out of a read that never ran.
    expect(feedFor('global', [], false, 3).state).toBe('unread')
  })

  it('Global shows everything', () => {
    const view = feedFor('global', [settled(deposit()), settled(deposit({ id: '0xdef-0', transactionHash: '0xdef' }))], true)
    expect(view.state).toBe('rows')
    expect(view.rows).toHaveLength(2)
  })

  it('Personal with rows of ours shows only those', () => {
    const mine = settled(deposit({ id: '0xdef-0', transactionHash: '0xdef', mine: true }))
    const view = feedFor('personal', [settled(deposit()), mine], true)
    expect(view.showing).toBe('personal')
    expect(view.rows).toEqual([mine])
  })

  it('Personal with nothing of ours falls back to Global', () => {
    const view = feedFor('personal', [settled(deposit())], true)
    expect(view.tab).toBe('personal')
    expect(view.showing).toBe('global')
    expect(view.state).toBe('personal-empty')
    expect(view.rows).toHaveLength(1)
  })

  it('Personal empty AND Global empty is the ordinary empty feed, not a fallback', () => {
    // The distinction is copy: `personal-empty` renders "showing everything the pool did instead",
    // which over an empty list is a sentence about a list that shows nothing.
    expect(feedFor('personal', [], true).state).toBe('empty')
  })

  it('an in-flight row is ours by construction', () => {
    const tx = inFlight()
    expect(isMine(tx)).toBe(true)
    expect(feedFor('personal', [tx], true).rows).toEqual([tx])
  })
})

describe('orderTransactions', () => {
  it('puts what we are waiting on first — an unsettled row has no block because it has not happened', () => {
    const old = settled(deposit({ id: 'a-0', transactionHash: 'a', blockNumber: 10 }))
    const recent = settled(deposit({ id: 'b-0', transactionHash: 'b', blockNumber: 20 }))
    const pending = inFlight()
    expect(orderTransactions([old, recent, pending]).map((t) => t.id)).toEqual(['local-1', 'b-0', 'a-0'])
  })

  it('breaks ties the way buildActivity does — block, then hash, then ordinal NUMERICALLY', () => {
    // `'0xtx-10' < '0xtx-2'` lexicographically, and a batch emitting ten decodable events is an
    // ordinary send with change notes rather than a corner case.
    const two = settled(deposit({ id: '0xtx-2', transactionHash: '0xtx', ordinal: 2, blockNumber: 5 }))
    const ten = settled(deposit({ id: '0xtx-10', transactionHash: '0xtx', ordinal: 10, blockNumber: 5 }))
    expect(orderTransactions([ten, two]).map((t) => t.id)).toEqual(['0xtx-2', '0xtx-10'])
  })

  it('is stable across two calls on the same data', () => {
    const rows = [settled(deposit({ id: 'a-0', transactionHash: 'a' })), inFlight(), failed(true, 'x')]
    expect(orderTransactions(rows)).toEqual(orderTransactions(orderTransactions(rows)))
  })

  it('feedFor applies it, so no caller has to remember to', () => {
    const old = settled(deposit({ id: 'a-0', transactionHash: 'a', blockNumber: 10 }))
    const recent = settled(deposit({ id: 'b-0', transactionHash: 'b', blockNumber: 20 }))
    expect(feedFor('global', [old, recent], true).rows.map((t) => t.id)).toEqual(['b-0', 'a-0'])
  })
})

describe('system notes', () => {
  const companion = settled(noteCreated(true, { id: '0x1-0', transactionHash: '0x1', amount: SYSTEM_NOTE_WEI }))
  const ordinary = settled(noteCreated(true, { id: '0x2-0', transactionHash: '0x2', amount: 5_000n }))
  const encrypted = settled(noteCreated(false, { id: '0x3-0', transactionHash: '0x3', amount: null }))

  it('recognises a 1-wei companion', () => {
    expect(isSystemNote(companion)).toBe(true)
    expect(isSystemNote(ordinary)).toBe(false)
  })

  it('NEVER hides a note whose amount it could not read', () => {
    // The failure this prevents: `amount === null` counting as a match would hide every encrypted
    // note in a Global feed the moment someone turned the filter off, and the feed would look like
    // the filter worked.
    expect(isSystemNote(encrypted)).toBe(false)
    expect(visibleTransactions([companion, ordinary, encrypted], false)).toEqual([ordinary, encrypted])
  })

  it('shows them when the filter is on', () => {
    expect(visibleTransactions([companion, ordinary], true)).toHaveLength(2)
  })

  it('labels the row with the exact sentence', () => {
    const row = activityRowModel(companion, NOW)
    expect(row.subtitle).toBe(SYSTEM_NOTE_LABEL)
    expect(row.tag).toBe('System note')
    expect(row.subtitleIsMono).toBe(false)
  })
})

describe('rightSlot', () => {
  it('an in-flight row spins, and names the stage rather than spinning anonymously', () => {
    expect(rightSlot(inFlight({}, '0xfeed'), NOW + 1_000)).toEqual({ kind: 'spinner', text: 'Relay' })
  })

  it('past the patience bound it says so, and links out', () => {
    expect(rightSlot(inFlight({}, '0xfeed'), NOW + NOT_INDEXED_AFTER_MS)).toEqual({
      kind: 'not-indexed',
      href: `${NET.explorer}/tx/0xfeed`,
    })
  })

  it('with no hash there is no link, rather than a link to nowhere', () => {
    expect(rightSlot(inFlight(), NOW + NOT_INDEXED_AFTER_MS)).toEqual({ kind: 'not-indexed', href: null })
    expect(voyagerTxUrl(null)).toBeNull()
  })

  it('and the sentence moves to the subtitle, where a sentence fits', () => {
    // In the right slot it would size the `flex: none` box to its own width and collapse the title
    // column — the row re-wraps on exactly the transition the reserve exists to prevent.
    expect(activityRowModel(inFlight(), NOW + NOT_INDEXED_AFTER_MS).subtitle).toBe(NOT_YET_INDEXED)
    expect(activityRowModel(inFlight(), NOW).subtitle).toBeUndefined()
  })

  it('an unusable clock claims the least, rather than reporting a transaction missing', () => {
    const tx = inFlight({ chain: { state: 'optimistic', submittedAt: Number.NaN, stage: 'prove', transactionHash: null } })
    expect(rightSlot(tx, NOW)).toEqual({ kind: 'spinner', text: 'Prove' })
  })

  it('a maturing note gets a STATIC ring and a block count, never a percentage', () => {
    expect(rightSlot(maturing(deposit(), 6, 10), NOW)).toEqual({
      kind: 'static-ring',
      text: 'Spendable in 4 more blocks.',
    })
  })

  it('a matured row shows its block, grouped', () => {
    expect(rightSlot(settled(deposit()), NOW)).toEqual({ kind: 'block', text: 'Block 13,412,880' })
    expect(blockLabel(9)).toBe('Block 9')
  })

  it('a maturation already complete is not a static ring', () => {
    expect(rightSlot(maturing(deposit(), 10, 10), NOW).kind).toBe('block')
  })

  it('a recoverable failure is retryable and a stop is not', () => {
    expect(rightSlot(failed(true, 'The relayer did not answer.'), NOW)).toEqual({ kind: 'failed', retryable: true })
    expect(rightSlot(failed(false, 'This deposit was not approved.'), NOW)).toEqual({ kind: 'failed', retryable: false })
  })

  it('carries the reason into the row rather than leaving the failure unexplained', () => {
    expect(activityRowModel(failed(true, 'The relayer did not answer.'), NOW).subtitle).toBe(
      'The relayer did not answer.',
    )
  })
})

describe('receiptFor — the lookup the route actually calls', () => {
  const rows = [settled(deposit()), settled(deposit({ id: '0xdef-1', transactionHash: '0xdef', ordinal: 1 }))]

  it('resolves an id', () => {
    const view = receiptFor(rows, '0xdef-1', true)
    expect(view.state).toBe('found')
    expect(view.state === 'found' && view.transaction.id).toBe('0xdef-1')
  })

  it('an unknown id after a read is NOT FOUND, not unread', () => {
    expect(receiptFor(rows, 'nope', true).state).toBe('not-found')
  })

  it('an unknown id before any read is UNREAD, not not-found', () => {
    // Two facts, two sentences. Before a read has run, an id we cannot find has not been looked
    // for — "no such entry" would be a claim about a record nobody consulted.
    expect(receiptFor([], 'anything', false).state).toBe('unread')
    expect(receiptFor(rows, '0xdef-1', false).state).toBe('unread')
  })

  it('never throws, including on the literal route param the build gate names', () => {
    // `/activity/$id` is a real string. A receipt route that raised on an id it did not recognise
    // would ship wearing `__error__` on every build.
    expect(() => receiptFor(rows, '$id', true)).not.toThrow()
    expect(receiptFor(rows, '$id', true).state).toBe('not-found')
    expect(() => receiptFor([], '', true)).not.toThrow()
  })

  it('and `entryById` still answers the same question over raw entries', () => {
    expect(entryById([deposit()], '0xabc-0')?.id).toBe('0xabc-0')
    expect(entryById([deposit()], '$id')).toBeUndefined()
  })
})

describe('the row projection', () => {
  it('puts a hash in the mono face and a sentence not', () => {
    const withCounterparty = activityRowModel(settled(deposit({ counterparty: '0x04f2' })), NOW)
    expect(withCounterparty.subtitle).toBe('0x04f2')
    expect(withCounterparty.subtitleIsMono).toBe(true)
  })

  it('falls back to the note commitment when there is no counterparty', () => {
    expect(activityRowModel(settled(deposit({ noteCommitment: '0x2867e2' })), NOW).subtitle).toBe('0x2867e2')
  })

  it('carries the maturing chip with its notYetReal channel intact', () => {
    expect(activityRowModel(maturing(deposit(), 6, 10), NOW).badge).toEqual({
      label: 'Maturing 6/10 blocks',
      status: 'neutral',
      notYetReal: true,
    })
  })

  it('holds no React node — the model is data, and search has to be able to read it', () => {
    const row = activityRowModel(settled(deposit({ counterparty: '0x04f2' })), NOW)
    for (const value of Object.values(row)) {
      expect(typeof value).not.toBe('function')
    }
  })
})
