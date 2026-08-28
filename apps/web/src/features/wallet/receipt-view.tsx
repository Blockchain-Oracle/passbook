import { Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import {
  FEE_UNREADABLE,
  RECEIPT_NOT_FOUND,
  RECEIPT_NOT_YET_ON_CHAIN,
  RECEIPT_NO_COUNTERPARTY,
  RECEIPT_NOT_A_NOTE,
  FEED_UNREAD,
} from '@strk20/protocol/activity-copy'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'
import { ACTIVITY_KIND_LABELS, blockLabel, receiptFor, rowTitle, type Transaction } from '@strk20/protocol/transaction'

import { Page } from '@/components/layout/page'
import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Receipt } from '@/components/money/receipt'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerTx } from '@/lib/format'
import { boundaryFor, useTransactions } from './transactions'
import { useWalletData } from './use-wallet-data'
import type { WalletToken } from './rows'

function Back() {
  return (
    <Button variant="ghost" size="sm" render={<Link to="/wallet" />}>
      <ArrowLeft data-icon="inline-start" />
      Wallet
    </Button>
  )
}

function Unsettled({ tx }: { tx: Transaction }) {
  const chain = tx.chain
  if (chain.state === 'settled') return null
  const hash = chain.transactionHash ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-display4 uppercase">{rowTitle(tx)}</CardTitle>
        <CardDescription>
          {chain.state === 'failed' ? chain.reason : `${STAGE_TITLES[chain.stage]} — ${RECEIPT_NOT_YET_ON_CHAIN}`}
        </CardDescription>
      </CardHeader>
      {hash ? (
        <CardContent>
          <Button variant="outline" size="sm" render={<a href={explorerTx(hash)} target="_blank" rel="noreferrer" />}>
            View on explorer
            <ExternalLink data-icon="inline-end" />
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}

function Settled({ tx, tokens }: { tx: Transaction; tokens: readonly WalletToken[] }) {
  if (tx.chain.state !== 'settled') return null
  const { entry } = tx.chain
  const token = entry.token ? tokens.find((row) => sameFelt(row.token, entry.token!)) : undefined
  const fee = entry.fee
  return (
    <Receipt
      title={rowTitle(tx)}
      transactionHash={entry.transactionHash}
      boundary={boundaryFor(tx)}
      explorerUrl={explorerTx(entry.transactionHash)}
      rows={[
        { label: 'Kind', value: ACTIVITY_KIND_LABELS[entry.kind] },
        { label: 'Block', value: blockLabel(entry.blockNumber) },
        { label: 'Amount', value: <Amount wei={entry.amount} decimals={token?.decimals ?? null} symbol={token?.symbol} /> },
        { label: 'Token', value: entry.token ? (token?.symbol ?? entry.token) : '—' },
        { label: 'Counterparty', value: entry.counterparty ?? RECEIPT_NO_COUNTERPARTY },
        { label: 'Note', value: entry.noteCommitment ?? RECEIPT_NOT_A_NOTE },
        {
          label: 'Fee',
          value:
            fee.state === 'charged' ? (
              <Amount wei={fee.amountWei} decimals={fee.unit === 'unknown' ? null : 18} symbol={fee.unit === 'FRI' ? 'STRK' : fee.unit === 'WEI' ? 'ETH' : undefined} />
            ) : (
              FEE_UNREADABLE
            ),
        },
        { label: 'Yours', value: entry.mine ? 'Yes' : 'No' },
      ]}
    />
  )
}

/** `/activity/$id`: the row's receipt, resolved with `receiptFor` so an unknown id is never a crash. */
export function ReceiptView({ id }: { id: string }) {
  const data = useWalletData()
  const feed = useTransactions(data.address, data.accountKey)
  const view = receiptFor(feed.transactions, id, feed.initialized || feed.transactions.length > 0)
  // A settled receipt's card carries its own badge; every other state is the pool's record, so the header says so.
  const headerBoundary = view.state !== 'found' ? 'shielded' : view.transaction.chain.state === 'settled' ? null : boundaryFor(view.transaction)

  return (
    <Page
      kicker="Money"
      title="Receipt"
      actions={
        <>
          {headerBoundary ? <BoundaryBadge kind={headerBoundary} /> : null}
          <Back />
        </>
      }
    >
      {view.state === 'found' ? (
        view.transaction.chain.state === 'settled' ? (
          <Settled tx={view.transaction} tokens={data.tokens} />
        ) : (
          <Unsettled tx={view.transaction} />
        )
      ) : view.state === 'unread' ? (
        feed.loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Not read yet</CardTitle>
              <CardDescription>{feed.problem ?? FEED_UNREAD}</CardDescription>
            </CardHeader>
          </Card>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No such entry here</CardTitle>
            <CardDescription>{RECEIPT_NOT_FOUND}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </Page>
  )
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}
