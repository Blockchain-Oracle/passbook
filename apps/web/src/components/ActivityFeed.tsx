//
// The one feed (story 6.6, EXPERIENCE §2.3).
//
// ── FIVE STATES, NOT ONE BLANK ───────────────────────────────────────────────────────────
//
// There are three ways for this list to be empty and they are three different facts. Unread: no
// read has run, so "no activity yet" would be a claim about a chain nobody consulted. Empty: a
// read ran and found nothing. Filtered: the rows are here and hidden by a switch the user flicked.
// §5's cross-state rules require the `initialized` flag for the first; the third arrives through
// the same door and gets the same treatment. `feedFor` returns which applies, so the decision is
// data with a test behind it rather than a chain of ternaries in here.
//
// ── THE HEADER LINE IS THE AMENDED ONE, AND IT IS IMPORTED ───────────────────────────────
//
// `SURFACES_STANDING_LINE` says the six surfaces are unlinkable TO OTHER USERS, that this view is
// assembled in the browser, and that the auditor and the relayer see more. The original claim —
// that nobody can join them up — is false on this protocol and falsifiable in one call. It is
// imported rather than retyped because the same sentence appears on the balance tile and in the
// disclosure panel, and three hand-typed copies of a claim do not survive a redesign identical.
//
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Tabs } from '@base-ui/react/tabs'

import {
  ACTIVITY_EMPTY_NOTHING,
  FEED_UNREAD,
  FILTERED_ALL_HIDDEN,
  PERSONAL_FEED_EMPTY,
  SURFACES_STANDING_LINE,
  SYSTEM_NOTES_HIDDEN,
  SYSTEM_NOTES_SHOWN,
} from '@strk20/protocol/activity-copy'
import { getActivity, subscribe } from '@strk20/protocol/activity-store'
import {
  FEED_TAB_LABELS,
  feedFor,
  visibleTransactions,
  type FeedTab,
  type FeedView,
  type Transaction,
} from '@strk20/protocol/transaction'

import { ActivityRow } from './ActivityRow'

const TABS: readonly FeedTab[] = ['global', 'personal']

const isTab = (value: unknown): value is FeedTab => value === 'global' || value === 'personal'

export interface ActivityFeedProps {
  /**
   * What a retryable failure does. Threaded rather than reached for, and absent today on purpose —
   * see `ActivityRow`. Whoever gains the ability to resubmit passes it from there.
   */
  onRetry?: (transaction: Transaction) => void
}

