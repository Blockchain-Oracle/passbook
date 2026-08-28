//
// The thread: bubbles, payment cards, and the states a message can be in.
//
// ── THE PAYMENT CARD IS THE POINT OF THE WHOLE SURFACE ───────────────────────────────────
//
// A payment in a thread is a first-class bubble, never a link-out to somewhere else. That is the
// product claim — money reads as part of the conversation — and it is a claim about layout, so it
// is settled here rather than described anywhere.
//
// ── A CARD IS A CLAIM, AND IT IS RENDERED AS ONE ─────────────────────────────────────────
//
// Anyone holding the room key can seal a card that says any number. What makes it checkable is the
// transaction it names, so the hash is always on the card with a link out to the explorer, and the
// card never says "received" — it says what the sender claims and lets the chain settle it. A
// client that moved a balance on the strength of one of these would be a client with a hole in it.
//
// ── NOTHING IS EVER REMOVED FROM THE THREAD ──────────────────────────────────────────────
//
// A message this browser could not hand to the relay keeps its bubble and gains a line saying so.
// Deleting it would be the app quietly disagreeing with what the person just watched themselves
// type, which is worse than a visible failure by a wide margin.
//
import { useEffect, useRef } from 'react'

import { voyagerTxUrl } from '@strk20/protocol/transaction'
import type { RoomMessage } from '@strk20/protocol/room-message'

import { cn } from '../lib/cn'
import { Text } from './Text'
// The log's entry IS the thread's entry — `chat-log.ts` was written to the shape this file
// already rendered, so the store could replace React state without touching the bubble.
import type { ChatLogEntry } from '@strk20/protocol/chat-log'

/** A request's numbers, handed up when its Pay door is pressed. */
export interface PayableRequest {
  amount: string
  symbol: string
  token: string
}

export interface ChatThreadProps {
  entries: readonly ChatLogEntry[]
  /** Shown when there is nothing yet — different words before and after a room exists. */
  emptyNote: string
  /** The Pay door on THEIR request cards. Absent means the door does not render. */
  onPayRequest?: (request: PayableRequest) => void
  /** The react affordance on THEIR bubbles. Absent means no affordance. */
  onReact?: (targetId: string, emoji: string) => void
}

/** The react row's vocabulary — four, fixed. A picker would be a keyboard. */
const REACT_EMOJIS = ['👍', '❤️', '😂', '🔥'] as const

export function ChatThread({ entries, emptyNote, onPayRequest, onReact }: ChatThreadProps) {
  const bottom = useRef<HTMLDivElement>(null)

  //
  // REACTIONS ARE CHIPS, NEVER BUBBLES. One pass splits the log: reaction entries fold into a
  // map keyed by their target's id, everything else renders in order. A reaction whose target
  // this client does not hold folds into nothing — the correct fate for it.
  //
  const reactions = new Map<string, string[]>()
  const bubbles: ChatLogEntry[] = []
  for (const entry of entries) {
    if (entry.message.kind === 'reaction') {
      const held = reactions.get(entry.message.target) ?? []
      held.push(entry.message.emoji)
      reactions.set(entry.message.target, held)
    } else {
      bubbles.push(entry)
    }
  }

  // Follow the tail. `block: 'nearest'` rather than a scroll-to-bottom on the container: it keeps
  // a person who has scrolled up to read something from being yanked back down mid-sentence.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [entries.length])

  if (bubbles.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-1 items-center justify-center rounded-large bg-inset p-s16">
        <Text variant="body4" className="max-w-[280px] text-center text-neutral2">
          {emptyNote}
        </Text>
      </div>
    )
  }

  return (
    <div
      // The thread takes the room it deserves: roughly half the viewport, bounded — the old
      // 380px box made a conversation read through a letterbox.
      className="flex h-[52dvh] max-h-[560px] min-h-[240px] flex-col gap-s6 overflow-y-auto rounded-large bg-inset p-s12"
      role="log"
      aria-label="Messages"
      aria-live="polite"
    >
      {bubbles.map((entry) => (
        <Bubble
          key={entry.id}
          entry={entry}
          reactions={reactions.get(entry.id) ?? []}
          onPayRequest={onPayRequest}
          onReact={onReact}
        />
      ))}
      <div ref={bottom} />
    </div>
  )
}

