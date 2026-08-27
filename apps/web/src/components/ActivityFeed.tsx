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
// ── AND THE TWO TABS NOW SAY DIFFERENT THINGS WHEN THEY ARE EMPTY ────────────────────────
//
// Both used to print "No activity yet", which is one sentence for two facts: a Global tab with
// nothing in it means the pool published nothing in the blocks we read, and a Personal tab with
// nothing in it means none of what it published was ours. Only the second has an action attached,
// and `history-copy.ts` carries both.
//
// ── THE ROWS ARE GROUPED, AND THE HEADERS ARE NOT DATES ──────────────────────────────────
//
// `activitySections` cuts the ordered list on block distance from the head, because a pool event
// carries a block number and no timestamp — `transaction.ts:387` refuses to invent the second from
// the first and this feed keeps that refusal. `HISTORY_GROUPING_NOTE` states the mechanism above
// the list, so nobody reads "About the last day" as a calendar claim.
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
  FEED_UNREAD,
  SURFACES_STANDING_LINE,
  SYSTEM_NOTES_HIDDEN,
  SYSTEM_NOTES_SHOWN,
} from '@strk20/protocol/activity-copy'
import {
  HISTORY_FILTERED_EMPTY,
  HISTORY_GLOBAL_EMPTY,
  HISTORY_GROUPING_NOTE,
  HISTORY_GROUP_IN_PROGRESS,
  HISTORY_GROUP_OLDER,
  HISTORY_GROUP_RECENT,
  HISTORY_GROUP_WEEK,
  HISTORY_PERSONAL_EMPTY,
} from '@strk20/protocol/history-copy'
import { getActivity, subscribe } from '@strk20/protocol/activity-store'
import {
  FEED_TAB_LABELS,
  activitySections,
  feedFor,
  visibleTransactions,
  type ActivityGroup,
  type FeedTab,
  type FeedView,
  type Transaction,
} from '@strk20/protocol/transaction'

import { ActivityRow } from './ActivityRow'

const TABS: readonly FeedTab[] = ['global', 'personal']

const isTab = (value: unknown): value is FeedTab => value === 'global' || value === 'personal'

/** The header for each section, from the copy module. Never derived from a date. */
const GROUP_LABEL: Record<ActivityGroup, string> = {
  'in-progress': HISTORY_GROUP_IN_PROGRESS,
  recent: HISTORY_GROUP_RECENT,
  week: HISTORY_GROUP_WEEK,
  older: HISTORY_GROUP_OLDER,
}

export interface ActivityFeedProps {
  /**
   * What a retryable failure does. Threaded rather than reached for, and absent today on purpose —
   * see `ActivityRow`. Whoever gains the ability to resubmit passes it from there.
   */
  onRetry?: (transaction: Transaction) => void
  /**
   * Why the last read failed, if it did.
   *
   * THREADED RATHER THAN DERIVED, because it cannot be derived. A failed read leaves the store
   * exactly as it found it — that is `publishRead`'s contract — so from in here a read that
   * errored and a read that never ran are the same `initialized: false`, and the five-state
   * grammar above has no arm for "we tried and could not". This is that arm.
   */
  problem?: string | null
  /**
   * Set when the rows are a window rather than the whole history.
   *
   * `PoolEventPage.complete` is where this comes from and its comment is the requirement: a feed
   * built on an incomplete page "is showing a window, not a history, and must say so". The rows
   * themselves carry no trace of what was left off the end, so the reader is told here.
   */
  windowNote?: string | null
  /**
   * The height the record was read beside — `ShieldedBalance.blockNumber`.
   *
   * The section boundaries are distances FROM this, so a feed given `null` puts every settled row
   * in the last group rather than inventing a distance from a number nobody read.
   */
  headBlock?: number | null
}

export function ActivityFeed({
  onRetry,
  problem = null,
  windowNote = null,
  headBlock = null,
}: ActivityFeedProps) {
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
    <section className="flex min-w-0 flex-col gap-s8">
      <h2 className="text-heading3">Activity</h2>

      {/*
        Disclosure as FURNITURE: the consequence is stated on the way past, in the header a reader
        crosses before the rows, rather than in a warning that fires after they have read them.
      */}
      <p className="text-body4 text-neutral2">{SURFACES_STANDING_LINE}</p>

      {/*
        BOTH SIT ABOVE THE TABS, crossed on the way to the rows rather than parked under them. A
        reader who has already concluded "there is nothing here" does not go looking for the line
        that would have corrected them.
      */}
      {problem ? (
        <p className="text-body3 text-exposed" role="status">
          {problem}
        </p>
      ) : null}
      {/* Named `windowNote`, not `window` — this is a browser module and shadowing that global
          inside a component is a trap set for whoever next reaches for `window.location`. */}
      {windowNote ? <p className="text-body4 text-neutral2">{windowNote}</p> : null}

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
          <Tabs.Panel key={key} value={key} className="flex flex-col gap-s8">
            {/*
              Rendered inside the panel rather than once outside, because the tab panel is what a
              screen reader lands in after activating a tab — content outside it is announced as
              belonging to neither.
            */}
            {/*
              `silenced` when a problem is already on screen: the unread note says "nothing has
              looked yet", which beside "the record could not be read" reads as two different
              explanations for one blank. The specific sentence wins.
            */}
            <FeedNote view={views[key]} silenced={problem !== null} />

            {views[key].rows.length ? (
              <>
                <p className="text-body4 text-neutral3">{HISTORY_GROUPING_NOTE}</p>
                {activitySections(views[key].rows, headBlock).map((section) => (
                  <div key={section.group} className="flex flex-col gap-s2">
                    {/*
                      NOT STICKY, and that is a decision rather than an omission. `.app-header` is
                      `position: sticky; top: 0` and it WRAPS — measured 165px at 320, 97px at 640,
                      57px at 1280 — so a section header pinned at `top: 0` would come to rest
                      underneath it at every width, which is worse than not pinning at all. Pinning
                      it correctly needs a per-breakpoint offset for a header whose height is a
                      function of the viewport; the sections are short enough that it buys little.
                    */}
                    <h3 className="py-s4 text-body4 text-neutral2">{GROUP_LABEL[section.group]}</h3>
                    {/*
                      A LIST, not a run of anchors. The rows are peers of one another and a reader
                      arriving by keyboard is told how many there are; `OptionRow.tsx`'s header
                      works through the same question for the palette and lands on explicit roles.
                    */}
                    <ul className="flex flex-col">
                      {section.rows.map((transaction) => (
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
                  </div>
                ))}
              </>
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
 * The Personal-empty note is keyed on the VIEW STATE rather than on the tab, which is what keeps
 * the two facts apart: `empty` means the window held nothing at all — a claim about the pool's
 * blocks, true on either tab — and `personal-empty` means the window held rows and none were ours.
 */
function FeedNote({ view, silenced = false }: { view: FeedView; silenced?: boolean }) {
  // ONLY the unread arm is silenced. `empty` and `filtered-empty` are facts a completed read
  // established, and a failed later read does not retract them.
  if (silenced && view.state === 'unread') return null

  const text =
    view.state === 'unread'
      ? FEED_UNREAD
      : view.state === 'empty'
        ? HISTORY_GLOBAL_EMPTY
        : view.state === 'filtered-empty'
          ? HISTORY_FILTERED_EMPTY
          : view.state === 'personal-empty'
            ? HISTORY_PERSONAL_EMPTY
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