export function ActivityFeed({ onRetry }: ActivityFeedProps) {
  const { transactions, initialized } = useSyncExternalStore(subscribe, getActivity)
  const [tab, setTab] = useState<FeedTab>('global')
  const [showSystemNotes, setShowSystemNotes] = useState(true)

  const visible = useMemo(
    () => visibleTransactions(transactions, showSystemNotes),
    [transactions, showSystemNotes],
  )
  const hiddenByFilter = transactions.length - visible.length

  // ONE VIEW PER PANEL, computed from that panel's own tab. Base UI unmounts the inactive panel by
  // default, so a single shared view happens to render correctly today — and would start rendering
  // Global rows inside the Personal panel the moment anyone set `keepMounted`.
  const views = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((key) => [key, feedFor(key, visible, initialized, hiddenByFilter)]),
      ) as Record<FeedTab, FeedView>,
    [visible, initialized, hiddenByFilter],
  )

  const now = useNow(views[tab].rows)
  const { settling, onSettleShown } = useSettleCue(transactions)

  return (
    <section className="flex flex-col gap-s8">
      <h2 className="text-heading3">Activity</h2>

      {/*
        Disclosure as FURNITURE: the consequence is stated on the way past, in the header a reader
        crosses before the rows, rather than in a warning that fires after they have read them.
      */}
      <p className="text-body4 text-neutral2">{SURFACES_STANDING_LINE}</p>

      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          // GUARDED, not cast. The library types this as `any`, so a cast would compile whatever
          // arrives — and a value that is neither tab would leave `feedFor` taking the Personal
          // branch for a tab nothing selected.
          if (isTab(value)) setTab(value)
        }}
        className="flex flex-col gap-s8"
      >
        <div className="activity-controls">
          <Tabs.List className="activity-tabs">
            {TABS.map((key) => (
              <Tabs.Tab key={key} value={key} className="activity-tab focus-ring">
                {FEED_TAB_LABELS[key]}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {/*
            THE FILTER SAYS WHICH WAY IT IS SET, not what pressing it would do (§5: "filterable with
            visible filter state"). A toggle labelled with its action leaves its state to be
            inferred from styling, and a filter whose state is invisible is how a reader concludes
            the feed lost rows. `aria-pressed` carries the same fact to a screen reader.
          */}
          <button
            type="button"
            className="activity-filter chip focus-ring"
            aria-pressed={showSystemNotes}
            onClick={() => setShowSystemNotes((on) => !on)}
          >
            {showSystemNotes ? SYSTEM_NOTES_SHOWN : SYSTEM_NOTES_HIDDEN}
          </button>
        </div>

        {TABS.map((key) => (
          <Tabs.Panel key={key} value={key} className="flex flex-col gap-s4">
            {/*
              Rendered inside the panel rather than once outside, because the tab panel is what a
              screen reader lands in after activating a tab — content outside it is announced as
              belonging to neither.
            */}
            <FeedNote view={views[key]} />

            {views[key].rows.length ? (
              // A LIST, not a run of anchors. The rows are peers of one another and a reader
              // arriving by keyboard is told how many there are; `OptionRow.tsx`'s header works
              // through the same question for the palette and lands on explicit roles.
              <ul className="activity-list">
                {views[key].rows.map((transaction) => (
                  <ActivityRow
                    key={transaction.id}
                    transaction={transaction}
                    now={now}
                    settling={settling === transaction.id}
                    onSettleShown={onSettleShown}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
            ) : null}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </section>
  )
}

/**
 * One left-aligned neutral sentence (§5's empty grammar). Never an illustration, never centred.
 *
 * The Personal-empty note is keyed on `showing !== tab` rather than on the state name, which makes
 * `FeedView.showing` the thing that decides the fallback rather than a field nobody reads.
 */
function FeedNote({ view }: { view: FeedView }) {
  const text =
    view.state === 'unread'
      ? FEED_UNREAD
      : view.state === 'empty'
        ? ACTIVITY_EMPTY_NOTHING
        : view.state === 'filtered-empty'
          ? FILTERED_ALL_HIDDEN
          : view.showing !== view.tab
            ? PERSONAL_FEED_EMPTY
            : null

  return text === null ? null : <p className="text-body3 text-neutral2">{text}</p>
}

/**
 * The clock, ticking only while something is waiting on it.
 *
 * `rightSlot` derives "submitted, not yet indexed" from elapsed time, so a row in flight needs the
 * component to come back and look. A row that has settled does not — and a permanent one-second
 * interval under a feed of settled rows is a wakeup per second for a value nothing reads.
 *
 * The tick is a whole second because the state it drives changes once, two minutes in. Nothing
 * here renders a running counter — that is the pipeline row's job, and it has width for a
 * sentence.
 */
function useNow(rows: readonly Transaction[]): number {
  const waiting = rows.some((tx) => tx.chain.state === 'optimistic')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [waiting])

  return now
}

/**
 * The one row that has just settled, held until its cue has actually played.
 *
 * ── THE CUE HAS TO OUTLIVE THE NEXT RENDER, AND THE OBVIOUS VERSION DOES NOT ─────────────
 *
 * The first draft derived the highlighted id during render by diffing against a ref the effect
 * then updated — so the very next render computed an empty diff and dropped the class, aborting
 * the animation. `useNow` guarantees such a render every second whenever anything is in flight, so
 * a 1.2s cue was routinely cut at 1.0s, and a tab click or a filter toggle cut it sooner. The id
 * is therefore STATE, set once when a settle is observed and cleared by the row's own
 * `animationend` — the browser reports when the cue is over, so nothing here has to guess.
 *
 * ── ONE AT A TIME, AND THE FIRST BATCH IS NOT ONE ────────────────────────────────────────
 *
 * EXPERIENCE §6 allows "one 1.2s attention highlight at a time app-wide", so a batch that settles
 * together highlights its first row. And the first observation SEEDS rather than celebrates: when
 * a read completes, every row it publishes is new to this component, and the naive version flashes
 * the whole feed on load — a cue for a transition that did not happen. Seeding waits for a settled
 * row to exist; a first batch of purely in-flight rows leaves the store unseeded, so the row that
 * settles out of it is a genuine transition and is treated as one.
 *
 * ── FED FROM THE STORE, NOT FROM THE VISIBLE ROWS ────────────────────────────────────────
 *
 * Diffing the filtered list would fire the cue when a tab switch or a filter toggle made an
 * already-settled row visible again, which is not a settle.
 */
function useSettleCue(transactions: readonly Transaction[]): {
  settling: string | null
  onSettleShown: () => void
} {
  const seen = useRef<Set<string> | null>(null)
  const [settling, setSettling] = useState<string | null>(null)

  useEffect(() => {
    const settled = transactions.filter((tx) => tx.chain.state === 'settled').map((tx) => tx.id)
    if (settled.length === 0) return

    if (seen.current === null) {
      seen.current = new Set(settled)
      return
    }

    const fresh = settled.filter((id) => !seen.current!.has(id))
    for (const id of settled) seen.current.add(id)
    // Only claim the cue when nothing else holds it — the app-wide "one at a time" rule, enforced
    // where the id is chosen rather than left to whichever row rendered first.
    if (fresh.length && settling === null) setSettling(fresh[0] ?? null)
  }, [transactions, settling])

  const onSettleShown = useCallback(() => setSettling(null), [])

  return { settling, onSettleShown }
}
