import { RefreshCw } from 'lucide-react'
import { BOOK_EMPTY, BOOK_NOT_REGISTERED, BOOK_UNKNOWN, asOfBlock } from '@strk20/protocol/activity-copy'
import type { BookState } from '@strk20/protocol/balances'

import { Page } from '@/components/layout/page'
import { CrossingRail, PublicCard, ShieldedCard } from '@/components/money/balance-cards'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ActivityFeed } from './activity-feed'
import { CrossingActions } from './crossing-actions'
import { PoolHealthStrip } from './pool-health-strip'
import { useTransactions } from './transactions'
import { useWalletData } from './use-wallet-data'

const BOOK_SENTENCE: Record<BookState, string> = {
  'not-registered': BOOK_NOT_REGISTERED,
  'no-activity': BOOK_EMPTY,
  holdings: 'Holding notes.',
  unknown: BOOK_UNKNOWN,
}

const NOT_OPEN: Record<string, { title: string; body: string }> = {
  booting: { title: 'Opening this browser’s account', body: 'Reading what this browser holds.' },
  'no-storage': { title: 'No storage', body: 'This browser cannot keep an account.' },
  fresh: { title: 'No account yet', body: 'Create or import an account to read balances.' },
  locked: { title: 'Locked', body: 'Nothing was deleted and nothing moved. Unlock to read your balance and spend again.' },
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

/** Wallet home: the triptych, the crossing rail between, then the record. */
export function WalletHome() {
  const data = useWalletData()
  const feed = useTransactions(data.address, data.accountKey)
  const { session } = data

  if (session.status !== 'ready') {
    const copy = NOT_OPEN[session.status] ?? NOT_OPEN.fresh!
    return (
      <Page kicker="Money" title="Wallet">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-display4 uppercase">{copy.title}</CardTitle>
            <CardDescription>{session.reason ?? copy.body}</CardDescription>
          </CardHeader>
          {session.status === 'booting' ? (
            <CardContent>
              <RowsSkeleton />
            </CardContent>
          ) : null}
        </Card>
      </Page>
    )
  }

  const headline = data.shielded
    ? `${BOOK_SENTENCE[data.shielded.book]}${data.shielded.blockNumber !== null ? ` · ${asOfBlock(data.shielded.blockNumber)}` : ''}`
    : 'Reading the pool…'

  return (
    <Page
      kicker="Money"
      title="Wallet"
      description={session.label ? `@${session.label}` : undefined}
      actions={
        <>
          <BoundaryBadge kind="shieldedRound" />
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={data.refetch}>
            <RefreshCw className={data.loading ? 'animate-spin' : undefined} />
          </Button>
        </>
      }
    >
      <PoolHealthStrip />

      <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
        <ShieldedCard
          className="flex-1"
          rows={data.shieldedRows}
          headline={headline}
          loading={data.shielded === undefined && data.loading ? <RowsSkeleton /> : undefined}
        />
        <CrossingRail actions={<CrossingActions data={data} />} />
        <PublicCard
          className="flex-1"
          rows={data.publicRows}
          headline="ERC-20 balances at your Starknet address"
          loading={data.publicRows.every((row) => row.wei === undefined) && data.loading ? <RowsSkeleton /> : undefined}
        />
      </div>

      <ActivityFeed
        transactions={feed.transactions}
        initialized={feed.initialized}
        loading={feed.loading}
        headBlock={data.headBlock}
        tokens={data.tokens}
        windowNote={feed.read?.windowNote ?? null}
        problem={feed.problem}
      />
    </Page>
  )
}
