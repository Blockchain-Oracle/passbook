//
// Sharing a finished bet into a conversation. Only bets the chain has confirmed at both ends are
// offered, and the pick is followed by the same "what this reveals" screen the card export uses —
// the list first, then the send. Nothing in the message but the share DTO.
//
import { useState } from 'react'
import { ChartCandlestick } from 'lucide-react'
import { SHARE_OUTCOME, SHARE_SIDE, shareQuestion, shareUnits, type PositionShare } from '@strk20/protocol/position-share'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { shareOf } from '@/features/positions/receipt-describe'
import { useMarketHistory } from '@/features/positions/use-history'
import { useNow } from '@/hooks/use-now'
import { shortAddress } from '@/lib/format'

export interface ShareMarketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShare: (share: PositionShare) => void
}

const REVEALS_LINK = 'Anyone who sees this card can link you to this market.'

function reveals(s: PositionShare): string[] {
  const out = [
    `The market: ${shareQuestion(s)}`,
    `Your side: ${SHARE_SIDE[s.side] ?? `side ${s.side}`}`,
    `Your stake: ${shareUnits(s.cashIn, s.decimals, s.symbol)}`,
    s.terminal ? `The outcome: ${SHARE_OUTCOME[s.terminal.kind]}${s.terminal.amount ? ` ${shareUnits(s.terminal.amount, s.decimals, s.symbol)}` : ''}` : 'That the bet is still open',
    `The opening transaction: ${shortAddress(s.openingTxHash, 8, 6)}`,
  ]
  if (s.terminal?.txHash) out.push(`The closing transaction: ${shortAddress(s.terminal.txHash, 8, 6)}`)
  out.push(`The position's public commitment: ${shortAddress(s.commitment, 8, 6)}`)
  return out
}

export function ShareMarketDialog({ open, onOpenChange, onShare }: ShareMarketDialogProps) {
  const now = useNow(30_000)
  const history = useMarketHistory(now, open)
  const [picked, setPicked] = useState<PositionShare | null>(null)
  const shareable = history.finished.map((r) => shareOf(r, history.tokens)).filter((s): s is PositionShare => s !== null)
  const close = (next: boolean) => {
    if (!next) setPicked(null)
    onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {picked ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-display4 uppercase">What this reveals</DialogTitle>
              <DialogDescription>{REVEALS_LINK}</DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2 text-body4">
              {reveals(picked).map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-body4 text-muted-foreground">Not in the card: your address, your name, your other bets, your balances.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Back
              </Button>
              <Button
                onClick={() => {
                  onShare(picked)
                  setPicked(null)
                }}
              >
                Send the card
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-display4 uppercase">Share a finished bet</DialogTitle>
              <DialogDescription>Only bets the chain has confirmed at both ends are offered. The card is a claim they can check.</DialogDescription>
            </DialogHeader>
            {history.status === 'pending' ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : shareable.length === 0 ? (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyTitle>Nothing to share yet</EmptyTitle>
                  <EmptyDescription>A bet appears here once it has settled and the chain has confirmed both its transactions.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="gap-2">
                {shareable.map((s) => (
                  <Item key={s.commitment} variant="outline" size="sm" render={<button type="button" onClick={() => setPicked(s)} className="text-left" />}>
                    <ChartCandlestick className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <ItemContent className="min-w-0">
                      <ItemTitle className="truncate">{shareQuestion(s)}</ItemTitle>
                      <ItemDescription>
                        {SHARE_SIDE[s.side] ?? `Side ${s.side}`} · {shareUnits(s.cashIn, s.decimals, s.symbol)} ·{' '}
                        {s.terminal ? SHARE_OUTCOME[s.terminal.kind] : 'Still open'}
                        {s.terminal?.amount ? ` ${shareUnits(s.terminal.amount, s.decimals, s.symbol)}` : ''}
                      </ItemDescription>
                    </ItemContent>
                    <Button size="sm" variant="outline" render={<span />}>
                      Share
                    </Button>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
