//
// The store's invariants (story 6.6).
//
// THIS FILE EXISTS BECAUSE THE STORE MOVED HERE. It started under `apps/web/src/shell/`, where
// `vitest.config.ts:12` (`packages/*/test/**` only) means no runner would ever have loaded it —
// and its central fact is the kind that gets inverted in one word. Changing `initialized: false`
// to `true` makes `/wallet` announce that an unread pool is empty, which is precisely the claim
// the flag, `feedFor`, `FEED_UNREAD` and the copy test all exist to prevent, and nothing anywhere
// would have failed.
//
import { describe, it, expect, beforeEach } from 'vitest'

import {
  forgetActivityForAccountChange,
  getActivity,
  publishRead,
  recordLocal,
  resetActivityStore,
  subscribe,
} from '../src/activity-store.js'
import { FEE_NOT_READ, type ActivityEntry } from '../src/activity-entry.js'
import type { Transaction } from '../src/transaction.js'

const NOW = 1_700_000_000_000

function entry(id: string, transactionHash: string): ActivityEntry {
  return {
    id,
    ordinal: 0,
    blockNumber: 13_412_880,
    transactionHash,
    mine: false,
    fee: FEE_NOT_READ,
    token: null,
    amount: null,
    counterparty: null,
    noteCommitment: null,
    kind: 'deposit',
  }
}

const settled = (id: string, hash: string): Transaction => ({
  id,
  chain: { state: 'settled', entry: entry(id, hash) },
  surface: null,
  label: null,
})

const inFlight = (id: string, hash: string | null): Transaction => ({
  id,
  chain: { state: 'optimistic', submittedAt: NOW, stage: 'relay', transactionHash: hash },
  surface: 'swap',
  label: 'Swap',
})

beforeEach(resetActivityStore)

describe('unread is the starting state, and only a read leaves it', () => {
  it('a fresh store has not been read', () => {
    expect(getActivity()).toEqual({ transactions: [], initialized: false })
  })

  it('a completed read flips the flag', () => {
    publishRead([settled('a-0', 'a')])
    expect(getActivity().initialized).toBe(true)
  })

  it('a read that found NOTHING still counts as a read', () => {
    // The whole point: "we looked and there is nothing" is a different fact from "we have not
    // looked", and only the first may render `No activity yet`.
    publishRead([])
    expect(getActivity()).toEqual({ transactions: [], initialized: true })
  })

  it('recording something we did is NOT a read', () => {
    // A submission is not a consultation of the chain. Letting it flip the flag would turn "we
    // have not looked" into "the pool holds one thing" on the strength of our own action.
    recordLocal(inFlight('local-1', null))
    expect(getActivity().initialized).toBe(false)
    expect(getActivity().transactions).toHaveLength(1)
  })

  it('and the reset returns it to genuinely-unread', () => {
    publishRead([settled('a-0', 'a')])
    resetActivityStore()
    expect(getActivity()).toEqual({ transactions: [], initialized: false })
  })
})

