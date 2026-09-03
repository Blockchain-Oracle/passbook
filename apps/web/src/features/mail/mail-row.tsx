//
// One mail in a thread. The amount is the NOTE's — read from the pool and decrypted with the
// channel key — never a number the sender typed. The words are the memo, opened against that
// note. The chip says which of the two states it is in: opened, or refused to open.
//
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CircleAlert, HandCoins, Landmark, ShieldCheck } from 'lucide-react'
import { MAIL_AMOUNT_UNKNOWN, MAIL_REQUEST_PAY, MAIL_UNREADABLE, MAIL_UNREADABLE_HINT, MAIL_UNSUPPORTED, MAIL_VERIFIED } from '@strk20/protocol/mail-copy'
import type { MailBody } from '@strk20/protocol/mail-body'
import type { MailItem } from '@strk20/protocol/mail-discover'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

import { MarketCard } from '@/components/share/market-card'

export interface PayAsk {
  amount: string
  symbol: string
  token: string
}

/** Decimals and symbol for the note's token, as the wallet knows them; `null` decimals renders a dash. */
export interface TokenScale {
  symbol: string
  decimals: number | null
}

function Words({ body, mine, onPay }: { body: MailBody; mine: boolean; onPay?: (ask: PayAsk) => void }) {
  switch (body.kind) {
    case 'text':
      return <p className="whitespace-pre-wrap break-words text-body2">{body.text}</p>
    case 'request':
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-kicker uppercase text-muted-foreground">
            <HandCoins className="size-3.5" aria-hidden />
            {mine ? 'You asked for' : 'They ask for'}
          </div>
          <p className="font-mono text-display4 tabular-nums">
            {body.amount} {body.symbol}
          </p>
          {body.text ? <p className="text-body3">{body.text}</p> : null}
          {mine || !onPay ? null : (
            <Button size="sm" onClick={() => onPay({ amount: body.amount, symbol: body.symbol, token: body.token })}>
              <HandCoins data-icon="inline-start" aria-hidden />
              {MAIL_REQUEST_PAY} {body.amount} {body.symbol}
            </Button>
          )}
          <p className="text-body4 text-muted-foreground">An ask, not a payment — only the postage above moved.</p>
        </div>
      )
    case 'handle':
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-kicker uppercase text-muted-foreground">
            <Landmark className="size-3.5" aria-hidden />
            {mine ? 'You shared your handle' : 'Their voter handle'}
          </div>
          <p className="text-body3">{body.houseName ?? `House #${body.houseId}`}</p>
          <p className="break-all font-mono text-mono text-muted-foreground">{body.handle}</p>
          {body.text ? <p className="text-body3">{body.text}</p> : null}
          {mine ? null : (
            <Button size="sm" render={<Link to="/houses/$id" params={{ id: String(body.houseId) }} search={{ delegate: body.handle }} />}>
              Delegate to them
            </Button>
          )}
          <p className="text-body4 text-muted-foreground">Holding a handle delegates nothing. You still sign your own escrow.</p>
        </div>
      )
    case 'market':
      return (
        <div className="flex flex-col gap-2">
          <MarketCard share={body.share} mine={mine} />
          {body.text ? <p className="text-body3">{body.text}</p> : null}
        </div>
      )
    case 'unsupported':
      return <p className="text-body3 text-muted-foreground">{MAIL_UNSUPPORTED}</p>
  }
}

export function MailRow({ item, scale, onPay }: { item: MailItem; scale: TokenScale; onPay?: (ask: PayAsk) => void }) {
  const mine = item.direction === 'out'
  const card = item.body !== null && item.body.kind !== 'text'
  return (
    <div className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'items-end self-end' : 'items-start self-start')}>
      <div
        className={cn(
          'flex min-w-[min(14rem,100%)] flex-col gap-2 rounded-xl px-3 py-2',
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          (card || item.status !== 'verified') && 'border border-border bg-card p-3 text-card-foreground shadow-short',
        )}
      >
        {/* The money first: it is the fact the words ride on. */}
        <div className="flex items-center gap-2">
          <span className={cn('text-kicker uppercase', mine && !card && item.status === 'verified' ? 'opacity-80' : 'text-muted-foreground')}>{mine ? 'You sent' : 'You received'}</span>
          {item.amount === null ? (
            <Tooltip>
              <TooltipTrigger render={<span className="font-mono text-body3" />}>—</TooltipTrigger>
              <TooltipContent>{MAIL_AMOUNT_UNKNOWN}</TooltipContent>
            </Tooltip>
          ) : (
            <Amount wei={item.amount} decimals={scale.decimals} symbol={scale.symbol} size="sm" className={mine && !card ? 'text-primary-foreground' : undefined} />
          )}
        </div>
        {item.body ? (
          <Words body={item.body} mine={mine} onPay={onPay} />
        ) : (
          <p className="flex items-start gap-1 text-body3 text-irreversible">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {MAIL_UNREADABLE}. {MAIL_UNREADABLE_HINT}
            </span>
          </p>
        )}
      </div>
      <p className="flex items-center gap-2 text-body4 text-muted-foreground">
        {item.status === 'verified' ? (
          <Badge variant="outline" className="gap-1 border-settled/40 text-settled">
            <ShieldCheck className="size-3" aria-hidden />
            {MAIL_VERIFIED}
          </Badge>
        ) : null}
        <a className="inline-flex items-center gap-1 font-mono text-mono" href={explorerTx(item.transactionHash)} target="_blank" rel="noreferrer">
          {shortAddress(item.transactionHash, 6, 4)}
          <ArrowUpRight className="size-3" aria-hidden />
        </a>
        <span className="font-mono">#{item.blockNumber.toLocaleString()}</span>
      </p>
    </div>
  )
}
