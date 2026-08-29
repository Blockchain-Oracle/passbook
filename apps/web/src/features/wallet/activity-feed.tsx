import { useId, useState } from 'react'
import { ACTIVITY_EMPTY_NOTHING, FEED_UNREAD, FILTERED_ALL_HIDDEN, PERSONAL_FEED_EMPTY } from '@strk20/protocol/activity-copy'
import {
  HISTORY_GROUP_IN_PROGRESS,
  HISTORY_GROUP_OLDER,
  HISTORY_GROUP_RECENT,
  HISTORY_GROUP_WEEK,
} from '@strk20/protocol/history-copy'
import { activitySections, feedFor, visibleTransactions, type ActivityGroup, type Transaction } from '@strk20/protocol/transaction'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useNow } from '@/hooks/use-now'
import { ActivityRow } from './activity-row'
import type { WalletToken } from './rows'

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

/** This wallet's own record — the pool's global tape is not a wallet's business. Every row opens its receipt. */
export function ActivityFeed({ transactions, initialized, loading, headBlock, tokens, windowNote, problem }: FeedProps) {
  const [showSystem, setShowSystem] = useState(false)
  const now = useNow(CLOCK_MS)
  const switchId = useId()
  const visible = visibleTransactions(transactions, showSystem)
  const hidden = transactions.length - visible.length
  const view = feedFor('personal', visible, initialized, hidden)

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
          {activitySections(view.rows, headBlock).map((section) => (
            <div key={section.group} className="flex flex-col gap-2">
              <p className="text-kicker uppercase text-muted-foreground">{GROUP_LABEL[section.group]}</p>
              <ItemGroup className="gap-2">
                {section.rows.map((tx) => (
                  <ActivityRow key={tx.id} transaction={tx} now={now} tokens={tokens} />
                ))}
              </ItemGroup>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
