import { useId, useState } from 'react'
import { ACTIVITY_EMPTY_NOTHING, FEED_UNREAD, FILTERED_ALL_HIDDEN, PERSONAL_FEED_EMPTY } from '@strk20/protocol/activity-copy'
import {
  HISTORY_GROUP_IN_PROGRESS,
  HISTORY_GROUP_OLDER,
  HISTORY_GROUP_RECENT,
  HISTORY_GROUP_WEEK,
} from '@strk20/protocol/history-copy'
import {
  FEED_TAB_LABELS,
  activitySections,
  feedFor,
  visibleTransactions,
  type ActivityGroup,
  type FeedTab,
  type Transaction,
} from '@strk20/protocol/transaction'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNow } from '@/hooks/use-now'
import { ActivityRow } from './activity-row'
import type { WalletToken } from './rows'

const GROUP_LABEL: Record<ActivityGroup, string> = {
  'in-progress': HISTORY_GROUP_IN_PROGRESS,
  recent: HISTORY_GROUP_RECENT,
  week: HISTORY_GROUP_WEEK,
  older: HISTORY_GROUP_OLDER,
}

const TABS: readonly FeedTab[] = ['personal', 'global']
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

/** Global / Personal on Tabs. Personal is the default — a wallet's own record comes first. */
export function ActivityFeed({ transactions, initialized, loading, headBlock, tokens, windowNote, problem }: FeedProps) {
  const [showSystem, setShowSystem] = useState(false)
  const now = useNow(CLOCK_MS)
  const switchId = useId()
  const visible = visibleTransactions(transactions, showSystem)
  const hidden = transactions.length - visible.length

  return (
    <section className="flex flex-col gap-3">
      <Tabs defaultValue="personal">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-display4 uppercase">Activity</h2>
            <TabsList>
              {TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {FEED_TAB_LABELS[tab]}
                </TabsTrigger>
              ))}
            </TabsList>
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

        {TABS.map((tab) => {
          const view = feedFor(tab, visible, initialized, hidden)
          return (
            <TabsContent key={tab} value={tab} className="pt-2">
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
            </TabsContent>
          )
        })}
      </Tabs>
    </section>
  )
}
