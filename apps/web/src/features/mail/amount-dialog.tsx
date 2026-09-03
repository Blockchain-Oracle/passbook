//
// What a mail carries, in money. Postage by default; more when there is something to pay.
//
// Nothing about money is re-implemented. `useSendForm` is the send surface's own form — the same
// asset list, the same parsing, the same shielded-balance and registration checks — asked for a
// single number instead of a whole page.
//
import { Stamp, X } from 'lucide-react'
import { toPlainText } from '@strk20/protocol/amount'
import { MAIL_POSTAGE_LABEL, MAIL_POSTAGE_NOTE } from '@strk20/protocol/mail-copy'
import { mailPostageWei } from '@strk20/protocol/send-mail'
import type { PayAsset } from '@strk20/protocol/pay-link'

import { Amount } from '@/components/money/amount'
import { MoneyField } from '@/components/money/money-field'
import { TokenPicker } from '@/components/money/token-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription } from '@/components/ui/field'
import { useSendForm } from '@/features/send/use-send-form'
import { cn } from '@/lib/utils'

/** The money a mail carries. `postage` is the default — the smallest note the reader can find it by. */
export interface MailMoney {
  token: string
  symbol: string
  decimals: number
  wei: bigint
  amountText: string
  postage: boolean
}

export interface AmountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  peer: string
  /** Prefill from an ask. Remount (key) to change it. */
  seed?: { asset?: PayAsset; amount?: string }
  onPick: (money: MailMoney) => void
}

export function AmountDialog({ open, onOpenChange, peer, seed, onPick }: AmountDialogProps) {
  const form = useSendForm({ to: peer, ...seed })
  const { asset, parsed } = form
  const decimals = asset.decimals
  const empty = form.raw.trim() === ''
  const postage = decimals === null ? null : mailPostageWei(decimals)
  const wei = empty ? postage : parsed.wei
  const short = wei !== null && asset.shieldedWei !== null && wei > asset.shieldedWei

  const blocker =
    decimals === null
      ? `${asset.symbol} has an unverified scale and cannot be sent`
      : (parsed.problem ?? (wei === null || wei === 0n ? 'Enter an amount, or leave it for postage' : short ? `Not enough shielded ${asset.symbol}` : null))

  const pick = () => {
    if (blocker || wei === null || decimals === null) return
    onPick({ token: asset.address, symbol: asset.symbol, decimals, wei, amountText: toPlainText(wei, decimals), postage: empty })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-display4 uppercase">Amount</DialogTitle>
          <DialogDescription>{MAIL_POSTAGE_NOTE}</DialogDescription>
        </DialogHeader>
        <Field>
          <TokenPicker
            tokens={form.assets.map((a) => ({ address: a.address, symbol: a.symbol, name: a.name, logoUri: a.logoUri, decimals: a.decimals }))}
            value={asset.address}
            onChange={form.setToken}
            className="w-full"
          />
          <MoneyField
            value={form.raw}
            onChange={form.setRaw}
            symbol={asset.symbol}
            decimals={decimals}
            available={asset.shieldedWei}
            boundary="shielded"
            problem={parsed.problem}
            label="You send"
            autoFocus
          />
          {empty && postage !== null ? (
            <FieldDescription>
              {MAIL_POSTAGE_LABEL}: <Amount wei={postage} decimals={decimals} symbol={asset.symbol} size="sm" />
            </FieldDescription>
          ) : null}
        </Field>
        <DialogFooter>
          <Button onClick={pick} aria-disabled={blocker ? true : undefined} className={cn(blocker && 'opacity-60')}>
            {blocker ?? (empty ? 'Use postage' : 'Attach')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The chip above the textarea: what this mail will carry. Postage is muted; real money is not. */
export function MoneyChip({ money, onEdit, onClear }: { money: MailMoney; onEdit: () => void; onClear: () => void }) {
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-2 rounded-pill border px-3 py-1.5',
        money.postage ? 'border-border text-muted-foreground' : 'border-accent1/40 bg-accent2 text-accent1',
      )}
    >
      <Stamp className="size-3.5" aria-hidden />
      <button type="button" onClick={onEdit} className="text-body4 font-medium">
        {money.postage ? `${MAIL_POSTAGE_LABEL} ` : 'Sending '}
        <Amount wei={money.wei} decimals={money.decimals} symbol={money.symbol} size="sm" />
      </button>
      {money.postage ? null : (
        <button type="button" onClick={onClear} aria-label="Back to postage" className="opacity-70 transition-opacity hover:opacity-100">
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
