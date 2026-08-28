import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CircleAlert } from 'lucide-react'
import type { ChatLogEntry } from '@strk20/protocol/chat-log'
import type { RoomMessage } from '@strk20/protocol/room-message'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { explorerTx } from '@/lib/format'
import { cn } from '@/lib/utils'

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MoneyCard({ message, mine, peer }: { message: RoomMessage & { kind: 'payment' | 'request' }; mine: boolean; peer: string }) {
  const isPayment = message.kind === 'payment'
  const title = isPayment ? (mine ? 'You sent' : 'They say they sent') : mine ? 'You asked for' : 'They ask for'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-kicker uppercase text-muted-foreground">{title}</p>
      <p className="font-mono text-body1 tabular-nums">
        {message.amount} {message.symbol}
      </p>
      {message.text ? <p className="text-body3">{message.text}</p> : null}
      {isPayment ? (
        <a
          className="inline-flex items-center gap-1 text-body4 underline underline-offset-4"
          href={explorerTx(message.transactionHash)}
          target="_blank"
          rel="noreferrer"
        >
          Check it on chain <ArrowUpRight className="size-3" aria-hidden />
        </a>
      ) : (
        <>
          {mine ? null : (
            <Button size="sm" variant="outline" render={<Link to="/send" search={{ to: peer }} />}>
              Pay {message.amount} {message.symbol}
            </Button>
          )}
          <p className="text-body4 text-muted-foreground">An ask, not a payment — nothing has moved.</p>
        </>
      )}
    </div>
  )
}

function Body({ message, mine, peer }: { message: RoomMessage; mine: boolean; peer: string }) {
  switch (message.kind) {
    case 'text':
    case 'post':
      return <p className="whitespace-pre-wrap break-words text-body2">{message.text}</p>
    case 'payment':
    case 'request':
      return <MoneyCard message={message} mine={mine} peer={peer} />
    default:
      return <p className="text-body3 text-muted-foreground">A message this version cannot show yet.</p>
  }
}

/** One entry. Reactions to it (folded by the caller) render as chips under the bubble. */
export function MessageBubble({ entry, reactions, peer }: { entry: ChatLogEntry; reactions: readonly string[]; peer: string }) {
  const money = entry.message.kind === 'payment' || entry.message.kind === 'request'
  return (
    <div className={cn('flex max-w-[85%] flex-col gap-1', entry.mine ? 'self-end items-end' : 'self-start items-start')}>
      <div
        className={cn(
          'rounded-xl px-3 py-2',
          entry.mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          money && 'border border-border bg-card text-card-foreground',
        )}
      >
        <Body message={entry.message} mine={entry.mine} peer={peer} />
      </div>
      {reactions.length ? (
        <div className="flex gap-1">
          {reactions.map((emoji, i) => (
            <Badge key={`${emoji}-${i}`} variant="outline">
              {emoji}
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="flex items-center gap-1 text-body4 text-muted-foreground">
        {entry.undelivered ? (
          <>
            <CircleAlert className="size-3 text-irreversible" aria-hidden />
            <span className="text-irreversible">{entry.undelivered}</span>
          </>
        ) : (
          time(entry.at)
        )}
      </p>
    </div>
  )
}
