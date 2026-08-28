//
// The history's presentation layer: what kind of thing a row is, which way its value moved, and
// which section it belongs in (Wave 1).
//
// ── THE TWO REFUSALS THIS FILE EXISTS TO PIN ─────────────────────────────────────────────
//
// 1. A settled row may never be given a surface it did not record. `transaction.ts`'s header calls
//    inferring intent from a nullifier "exactly the linkage the standing line says does not
//    exist" — so `activityCategory` reads `surface` only on rows THIS browser submitted.
//
// 2. A group header may never be a date. There are no timestamps in this data; the groups are
//    block distances, and `activityGroup` must keep answering in those terms.
//
import { describe, it, expect } from 'vitest'

import { FEE_NOT_READ, type ActivityBase, type ActivityEntry } from '../src/activity-entry.js'
import {
  ACTIVITY_GROUP_ORDER,
  BLOCKS_PER_DAY,
  BLOCKS_PER_WEEK,
  BLOCK_SECONDS,
  SYSTEM_NOTE_WEI,
  activityCategory,
  activityGroup,
  activitySections,
  amountDirection,
  orderTransactions,
  rowAmountWei,
  rowCounterparty,
  type Transaction,
} from '../src/transaction.js'
import { SECONDS_PER_BLOCK } from '../src/activity-window.js'

const HEAD = 13_412_880
const NOW = 1_700_000_000_000

