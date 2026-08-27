//
// The record — the half of "a product named Passbook must render the book" that had no source.
//
// ── THE STORE HAD NO WRITER ──────────────────────────────────────────────────────────────
//
// `activity-store.ts` exports `publishRead`, `getActivity` and `subscribe`. `ActivityFeed` and the
// receipt route both READ it. Nothing anywhere in the repository ever called `publishRead` — a grep
// returned its own definition and nothing else — so the feed rendered `initialized: false` forever
// and said "we have not looked yet", which was true of the store and not of the chain.
//
// This is the writer. It is deliberately the ONLY one, so there is one answer to "where do the rows
// come from" rather than a row source per surface.
//
// ── THE RECORD IS BUILT FROM EVENTS, NOT FROM THE BALANCE WALK ───────────────────────────
//
// `discoverWallet` returns notes, a registry and a wallet — no activity entries at all. The record
// is `readPoolEvents` → `buildActivity`, a different read against a different thing. But it needs
// the walk's REGISTRY to know which rows are ours, so the two are welded: `useBalance` performs the
// single walk and hands the result here, and `personalKeysFrom` turns that registry into the note
// ids and nullifiers that make `mine` true.
//
// Without those keys `buildActivity` sets `mine: false` on every row — its own comment says so —
// and the Personal tab is empty beside a Global tab full of the user's own transactions. That is
// not a cosmetic difference: it is the difference between a passbook and a public ledger viewer.
//
// ── EVERY ROW READ THIS WAY IS `surface: null`, AND THAT IS LOAD-BEARING ─────────────────
//
// `transaction.ts` is explicit that `surface` is only for actions THIS BROWSER originated —
// "never inferred, never defaulted, never guessed from the row's kind". A row reconstructed from
// chain events was not originated here even when it is ours, so it carries `null` and the receipt
// renders the pool baseline rather than claiming a surface the chain never recorded. Guessing
// `swap` because a row looks like one is exactly the falsification that field is `null` to prevent.
//
// `label` is `null` for the same reason: a label is what the user called the action, and nobody
// called this anything — it was read back off events.
//
// ── AND THE READ IS A WINDOW, WHICH THE UI HAS TO SAY ────────────────────────────────────
//
// AD-14: no unbounded scans, so the record is the last `ACTIVITY_WINDOW_BLOCKS` and not the whole
// chain. `readRecentEvents` owns that policy — including the part that is easy to get backwards,
// which is that a truncated `readPoolEvents` holds the OLDEST events in its range rather than the
// newest, so a feed built naively on one shows last week and silently omits this morning. It
// narrows the window toward the head until the read fits, and reports whether it managed to.
//
// Two facts come back and they need two different sentences, which is what `windowNote` carries:
// a narrowed-but-complete read holds everything in its window, while a still-truncated one does
// not reach the present and must not be called "recent".
//
import { useCallback, useEffect, useState } from 'react'
import type { DiscoveryResult } from '@strk20/protocol/discovery'
// STATIC, unlike everything else this file reaches for. `ActivityFeed` and the receipt route both
// import the store statically and both are in the eager graph, so a dynamic import here would be
// the `INEFFECTIVE_DYNAMIC_IMPORT` the build gate rejects — the module is already in that chunk and
// asking for it lazily only splits the reference, never the code. It costs nothing to take it
// eagerly: the store's own imports are one `type`, so its runtime graph is empty.
import { publishRead } from '@strk20/protocol/activity-store'

export interface ActivityReadState {
  /** True while a read is in flight. The store keeps the previous rows meanwhile. */
  loading: boolean
  /** Set when the read could not complete. The feed keeps saying it does not know. */
  problem: string | null
  /**
   * A sentence when the rows are a window rather than the whole history, `null` when they are
   * everything in range. Never silently absent — a truncated feed that reads as complete is how
   * "your last transaction" becomes wrong with nothing having failed.
   */
  windowNote: string | null
  refresh: () => void
}

/**
 * Read the pool's events for this account and publish them into the store the feed reads.
 *
 * NEVER THROWS. A failed read leaves the store untouched, which matters more here than anywhere
 * else in the app: publishing an empty read would flip `initialized` to true and turn "we have not
 * looked" into "there is nothing here". `publishRead`'s own contract says a failed read must not
 * call it, and this is the caller that has to honour that.
 */