describe('a row we submitted does not vanish because a read came back', () => {
  it('an in-flight row survives a read that cannot know about it', () => {
    // §11 checklist 9. A plain assignment breaks this on the first poll: the read returns what the
    // chain published, which by definition excludes the transaction the chain has not published.
    recordLocal(inFlight('local-1', null))
    publishRead([settled('a-0', 'a')])
    expect(getActivity().transactions.map((t) => t.id)).toEqual(['local-1', 'a-0'])
  })

  it('a failed row survives too — it is still something we started', () => {
    recordLocal({ id: 'local-2', chain: { state: 'failed', retryable: true, reason: 'x' }, surface: null, label: 'Send' })
    publishRead([])
    expect(getActivity().transactions.map((t) => t.id)).toEqual(['local-2'])
  })

  it('but it IS superseded once the read carries its transaction hash', () => {
    // Otherwise the same action occupies two rows forever. Matching is by HASH, not id: a settled
    // row's id is `<hash>-<ordinal>` and an optimistic row's is whatever minted it.
    recordLocal(inFlight('local-1', '0xfeed'))
    publishRead([settled('0xfeed-0', '0xfeed')])
    expect(getActivity().transactions.map((t) => t.id)).toEqual(['0xfeed-0'])
  })

  it('an in-flight row with no hash yet cannot be superseded, which is correct', () => {
    // Nothing in the read can be SHOWN to be it, and guessing would delete a row the user is
    // watching on the strength of a coincidence.
    recordLocal(inFlight('local-1', null))
    publishRead([settled('0xfeed-0', '0xfeed')])
    expect(getActivity().transactions).toHaveLength(2)
  })

  it('a second read replaces the settled rows rather than accumulating them', () => {
    publishRead([settled('a-0', 'a')])
    publishRead([settled('b-0', 'b')])
    expect(getActivity().transactions.map((t) => t.id)).toEqual(['b-0'])
  })

  it('recording the same local id twice replaces it rather than duplicating it', () => {
    recordLocal(inFlight('local-1', null))
    recordLocal(inFlight('local-1', '0xfeed'))
    const rows = getActivity().transactions
    expect(rows).toHaveLength(1)
    expect(rows[0]?.chain.state === 'optimistic' && rows[0].chain.transactionHash).toBe('0xfeed')
  })
})

describe('the snapshot contract useSyncExternalStore depends on', () => {
  it('two reads with nothing between them return the SAME object', () => {
    // A `getSnapshot` that mints a new object per call loops React forever. This is the assertion
    // that would have caught it, and there is no other way to find out short of a browser.
    expect(getActivity()).toBe(getActivity())
    publishRead([settled('a-0', 'a')])
    expect(getActivity()).toBe(getActivity())
  })

  it('a mutation produces a new identity, so subscribers actually re-render', () => {
    const before = getActivity()
    publishRead([settled('a-0', 'a')])
    expect(getActivity()).not.toBe(before)
  })

  it('notifies subscribers on both doors and stops on unsubscribe', () => {
    let count = 0
    const unsubscribe = subscribe(() => {
      count += 1
    })
    publishRead([settled('a-0', 'a')])
    recordLocal(inFlight('local-1', null))
    expect(count).toBe(2)

    unsubscribe()
    publishRead([])
    expect(count).toBe(2)
  })
})

describe('an account switch empties the store back to UNREAD (Wave 1)', () => {
  it('drops every row and un-initializes, rather than publishing an empty read', () => {
    publishRead([settled('a-0', 'a')])
    recordLocal(inFlight('local-1', null))
    expect(getActivity().initialized).toBe(true)

    forgetActivityForAccountChange()

    // UNREAD, not "read and empty". `mine` was computed against the previous account's registry,
    // so keeping the rows would classify one account's history under another's address — and
    // publishing an empty read instead would claim the new account has no history, which nobody
    // has checked. The `initialized` flag exists precisely to keep those two apart.
    expect(getActivity()).toEqual({ transactions: [], initialized: false })
  })

  it('keeps its listeners, unlike the test seam', () => {
    // `resetActivityStore` clears the listener set, which under mounted components leaves every
    // subscriber registered-but-forgotten. This runs in production with components mounted.
    let count = 0
    const unsubscribe = subscribe(() => {
      count += 1
    })
    publishRead([settled('a-0', 'a')])
    forgetActivityForAccountChange()
    publishRead([settled('b-0', 'b')])
    expect(count).toBe(3)
    unsubscribe()
  })

  it('is a no-op on a store that is already unread, so it cannot loop a subscriber', () => {
    let count = 0
    const unsubscribe = subscribe(() => {
      count += 1
    })
    const before = getActivity()
    forgetActivityForAccountChange()
    expect(getActivity()).toBe(before)
    expect(count).toBe(0)
    unsubscribe()
  })
})
