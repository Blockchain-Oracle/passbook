//
// One entry in the thread.
//
// A MONEY CARD IS NOT A BUBBLE. It gets its own frame, its own boundary badge and the amount at
// display size, because "0.5 STRK" inside a rounded speech bubble reads as somebody typing the
// words rather than value that actually moved.
//
// And a payment card is a CLAIM (`room-message.ts`), never a proof. The card says so and puts the
// transaction next to the claim so it can be checked, rather than asking to be believed.
//
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, CircleAlert, HandCoins, Landmark } from 'lucide-react'
import type { ChatLogEntry } from '@strk20/protocol/chat-log'
import type { RoomMessage } from '@strk20/protocol/room-message'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { IdentityAvatar } from '@/components/money/identity-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

import { MarketCard } from '@/components/share/market-card'
import type { PeerIdentity } from './use-peers'

type MoneyMessage = RoomMessage & { kind: 'payment' | 'request' }

export interface PayAsk {
  amount: string
  symbol: string
  token: string
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MoneyCard({
  message,
  mine,
  peer,
  identity,
  onPay,
}: {
  message: MoneyMessage
  mine: boolean
  peer: string
  identity: PeerIdentity | undefined
  onPay?: (ask: PayAsk) => void
}) {
  const isPayment = message.kind === 'payment'
  const title = isPayment ? (mine ? 'You sent' : 'They say they sent') : mine ? 'You asked for' : 'They ask for'
  return (
    <div className="flex min-w-[min(14rem,100%)] flex-col gap-2">
      <div className="flex items-center gap-2">
        {mine ? null : <IdentityAvatar address={peer} name={identity?.name} avatar={identity?.avatar} size="sm" />}
        <span className="text-kicker uppercase text-muted-foreground">{title}</span>
        <BoundaryBadge kind={isPayment ? 'shielded' : 'bearer'} className="ml-auto" />
      </div>

      <p className="font-mono text-display4 tabular-nums">
        {message.amount} {message.symbol}
      </p>
      {message.text ? <p className="text-body3">{message.text}</p> : null}

      {isPayment ? (
        <>
          <a
            className="inline-flex w-fit items-center gap-1 font-mono text-mono text-accent1 underline underline-offset-4"
            href={explorerTx(message.transactionHash)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(message.transactionHash, 8, 6)}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
          {mine ? null : (
            // Said plainly: the card is the sender's word, and the transaction is the thing to check.
            <p className="text-body4 text-muted-foreground">A card the sender wrote. The transaction above is what settles it.</p>
          )}
        </>
      ) : (
        <>
          {mine || !onPay ? null : (
            <Button
              size="sm"
              onClick={() => onPay({ amount: message.amount, symbol: message.symbol, token: message.token })}
            >
              <HandCoins data-icon="inline-start" aria-hidden />
              Pay {message.amount} {message.symbol}
            </Button>
          )}
          <p className="text-body4 text-muted-foreground">An ask, not a payment — nothing has moved.</p>
        </>
      )}
    </div>
  )
}

/**
 * A voter handle somebody handed over. The button is the point: it opens the House's own delegate
 * door with the handle already in it, so nobody retypes a felt.
 */
function HandleCard({ message, mine }: { message: RoomMessage & { kind: 'handle' }; mine: boolean }) {
  return (
    <div className="flex min-w-[min(14rem,100%)] flex-col gap-2">
      <div className="flex items-center gap-2">
        <Landmark className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-kicker uppercase text-muted-foreground">{mine ? 'You shared your handle' : 'Their voter handle'}</span>
      </div>
      <p className="text-body3">{message.houseName ?? `House #${message.houseId}`}</p>
      <p className="break-all font-mono text-mono text-muted-foreground">{message.handle}</p>
      {mine ? null : (
        <Button
          size="sm"
          render={
            <Link to="/houses/$id" params={{ id: String(message.houseId) }} search={{ delegate: message.handle }} />
          }
        >
          Delegate to them
        </Button>
      )}
      <p className="text-body4 text-muted-foreground">Holding a handle delegates nothing. You still sign your own escrow.</p>
    </div>
  )
}

function Body({
  message,
  mine,
  peer,
  identity,
  onPay,
}: {
  message: RoomMessage
  mine: boolean
  peer: string
  identity: PeerIdentity | undefined
  onPay?: (ask: PayAsk) => void
}) {
  switch (message.kind) {
    case 'text':
    case 'post':
      return <p className="whitespace-pre-wrap break-words text-body2">{message.text}</p>
    case 'payment':
    case 'request':
      return <MoneyCard message={message} mine={mine} peer={peer} identity={identity} onPay={onPay} />
    case 'handle':
      return <HandleCard message={message} mine={mine} />
    case 'market':
      return <MarketCard share={message.share} mine={mine} />
    default:
      return <p className="text-body3 text-muted-foreground">A message this version cannot show yet.</p>
  }
}

export interface MessageBubbleProps {
  entry: ChatLogEntry
  reactions: readonly string[]
  peer: string
  identity?: PeerIdentity
  /** Opens the composer's money door, prefilled from an ask. Absent on surfaces that cannot pay. */
  onPay?: (ask: PayAsk) => void
}

/** One entry. Reactions to it (folded by the caller) render as chips under the bubble. */
export function MessageBubble({ entry, reactions, peer, identity, onPay }: MessageBubbleProps) {
  // A card, not a bubble: money and handles are objects in the thread, not somebody typing.
  const money = entry.message.kind === 'payment' || entry.message.kind === 'request' || entry.message.kind === 'handle' || entry.message.kind === 'market'
  return (
    <div className={cn('flex max-w-[85%] flex-col gap-1', entry.mine ? 'items-end self-end' : 'items-start self-start')}>
      <div
        className={cn(
          'rounded-xl px-3 py-2',
          entry.mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
          money && 'border border-border bg-card p-3 text-card-foreground shadow-short',
        )}
      >
        <Body message={entry.message} mine={entry.mine} peer={peer} identity={identity} onPay={onPay} />
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