function Bubble({
  entry,
  reactions,
  onPayRequest,
  onReact,
}: {
  entry: ChatLogEntry
  reactions: readonly string[]
  onPayRequest?: (request: PayableRequest) => void
  onReact?: (targetId: string, emoji: string) => void
}) {
  const { mine, message } = entry

  // Aggregated: four 👍 render as one chip with a count, not four chips.
  const counts = new Map<string, number>()
  for (const emoji of reactions) counts.set(emoji, (counts.get(emoji) ?? 0) + 1)

  return (
    <div className={cn('group flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div className="flex max-w-[85%] flex-col gap-s4">
        <div
          className={cn(
            // Radius 18 with the facing corner flattened to 4 — the design authority's chat
            // geometry. It is what makes a run of bubbles read as one side speaking.
            'rounded-[18px] border border-solid px-s12 py-s8',
            // STUDIO's sealed-room tints: mine is the lime wash with its hairline, theirs is a
            // plain raised bubble. A tint rather than solid lime, so a wall of my messages does
            // not shout.
            mine
              ? 'rounded-br-[4px] border-accent2Hovered bg-accent2 text-neutral1'
              : 'rounded-bl-[4px] border-transparent bg-raised text-neutral1',
          )}
        >
          <MessageBody message={message} mine={mine} />
          {message.kind === 'request' && !mine && onPayRequest ? (
            <button
              type="button"
              onClick={() => onPayRequest({ amount: message.amount, symbol: message.symbol, token: message.token })}
              className="focus-ring mt-s6 w-full cursor-pointer rounded-control bg-accent2 py-s6 text-buttonLabel4 text-accent1"
            >
              Pay {message.amount} {message.symbol}
            </button>
          ) : null}
        </div>

        {counts.size > 0 ? (
          <div className={cn('flex gap-s4', mine && 'justify-end')}>
            {[...counts.entries()].map(([emoji, count]) => (
              <span
                key={emoji}
                className="rounded-pill border border-solid border-surface3 bg-raised px-s6 py-s2 text-body4"
              >
                {emoji}
                {count > 1 ? ` ${count}` : ''}
              </span>
            ))}
          </div>
        ) : null}

        {/* The react row — theirs only, revealed on hover/focus, four fixed doors. */}
        {!mine && onReact ? (
          <div className="flex gap-s2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {REACT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React ${emoji}`}
                onClick={() => onReact(entry.id, emoji)}
                className="focus-ring cursor-pointer rounded-pill bg-transparent px-s4 py-s2 text-body4 hover:bg-raised"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {entry.undelivered ? (
          <Text variant="body4" className={cn('text-exposed', mine && 'text-right')}>
            {entry.undelivered}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

function MessageBody({ message, mine }: { message: RoomMessage; mine: boolean }) {
  if (message.kind === 'text') {
    // `whitespace-pre-wrap` so a message someone typed with line breaks arrives with them, and
    // `break-words` so a pasted address cannot push the bubble past the column.
    return (
      <Text variant="body3" className="whitespace-pre-wrap break-words">
        {message.text}
      </Text>
    )
  }

  // A 'post' belongs to open Talk rooms and never rides a pairwise thread; one arriving here is
  // a client speaking the wrong room's dialect, shown as unsupported rather than invented around.
  // A 'reaction' is filtered into chips before this renders, so reaching here is the same case.
  if (message.kind === 'unsupported' || message.kind === 'post' || message.kind === 'reaction') {
    return (
      <Text variant="body4" className={mine ? 'opacity-80' : 'text-neutral2'}>
        A message this version cannot show yet.
      </Text>
    )
  }

  if (message.kind === 'request') {
    return (
      <div className="flex flex-col gap-s4">
        <Text variant="body4" className={mine ? 'opacity-80' : 'text-neutral2'}>
          {mine ? 'You asked for' : 'They ask for'}
        </Text>
        <Text variant="subheading2" className="numeric">
          {message.amount} {message.symbol}
        </Text>
        {message.text ? (
          <Text variant="body4" className="whitespace-pre-wrap break-words">
            {message.text}
          </Text>
        ) : null}
        {/* No hash ON PURPOSE — nothing happened yet, and the card must not dress like a payment. */}
        <Text variant="body4" className={mine ? 'opacity-80' : 'text-neutral3'}>
          An ask, not a payment — nothing has moved.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-s4">
      <Text variant="body4" className={mine ? 'opacity-80' : 'text-neutral2'}>
        {mine ? 'You sent' : 'They say they sent'}
      </Text>
      <Text variant="subheading2" className="numeric">
        {message.amount} {message.symbol}
      </Text>
      {message.text ? (
        <Text variant="body4" className="whitespace-pre-wrap break-words">
          {message.text}
        </Text>
      ) : null}
      {/*
        THE HASH IS ALWAYS ON THE CARD. It is the difference between a number somebody typed and a
        payment anyone can check, and it is the only part of this card that is not a claim.

        `voyagerTxUrl` returns null for an empty hash, and a card with no link is not a case worth
        rendering — `decodeRoomMessage` refuses a payment without one, so this can only be a hash
        that is present but unusable, and an anchor to nowhere is worse than plain text.
      */}
      <a
        href={voyagerTxUrl(message.transactionHash) ?? undefined}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          'focus-ring numeric rounded-badge text-body4 underline underline-offset-2',
          mine ? 'opacity-80 hover:opacity-100' : 'text-neutral2 hover:text-neutral1',
        )}
      >
        Check it on chain ↗
      </a>
    </div>
  )
}
