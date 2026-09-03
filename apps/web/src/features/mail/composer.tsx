//
// The composer: the words, the money they ride with, and one button that says what it costs.
//
// There is no free send. Every mail is a pool transaction, so the button always names an amount —
// postage when nothing is being paid — and Enter never sends: a mail is a decision, not a keystroke.
//
import { ChartCandlestick, HandCoins, Landmark, Paperclip, Stamp } from 'lucide-react'
import { MAIL_COMPOSE_PLACEHOLDER, MAIL_SEND_CTA, MAIL_SHARE_BET, MAIL_SHARE_HANDLE, MAIL_ASK_FOR_MONEY, MAIL_TOO_LONG } from '@strk20/protocol/mail-copy'
import { MAX_MAIL_PLAINTEXT_BYTES } from '@strk20/protocol/mail-envelope'

import { Amount } from '@/components/money/amount'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { MoneyChip, type MailMoney } from './amount-dialog'
import { AttachmentChip, type Attachment } from './attachment'

export interface ComposerProps {
  draft: string
  onDraft: (next: string) => void
  /** Bytes the body will occupy sealed, for the counter. */
  bytes: number
  money: MailMoney | null
  onEditMoney: () => void
  onClearMoney: () => void
  attachment: Attachment | null
  onAttach: (kind: 'request' | 'handle' | 'market') => void
  onRemoveAttachment: () => void
  onSubmit: () => void
  /** Why sending is blocked, in a sentence. The button stays pressable and says why. */
  blocker: string | null
  busy: boolean
}

export function Composer(p: ComposerProps) {
  const over = p.bytes > MAX_MAIL_PLAINTEXT_BYTES
  return (
    <footer className="flex flex-col gap-2 border-t p-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.money ? (
          <MoneyChip money={p.money} onEdit={p.onEditMoney} onClear={p.onClearMoney} />
        ) : (
          <Button size="sm" variant="outline" onClick={p.onEditMoney}>
            <Stamp data-icon="inline-start" aria-hidden />
            Amount
          </Button>
        )}
        {p.attachment ? <AttachmentChip attachment={p.attachment} onRemove={p.onRemoveAttachment} /> : null}
      </div>

      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon" variant="outline" aria-label="Attach" />} disabled={p.attachment !== null || undefined}>
            <Paperclip aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem onClick={() => p.onAttach('request')}>
              <HandCoins aria-hidden />
              {MAIL_ASK_FOR_MONEY}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => p.onAttach('handle')}>
              <Landmark aria-hidden />
              {MAIL_SHARE_HANDLE}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => p.onAttach('market')}>
              <ChartCandlestick aria-hidden />
              {MAIL_SHARE_BET}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea
          value={p.draft}
          onChange={(e) => p.onDraft(e.target.value)}
          rows={1}
          placeholder={MAIL_COMPOSE_PLACEHOLDER}
          aria-invalid={over ? true : undefined}
          className="min-h-9 resize-none"
        />

        {/* The number is on the button that spends it — a mail never hides its cost behind an icon. */}
        <Button onClick={p.onSubmit} aria-disabled={p.blocker ? true : undefined} className={cn('shrink-0', p.blocker && 'opacity-60')}>
          {p.busy ? <Spinner data-icon="inline-start" /> : null}
          {MAIL_SEND_CTA}
          {p.money ? (
            <>
              {' · '}
              <Amount wei={p.money.wei} decimals={p.money.decimals} symbol={p.money.symbol} size="sm" />
            </>
          ) : null}
        </Button>
      </div>

      <p role="status" className={cn('text-body4', over ? 'text-irreversible' : 'text-muted-foreground')}>
        {over ? MAIL_TOO_LONG : p.blocker}
        <span className="float-right font-mono tabular-nums">
          {p.bytes}/{MAX_MAIL_PLAINTEXT_BYTES}
        </span>
      </p>
    </footer>
  )
}