function base(over: Partial<ActivityBase> = {}): ActivityBase {
  return {
    id: '0xabc-0',
    ordinal: 0,
    blockNumber: HEAD,
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

const settled = (entry: ActivityEntry, over: Partial<Transaction> = {}): Transaction => ({
  id: entry.id,
  chain: { state: 'settled', entry },
  surface: null,
  label: null,
  ...over,
})

const inFlight = (over: Partial<Transaction> = {}): Transaction => ({
  id: 'local-1',
  chain: { state: 'optimistic', submittedAt: NOW, stage: 'relay', transactionHash: null },
  surface: 'wallet',
  label: 'Send',
  ...over,
})

describe('the category is derived from what the chain published, never from intent', () => {
  it("our own spend is Sent and somebody else's is only a Note", () => {
    const mine = settled({ ...base({ mine: true }), kind: 'note-spent', nullifier: '0x1' })
    const theirs = settled({ ...base({ mine: false }), kind: 'note-spent', nullifier: '0x1' })
    expect(activityCategory(mine)).toBe('sent')
    expect(activityCategory(theirs)).toBe('note')
  })

  it('a note created for us is Received; one that is not ours is a Note', () => {
    const mine = settled({ ...base({ mine: true, amount: 5n }), kind: 'note-created', open: false })
    const theirs = settled({ ...base({ mine: false }), kind: 'note-created', open: false })
    expect(activityCategory(mine)).toBe('received')
    expect(activityCategory(theirs)).toBe('note')
  })

  it('the public boundary kinds keep their own names ONLY when they are ours', () => {
    // `markOwnAddress` is what establishes `mine` for these kinds. A stranger's deposit is a fact
    // about the pool, not money in this book — unowned, each degrades to `note`, which claims
    // nothing. The old behaviour rendered the deployer's deposits with `+` signs in every feed.
    expect(activityCategory(settled({ ...base({ mine: true }), kind: 'deposit' }))).toBe('deposit')
    expect(activityCategory(settled({ ...base({ mine: true }), kind: 'withdrawal' }))).toBe('withdrawal')
    expect(
      activityCategory(settled({ ...base({ mine: true }), kind: 'registration', publicKey: '0x9' })),
    ).toBe('registration')
    expect(activityCategory(settled({ ...base(), kind: 'deposit' }))).toBe('note')
    expect(activityCategory(settled({ ...base(), kind: 'withdrawal' }))).toBe('note')
    expect(
      activityCategory(settled({ ...base(), kind: 'registration', publicKey: '0x9' })),
    ).toBe('note')
  })

  it('a 1-wei companion is a system note whoever it belongs to', () => {
    const companion = settled({
      ...base({ mine: true, amount: SYSTEM_NOTE_WEI }),
      kind: 'note-created',
      open: false,
    })
    expect(activityCategory(companion)).toBe('system')
  })

  it('a settled row never borrows a surface, even when one is somehow set', () => {
    // `use-activity.ts` always publishes `surface: null`, and this is the assertion that keeps the
    // refusal true if some future writer forgets: the settled branch must not read the field.
    const withSurface = settled(
      { ...base({ mine: true }), kind: 'note-spent', nullifier: '0x1' },
      { surface: 'swap', label: 'Swap' },
    )
    expect(activityCategory(withSurface)).toBe('sent')
  })

  it('an in-flight row DOES use its surface, because this browser submitted it', () => {
    expect(activityCategory(inFlight({ surface: 'swap' }))).toBe('swap')
    expect(activityCategory(inFlight({ surface: 'bridge' }))).toBe('bridge')
    expect(activityCategory(inFlight({ surface: 'chat' }))).toBe('message')
    expect(activityCategory(inFlight({ surface: 'wallet' }))).toBe('sent')
    expect(activityCategory(inFlight({ surface: 'markets' }))).toBe('note')
    expect(activityCategory(inFlight({ surface: null }))).toBe('note')
  })
})

describe('direction is only claimed where a sign means something', () => {
  it('value in and value out — signs belong to OUR rows', () => {
    expect(amountDirection(settled({ ...base({ mine: true, amount: 5n }), kind: 'note-created', open: false }))).toBe('in')
    expect(amountDirection(settled({ ...base({ mine: true }), kind: 'deposit' }))).toBe('in')
    expect(amountDirection(settled({ ...base({ mine: true }), kind: 'note-spent', nullifier: '0x1' }))).toBe('out')
    expect(amountDirection(settled({ ...base({ mine: true }), kind: 'withdrawal' }))).toBe('out')
    // A stranger's boundary crossing carries no sign: it is not money moving relative to us.
    expect(amountDirection(settled({ ...base(), kind: 'deposit' }))).toBe('none')
    expect(amountDirection(settled({ ...base(), kind: 'withdrawal' }))).toBe('none')
  })

  it("a stranger's note, a registration and a system note carry no sign at all", () => {
    expect(amountDirection(settled({ ...base({ mine: false }), kind: 'note-created', open: false }))).toBe('none')
    expect(amountDirection(settled({ ...base(), kind: 'registration', publicKey: '0x9' }))).toBe('none')
    expect(
      amountDirection(
        settled({ ...base({ mine: true, amount: SYSTEM_NOTE_WEI }), kind: 'note-created', open: false }),
      ),
    ).toBe('none')
  })

  it('an unreadable amount stays null rather than becoming zero', () => {
    expect(rowAmountWei(settled({ ...base({ amount: null }), kind: 'note-created', open: false }))).toBeNull()
    expect(rowAmountWei(inFlight())).toBeNull()
    expect(rowAmountWei(settled({ ...base({ amount: 12n }), kind: 'deposit' }))).toBe(12n)
  })

  it('the counterparty is whatever the event named, and null on an in-flight row', () => {
    expect(rowCounterparty(settled({ ...base({ counterparty: '0xfeed' }), kind: 'deposit' }))).toBe('0xfeed')
    expect(rowCounterparty(inFlight())).toBeNull()
  })
})

describe('groups are block distances from the head, and never dates', () => {
  it('the block cadence here is the same number the window is sized with', () => {
    // The duplication is deliberate (see `BLOCK_SECONDS`' comment) and this is what keeps it from
    // drifting: when Starknet's block time falls again, both constants move or this fails.
    expect(BLOCK_SECONDS).toBe(SECONDS_PER_BLOCK)
    expect(BLOCKS_PER_WEEK).toBe(BLOCKS_PER_DAY * 7)
  })

  it('anything unsettled leads, whatever the head is', () => {
    expect(activityGroup(inFlight(), HEAD)).toBe('in-progress')
    expect(activityGroup(inFlight(), null)).toBe('in-progress')
    const failed: Transaction = {
      id: 'f1',
      chain: { state: 'failed', retryable: true, reason: 'the relayer refused' },
      surface: 'wallet',
      label: 'Send',
    }
    expect(activityGroup(failed, HEAD)).toBe('in-progress')
  })

  it('the three settled buckets fall on the day and week boundaries', () => {
    const at = (blockNumber: number) => settled({ ...base({ blockNumber }), kind: 'deposit' })
    expect(activityGroup(at(HEAD), HEAD)).toBe('recent')
    expect(activityGroup(at(HEAD - BLOCKS_PER_DAY), HEAD)).toBe('recent')
    expect(activityGroup(at(HEAD - BLOCKS_PER_DAY - 1), HEAD)).toBe('week')
    expect(activityGroup(at(HEAD - BLOCKS_PER_WEEK), HEAD)).toBe('week')
    expect(activityGroup(at(HEAD - BLOCKS_PER_WEEK - 1), HEAD)).toBe('older')
  })

  it('a row newer than the head is not an error state', () => {
    // The balance walk and the event read are a beat apart, so this happens in normal operation.
    expect(activityGroup(settled({ ...base({ blockNumber: HEAD + 4 }), kind: 'deposit' }), HEAD)).toBe('recent')
  })

  it('with no head read, settled rows go to `older` rather than inventing a distance', () => {
    expect(activityGroup(settled({ ...base(), kind: 'deposit' }), null)).toBe('older')
    expect(activityGroup(settled({ ...base(), kind: 'deposit' }), Number.NaN)).toBe('older')
  })
})

describe('sections preserve the feed order and omit empty groups', () => {
  const at = (id: string, blockNumber: number) =>
    settled({ ...base({ blockNumber, id, transactionHash: id }), kind: 'deposit' })

  it('cuts the ordered list into sections without resorting it', () => {
    const rows = orderTransactions([
      at('0x3', HEAD - BLOCKS_PER_WEEK - 10),
      at('0x2', HEAD - BLOCKS_PER_DAY - 10),
      at('0x1', HEAD),
      inFlight(),
    ])
    const sections = activitySections(rows, HEAD)
    expect(sections.map((section) => section.group)).toEqual(['in-progress', 'recent', 'week', 'older'])
    expect(sections.flatMap((section) => section.rows.map((row) => row.id))).toEqual(
      rows.map((row) => row.id),
    )
  })

  it('a group with nothing in it is left out, not rendered as an empty header', () => {
    const sections = activitySections([at('0x1', HEAD)], HEAD)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.group).toBe('recent')
    expect(activitySections([], HEAD)).toEqual([])
  })

  it('the group order is the one the sections are emitted in', () => {
    expect([...ACTIVITY_GROUP_ORDER]).toEqual(['in-progress', 'recent', 'week', 'older'])
  })
})
