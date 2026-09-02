//
// The composer: a message, and whatever is attached to it.
//
// One row of controls, an attachment tray above the text, and a send button whose LABEL changes
// when money is staged — so "Send" never quietly means "move 0.5 STRK". The shape is the standard
// chat-composer one (21st's Input Bar): staged chips over an auto-sizing field, actions either side.
//
import { useRef, type KeyboardEvent } from 'react'
import { ChartCandlestick, HandCoins, Landmark, Paperclip, Send, SendHorizontal } from 'lucide-react'

import { Amount } from '@/components/money/amount'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { AttachmentChip, type MoneyAttachment } from './money-attachment'

export interface ComposerProps {
  draft: string
  onDraft: (next: string) => void
  attachment: MoneyAttachment | null
  onAttach: (kind: MoneyAttachment['kind']) => void
  onRemoveAttachment: () => void
  onSubmit: () => void
  /** Offers the voter handle. Absent where there is nothing to delegate with. */
  onShareHandle?: () => void
  /** Offers a finished bet as a card. Absent on surfaces without a position history. */
  onShareMarket?: () => void
  /** Why sending is blocked, in a sentence. The button stays pressable and says why. */
  blocker: string | null
  busy: boolean
}

export function Composer({ draft, onDraft, attachment, onAttach, onRemoveAttachment, onSubmit, onShareHandle, onShareMarket, blocker, busy }: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null)

  // Money is a decision, never a keystroke: Enter sends text, but a staged amount needs the button.
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !attachment) {
      event.preventDefault()
      onSubmit()
    }
  }

  const sending = attachment?.kind === 'payment'
  const asking = attachment?.kind === 'request'

  return (
    <footer className="flex flex-col gap-2 border-t p-3">
      {attachment ? <AttachmentChip attachment={attachment} onRemove={onRemoveAttachment} /> : null}

      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon" variant="outline" aria-label="Attach money" />}
            disabled={attachment !== null || undefined}
          >
            <Paperclip aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => onAttach('payment')}>
              <Send aria-hidden />
              Send money
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAttach('request')}>
              <HandCoins aria-hidden />
              Ask for money
            </DropdownMenuItem>
            {onShareHandle ? (
              <DropdownMenuItem onClick={onShareHandle}>
                <Landmark aria-hidden />
                Share my voter handle
              </DropdownMenuItem>
            ) : null}
            {onShareMarket ? (
              <DropdownMenuItem onClick={onShareMarket}>
                <ChartCandlestick aria-hidden />
                Share a finished bet
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea
          ref={field}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={attachment ? 'Say what it is for — optional' : 'Write — it seals before it leaves'}
          aria-invalid={blocker && !attachment ? true : undefined}
          className="min-h-9 resize-none"
        />

        {attachment ? (
          // A money send never hides behind an icon. The number is on the button that does it.
          <Button onClick={onSubmit} aria-disabled={blocker ? true : undefined} className={cn('shrink-0', blocker && 'opacity-60')}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {sending ? 'Send ' : asking ? 'Ask for ' : ''}
            <Amount wei={attachment.wei} decimals={attachment.decimals} symbol={attachment.symbol} size="sm" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={onSubmit}
            aria-disabled={blocker ? true : undefined}
            className={cn('shrink-0', blocker && 'opacity-60')}
            aria-label="Send"
          >
            {busy ? <Spinner /> : <SendHorizontal aria-hidden />}
          </Button>
        )}
      </div>

      {blocker ? (
        <p role="status" className="text-body4 text-muted-foreground">
          {blocker}
        </p>
      ) : null}
    </footer>
  )
}
