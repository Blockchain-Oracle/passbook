//
// Money, staged in the composer the way a file is staged before you send it.
//
// The thread's old "Send money" button navigated to `/send`, which is the opposite of attaching:
// you left the conversation, paid, and came back to a thread that never mentioned it. Here the
// amount is composed BESIDE the message and travels with it.
//
// Nothing about money is re-implemented. `useSendForm` is the send surface's own form — the same
// asset list, the same parsing, the same shielded-balance and registration checks — asked for a
// single number instead of a whole page.
//
import { HandCoins, Send, X } from 'lucide-react'
import { toPlainText } from '@strk20/protocol/amount'
import type { PayAsset } from '@strk20/protocol/pay-link'

import { Amount } from '@/components/money/amount'
import { MoneyField } from '@/components/money/money-field'
import { TokenPicker } from '@/components/money/token-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription } from '@/components/ui/field'
import { useSendForm } from '@/features/send/use-send-form'
import { cn } from '@/lib/utils'

/** What the composer is holding. `payment` moves value on send; `request` never does. */
export interface MoneyAttachment {
  kind: 'payment' | 'request'
  token: string
  symbol: string
  decimals: number | null
  wei: bigint
  /** Already rendered, so the card the peer receives does not re-derive this token's scale. */
  amountText: string
}

const TITLE = { payment: 'Attach money', request: 'Ask for money' } as const
const BLURB = {
  payment:
    'It moves when you send the message, and the card in the thread points at the transaction it settled in.',
  request: 'Nothing moves. They get a card with a Pay button on it, filled in with these numbers.',
} as const
const ACTION = { payment: 'Attach', request: 'Attach the ask' } as const

export interface AttachMoneyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: MoneyAttachment['kind']
  /** The peer, so the form resolves the same recipient the send surface would. */
  peer: string
  /** Prefill, when the dialog was opened by paying somebody's ask. Remount to change it. */
  seed?: { asset?: PayAsset; amount?: string }
  onAttach: (attachment: MoneyAttachment) => void
}

export function AttachMoneyDialog({ open, onOpenChange, kind, peer, seed, onAttach }: AttachMoneyDialogProps) {
  const form = useSendForm({ to: peer, ...seed })
  const { asset, parsed } = form

  // An ask carries no value, so it is not gated on holding any: only a payment must be affordable,
  // and only a payment needs a recipient the pool will accept a note for.
  const unregistered = kind === 'payment' && form.recipient.state === 'unregistered'
  const blocker =
    parsed.problem ??
    (parsed.wei === null || parsed.wei === 0n
      ? 'Enter an amount'
      : kind === 'payment' && form.short
        ? `Not enough shielded ${asset.symbol}`
        : unregistered
          ? 'They have not registered with the pool yet'
          : null)

  const attach = () => {
    if (blocker || parsed.wei === null) return
    onAttach({
      kind,
      token: asset.address,
      symbol: asset.symbol,
      decimals: asset.decimals,
      wei: parsed.wei,
      amountText: asset.decimals !== null ? toPlainText(parsed.wei, asset.decimals) : String(parsed.wei),
    })
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-display4 uppercase">{TITLE[kind]}</DialogTitle>
          <DialogDescription>{BLURB[kind]}</DialogDescription>
        </DialogHeader>
        <Field>
          <TokenPicker
            tokens={form.assets.map((a) => ({
              address: a.address,
              symbol: a.symbol,
              name: a.name,
              logoUri: a.logoUri,
              decimals: a.decimals,
            }))}
            value={asset.address}
            onChange={form.setToken}
            className="w-full"
          />
          <MoneyField
            value={form.raw}
            onChange={form.setRaw}
            symbol={asset.symbol}
            decimals={asset.decimals}
            available={asset.shieldedWei}
            boundary="shielded"
            problem={parsed.problem}
            label={kind === 'payment' ? 'You send' : 'You ask for'}
            autoFocus
          />
          {kind === 'request' ? <FieldDescription>An ask is a message, not a transaction. Nothing leaves your balance.</FieldDescription> : null}
          {unregistered ? <FieldDescription>{form.recipient.state === 'unregistered' ? form.recipient.door.message : ''}</FieldDescription> : null}
        </Field>
        <DialogFooter>
          <Button onClick={attach} aria-disabled={blocker ? true : undefined} className={cn(blocker && 'opacity-60')}>
            {blocker ?? ACTION[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The staged chip above the textarea — the visible difference between composing and having sent. */
export function AttachmentChip({ attachment, onRemove }: { attachment: MoneyAttachment; onRemove: () => void }) {
  const paying = attachment.kind === 'payment'
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-2 rounded-pill border px-3 py-1.5',
        paying ? 'border-accent1/40 bg-accent2 text-accent1' : 'border-exposed/40 bg-exposedTint text-exposed',
      )}
    >
      {paying ? <Send className="size-3.5" aria-hidden /> : <HandCoins className="size-3.5" aria-hidden />}
      <span className="text-body4 font-medium">
        {paying ? 'Sending' : 'Asking for'} <Amount wei={attachment.wei} decimals={attachment.decimals} symbol={attachment.symbol} size="sm" />
      </span>
      <button type="button" onClick={onRemove} aria-label="Remove the attachment" className="opacity-70 transition-opacity hover:opacity-100">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