export function useActivity(
  read: DiscoveryResult | null,
  accountKey: string | null,
): ActivityReadState {
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [windowNote, setWindow] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    // A walk that did not complete has no registry, so there is nothing to tell ours from anyone
    // else's. Reading the pool anyway would publish a feed on which every row is Global — the
    // failure mode described in the header — so this waits instead.
    if (!accountKey || read === null || read.state !== 'walked') return

    let live = true
    setLoading(true)
    setProblem(null)

    void (async () => {
      // Lazy for the gate's reason: `activity-window` reaches `pool-events`, which imports
      // `starknet` for the selector hash, and `activity` reaches the privacy SDK for
      // `compute_note_id`. `/wallet` is the cold open and neither may be in its entry chunk.
      const [
        { readRecentEvents, describeSpan, ACTIVITY_WINDOW_BLOCKS },
        { buildActivity, personalKeysFrom },
        { deriveViewingKey },
        { NET },
      ] = await Promise.all([
        import('@strk20/protocol/activity-window'),
        import('@strk20/protocol/activity'),
        import('@strk20/protocol/identity'),
        import('@strk20/protocol/constants'),
      ])

      // Derived again rather than threaded out of `discoverWallet`, which does not return it. This
      // is a pure hash of material this browser already holds — cheaper than widening that seam,
      // and it keeps the session's viewing key out of one more object.
      const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)

      // `personalKeysFrom` THROWS on a registry claiming more note slots than any real account
      // holds — a hang guard, deliberately loud. Caught below with everything else, because a feed
      // that cannot identify its own rows is a failed read, not an empty one.
      const personal = personalKeysFrom(read.registry, viewingKey)

      // Amounts for the notes we hold, so a matched row can show its value. Rows whose notes are
      // not ours stay amount-less rather than borrowing a number from somewhere plausible.
      const amountsByNoteId = new Map(read.notes.map((note) => [note.id.toString(), note.amount]))

      // `read.blockNumber` is the height the walk was read BESIDE, so the feed and the balance
      // describe the same moment. Reading to the live head instead would put rows on screen that
      // the balance above them does not yet account for.
      const page = await readRecentEvents({ toBlock: read.blockNumber })
      if (!live) return

      const entries = buildActivity(page.events, { personal, amountsByNoteId })

      publishRead(
        entries.map((entry) => ({
          // The record's own id (`<hash>-<ordinal>`). Not re-derived here: `publishRead` supersedes
          // optimistic rows by transaction hash and de-duplicates by this id, so a second id scheme
          // would render the same transaction twice.
          id: entry.id,
          chain: { state: 'settled' as const, entry },
          // See the header. Neither of these may be guessed.
          surface: null,
          label: null,
        })),
      )

      // TWO DIFFERENT SENTENCES, because they are two different facts. A narrowed-but-complete
      // read holds everything that happened in its window; a still-truncated one holds the start
      // of its window and not the end, which is the case where "recent" would be a lie.
      //
      // The narrowed sentence NAMES THE SPAN rather than hedging with "recent". A reader who
      // cannot see how far back a list goes has no way to tell a quiet week from a short window,
      // and "recent" is exactly the word that lets those two be confused.
      setWindow(
        page.complete
          ? page.blocks < ACTIVITY_WINDOW_BLOCKS
            ? `This covers about ${describeSpan(page.blocks)}, not the usual week — the pool was ` +
              'busy enough that a longer view would not fit in one read.'
            : null
          : 'This list stops part-way through and does not reach the present. The pool returned ' +
            'more than one read can hold, so the most recent transactions are missing.',
      )
      setLoading(false)
    })().catch((error: unknown) => {
      if (!live) return
      // The store is left ALONE. See the doc comment: an unread feed and an empty one are different
      // claims, and this is the substitution that must never happen.
      setProblem(
        error instanceof Error && error.message
          ? `The record could not be read: ${error.message}`
          : 'The record could not be read.',
      )
      setLoading(false)
    })

    return () => {
      live = false
    }
  }, [read, accountKey, nonce])

  return { loading, problem, windowNote, refresh }
}
