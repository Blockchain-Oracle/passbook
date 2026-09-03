//
// What a mail can carry besides words and money: an ask, a voter handle, a finished bet. Each is
// a body kind (`mail-body.ts`), staged as a chip until the mail is sent.
//
import { ChartCandlestick, HandCoins, Landmark, X } from 'lucide-react'
import { toPlainText } from '@strk20/protocol/amount'
import type { PositionShare } from '@strk20/protocol/position-share'
import { shareQuestion } from '@strk20/protocol/position-share'

import { Amount } from '@/components/money/amount'
import { MoneyField } from '@/components/money/money-field'
import { TokenPicker } from '@/components/money/token-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription } from '@/components/ui/field'
import { useSendForm } from '@/features/send/use-send-form'
import { cn } from '@/lib/utils'

export type Attachment =
  | { kind: 'request'; token: string; symbol: string; decimals: number; wei: bigint; amountText: string }
  | { kind: 'handle'; handle: string; houseId: number; houseName: string }
  | { kind: 'market'; share: PositionShare }

export function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <div className="flex w-fit items-center gap-2 rounded-pill border border-exposed/40 bg-exposedTint px-3 py-1.5 text-exposed">
      {attachment.kind === 'request' ? <HandCoins className="size-3.5" aria-hidden /> : attachment.kind === 'handle' ? <Landmark className="size-3.5" aria-hidden /> : <ChartCandlestick className="size-3.5" aria-hidden />}
      <span className="max-w-64 truncate text-body4 font-medium">
        {attachment.kind === 'request' ? (
          <>
            Asking for <Amount wei={attachment.wei} decimals={attachment.decimals} symbol={attachment.symbol} size="sm" />
          </>
        ) : attachment.kind === 'handle' ? (
          `Voter handle · ${attachment.houseName}`
        ) : (
          shareQuestion(attachment.share)
        )}
      </span>
      <button type="button" onClick={onRemove} aria-label="Remove the attachment" className="opacity-70 transition-opacity hover:opacity-100">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** "Please send me this much." Nothing moves here, so nothing is checked against a balance. */
export function AskDialog({ open, onOpenChange, peer, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; peer: string; onPick: (a: Attachment) => void }) {
  const form = useSendForm({ to: peer })
  const { asset, parsed } = form
  const blocker = asset.decimals === null ? `${asset.symbol} has an unverified scale` : (parsed.problem ?? (parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : null))
  const pick = () => {
    if (blocker || parsed.wei === null || asset.decimals === null) return
    onPick({ kind: 'request', token: asset.address, symbol: asset.symbol, decimals: asset.decimals, wei: parsed.wei, amountText: toPlainText(parsed.wei, asset.decimals) })
    form.reset()
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-display4 uppercase">Ask for money</DialogTitle>
          <DialogDescription>Nothing moves. They get a card with a Pay button on it, filled in with these numbers.</DialogDescription>
        </DialogHeader>
        <Field>
          <TokenPicker
            tokens={form.assets.map((a) => ({ address: a.address, symbol: a.symbol, name: a.name, logoUri: a.logoUri, decimals: a.decimals }))}
            value={asset.address}
            onChange={form.setToken}
            className="w-full"
          />
          <MoneyField value={form.raw} onChange={form.setRaw} symbol={asset.symbol} decimals={asset.decimals} available={null} boundary="shielded" problem={parsed.problem} label="You ask for" autoFocus />
          <FieldDescription>An ask is a message, not a transaction. Nothing leaves your balance.</FieldDescription>
        </Field>
        <DialogFooter>
          <Button onClick={pick} aria-disabled={blocker ? true : undefined} className={cn(blocker && 'opacity-60')}>
            {blocker ?? 'Attach the ask'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
