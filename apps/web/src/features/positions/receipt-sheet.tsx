//
// One finished bet, in full: what it was, how it ended, and the two transactions. One screen;
// the disclosures fold behind the headline. Two doors: clear it from history (with the retired
// secret), and — when the chain has confirmed both ends — share it.
//
import { useState, type ReactNode } from 'react'
import { ExternalLink, Share2, Trash2 } from 'lucide-react'
import type { MarketReceipt } from '@strk20/protocol/position-history'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { explorerTx, shortAddress } from '@/lib/format'

import { CLEAR_ACTION, CLEAR_BODY, OPENING_UNKNOWN, OUTCOME_DETAIL, SHARE_ACTION, SHARE_UNAVAILABLE, outcomeOf, shareable } from './history-copy'
import { Outcome } from './history-list'
import { receiptSide, receiptStake, receiptTitle, type TokenList } from './receipt-describe'

export interface ReceiptSheetProps {
  receipt: MarketReceipt | null
  tokens?: TokenList
  onOpenChange: (open: boolean) => void
  onClear: (receipt: MarketReceipt) => Promise<void>
  onShare?: (receipt: MarketReceipt) => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-body4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono tabular-nums">{children}</span>
    </div>
  )
}

function Tx({ hash }: { hash: string | null }) {
  if (!hash) return <span className="text-muted-foreground">—</span>
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent1">
      {shortAddress(hash, 8, 6)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

export function ReceiptSheet({ receipt, tokens, onOpenChange, onClear, onShare }: ReceiptSheetProps) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const outcome = receipt ? outcomeOf(receipt) : null
  const canShare = receipt ? shareable(receipt) : false
  const close = (next: boolean) => {
    if (!next) setConfirming(false)
    onOpenChange(next)
  }
  return (
    <Sheet open={receipt !== null} onOpenChange={close}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        {receipt ? (
          <>
            <SheetHeader>
              <BoundaryBadge kind="bearer" className="w-fit" />
              <SheetTitle className="wrap-break-word font-display text-display4 uppercase">{receiptTitle(receipt)}</SheetTitle>
              <SheetDescription>{outcome ? OUTCOME_DETAIL[outcome] : receipt.opening.state === 'landed' ? 'Still open.' : OPENING_UNKNOWN}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col divide-y px-4">
              <Row label="Side">{receiptSide(receipt)}</Row>
              <Row label="Stake">{receiptStake(receipt, tokens)}</Row>
              <Row label="Outcome">
                <Outcome receipt={receipt} tokens={tokens} />
              </Row>
              <Row label="Opened">
                <Tx hash={receipt.opening.txHash} />
              </Row>
              {receipt.terminal && receipt.terminal.kind !== 'lost' ? (
                <Row label="Closed">
                  <Tx hash={receipt.terminal.txHash} />
                </Row>
              ) : null}
              <Row label="Commitment">{shortAddress(receipt.commitment, 8, 6)}</Row>
            </div>
            <SheetFooter className="flex-col gap-3">
              {confirming ? <p className="text-body4 text-muted-foreground">{CLEAR_BODY}</p> : null}
              {!canShare && onShare ? <p className="text-body4 text-muted-foreground">{SHARE_UNAVAILABLE}</p> : null}
              <div className="flex flex-wrap gap-2">
                {onShare ? (
                  <Button aria-disabled={!canShare || busy} onClick={() => canShare && !busy && onShare(receipt)}>
                    <Share2 data-icon="inline-start" />
                    {SHARE_ACTION}
                  </Button>
                ) : null}
                <Button
                  variant={confirming ? 'destructive' : 'outline'}
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return
                    if (!confirming) {
                      setConfirming(true)
                      return
                    }
                    setBusy(true)
                    void onClear(receipt).finally(() => {
                      setBusy(false)
                      setConfirming(false)
                    })
                  }}
                >
                  <Trash2 data-icon="inline-start" />
                  {confirming ? 'Clear for good' : CLEAR_ACTION}
                </Button>
                {confirming ? (
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Keep it
                  </Button>
                ) : null}
              </div>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
