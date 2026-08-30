import { useId, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ACTIVITY_EMPTY_NOTHING, FEED_UNREAD, FILTERED_ALL_HIDDEN, PERSONAL_FEED_EMPTY } from '@strk20/protocol/activity-copy'
import {
  HISTORY_GROUP_IN_PROGRESS,
  HISTORY_GROUP_OLDER,
  HISTORY_GROUP_RECENT,
  HISTORY_GROUP_WEEK,
} from '@strk20/protocol/history-copy'
import { activitySections, feedFor, visibleTransactions, type ActivityGroup, type Transaction } from '@strk20/protocol/transaction'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useNow } from '@/hooks/use-now'
import { useIdentities } from '@/queries/identity'
import { ActivityRow } from './activity-row'
import type { WalletToken } from './rows'
import { useActivityPage, type Paged } from './use-activity-page'

const GROUP_LABEL: Record<ActivityGroup, string> = {
  'in-progress': HISTORY_GROUP_IN_PROGRESS,
  recent: HISTORY_GROUP_RECENT,
  week: HISTORY_GROUP_WEEK,
  older: HISTORY_GROUP_OLDER,
}

/** One clock for every row, so the slots agree on what "now" is. */
const CLOCK_MS = 15_000

interface FeedProps {
  transactions: readonly Transaction[]
  initialized: boolean
  loading: boolean
  headBlock: number | null
  tokens: readonly WalletToken[]
  windowNote: string | null
  problem: string | null
}

function EmptyState({ state }: { state: 'unread' | 'empty' | 'filtered-empty' | 'personal-empty' }) {
  const text =
    state === 'unread'
      ? FEED_UNREAD
      : state === 'filtered-empty'
        ? FILTERED_ALL_HIDDEN
        : state === 'personal-empty'
          ? PERSONAL_FEED_EMPTY
          : ACTIVITY_EMPTY_NOTHING
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyTitle>{state === 'unread' ? 'Not read yet' : 'Nothing here'}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** `1–4 of 23`, and the two doors. Absent entirely when everything already fits on one page. */
function Pager({ paged }: { paged: Paged<Transaction> }) {
  if (paged.pages <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="font-mono text-mono text-muted-foreground" aria-live="polite">
        {paged.from}–{paged.to} of {paged.total}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={paged.prev} aria-disabled={!paged.hasPrev || undefined} aria-label="Previous page">
          <ChevronLeft data-icon="inline-start" aria-hidden />
          Prev
        </Button>
        <Button size="sm" variant="outline" onClick={paged.next} aria-disabled={!paged.hasNext || undefined} aria-label="Next page">
          Next
          <ChevronRight data-icon="inline-end" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/** This wallet's own record — the pool's global tape is not a wallet's business. Every row opens its receipt. */
export function ActivityFeed({ transactions, initialized, loading, headBlock, tokens, windowNote, problem }: FeedProps) {
  const [showSystem, setShowSystem] = useState(false)
  const now = useNow(CLOCK_MS)
  const switchId = useId()
  const visible = visibleTransactions(transactions, showSystem)
  const hidden = transactions.length - visible.length
  const view = feedFor('personal', visible, initialized, hidden)

  // The switch changes WHICH rows exist, so it resets to page one; a new transaction arriving does not.
  const paged = useActivityPage(view.rows, showSystem)

  // One directory read for the page, not one per row — four rows is at most four faces to fetch.
  const counterparties = useMemo(
    () =>
      paged.rows
        .map((tx) => (tx.chain.state === 'settled' ? tx.chain.entry.counterparty : null))
        .filter((address): address is string => address !== null),
    [paged.rows],
  )
  const identities = useIdentities(counterparties)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-display4 uppercase">Activity</h2>
          <p className="text-body4 text-muted-foreground">This wallet’s record. Open a row for its receipt.</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={showSystem} onCheckedChange={setShowSystem} />
          <Label htmlFor={switchId} className="text-body4 text-muted-foreground">
            System notes
          </Label>
        </div>
      </div>

      {problem ? (
        <p role="alert" className="text-body4 text-irreversible">
          {problem}
        </p>
      ) : null}
      {windowNote ? <p className="text-body4 text-muted-foreground">{windowNote}</p> : null}

      {loading && !initialized ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : view.state !== 'rows' ? (
        <EmptyState state={view.state} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Sections over the PAGE's rows: a heading appears only when this page holds rows for it. */}
          {activitySections(paged.rows, headBlock).map((section) => (
            <div key={section.group} className="flex flex-col gap-2">
              <p className="text-kicker uppercase text-muted-foreground">{GROUP_LABEL[section.group]}</p>
              <ItemGroup className="gap-2">
                {section.rows.map((tx) => (
                  <ActivityRow
                    key={tx.id}
                    transaction={tx}
                    now={now}
                    tokens={tokens}
                    identity={tx.chain.state === 'settled' && tx.chain.entry.counterparty ? identities[tx.chain.entry.counterparty] : undefined}
                  />
                ))}
              </ItemGroup>
            </div>
          ))}
          <Pager paged={paged} />
        </div>
      )}
    </section>
  )
}
