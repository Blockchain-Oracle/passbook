//
// The Finished section: one row per bet whose story has an ending. The same table/cards split as
// the live list, so the two read as one board. Amounts are what the chain said; `—` when it has
// not said. The whole row is the door to the receipt.
//
import { ChevronRight, ExternalLink } from 'lucide-react'
import type { MarketReceipt } from '@strk20/protocol/position-history'

import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

import { OUTCOME_LABEL, outcomeOf } from './history-copy'
import { receiptAmount, receiptSide, receiptStake, receiptTitle, type TokenList } from './receipt-describe'

export function Outcome({ receipt, tokens }: { receipt: MarketReceipt; tokens?: TokenList }) {
  const outcome = outcomeOf(receipt)
  if (!outcome) return null
  const won = outcome === 'claimed' || outcome === 'residual' || outcome === 'cashed-out' || outcome === 'refunded'
  const amount = receiptAmount(receipt, tokens)
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant="outline" className={cn(won && 'border-settled/40 text-settled', (outcome === 'lost' || outcome === 'reverted') && 'text-muted-foreground')}>
        {OUTCOME_LABEL[outcome]}
      </Badge>
      {amount ? <span className="font-mono tabular-nums text-body4">{amount}</span> : null}
    </span>
  )
}

function TxLink({ hash, label }: { hash: string | null; label: string }) {
  if (!hash) return <span className="text-muted-foreground">—</span>
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-mono text-accent1"
      onClick={(e) => e.stopPropagation()}
    >
      {label} {shortAddress(hash, 6, 4)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

export interface HistoryListProps {
  receipts: readonly MarketReceipt[]
  tokens?: TokenList
  onOpen: (receipt: MarketReceipt) => void
}

function HistoryTable({ receipts, tokens, onOpen }: HistoryListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-kicker uppercase">Bet</TableHead>
          <TableHead className="text-kicker uppercase">Side</TableHead>
          <TableHead className="text-right text-kicker uppercase">Stake</TableHead>
          <TableHead className="text-kicker uppercase">Outcome</TableHead>
          <TableHead className="text-kicker uppercase">Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {receipts.map((r) => (
          <TableRow key={r.commitment} className="cursor-pointer" onClick={() => onOpen(r)}>
            <TableCell className="max-w-xs">
              <span className="truncate font-medium">{receiptTitle(r)}</span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-body4">{receiptSide(r)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{receiptStake(r, tokens)}</TableCell>
            <TableCell>
              <Outcome receipt={r} tokens={tokens} />
            </TableCell>
            <TableCell className="whitespace-nowrap text-body4">
              <span className="flex flex-col gap-0.5">
                <TxLink hash={r.opening.txHash} label="opened" />
                {r.terminal?.txHash ? <TxLink hash={r.terminal.txHash} label="closed" /> : null}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HistoryCards({ receipts, tokens, onOpen }: HistoryListProps) {
  return (
    <div className="flex flex-col gap-3">
      {receipts.map((r) => (
        <button
          key={r.commitment}
          type="button"
          onClick={() => onOpen(r)}
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-raisedHovered"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{receiptTitle(r)}</span>
              <span className="text-body4 text-muted-foreground">
                {receiptSide(r)} · {receiptStake(r, tokens)}
              </span>
            </div>
            <Outcome receipt={r} tokens={tokens} />
          </div>
          <div className="flex items-end justify-between gap-3 text-body4">
            <TxLink hash={r.terminal?.txHash ?? r.opening.txHash} label={r.terminal?.txHash ? 'closed' : 'opened'} />
            <ChevronRight className="mb-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        </button>
      ))}
    </div>
  )
}

/** Container query, like the live list: the room the table actually has, not the window's. */
export function HistoryList({ receipts, tokens, onOpen }: HistoryListProps) {
  return (
    <div className="@container">
      <div className="hidden overflow-x-auto rounded-xl border bg-card @3xl:block">
        <HistoryTable receipts={receipts} tokens={tokens} onOpen={onOpen} />
      </div>
      <div className="@3xl:hidden">
        <HistoryCards receipts={receipts} tokens={tokens} onOpen={onOpen} />
      </div>
    </div>
  )
}
