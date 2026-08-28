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
import { Text } from './ui/Text'
// The log's entry IS the thread's entry — `chat-log.ts` was written to the shape this file
// already rendered, so the store could replace React state without touching the bubble.
import type { ChatLogEntry } from '@strk20/protocol/chat-log'

export interface ChatThreadProps {
  entries: readonly ChatLogEntry[]
  /** Shown when there is nothing yet — different words before and after a room exists. */
  emptyNote: string
}

export function ChatThread({ entries, emptyNote }: ChatThreadProps) {
  const bottom = useRef<HTMLDivElement>(null)

  // Follow the tail. `block: 'nearest'` rather than a scroll-to-bottom on the container: it keeps
  // a person who has scrolled up to read something from being yanked back down mid-sentence.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-large bg-inset p-s16">
        <Text variant="body4" className="max-w-[280px] text-center text-neutral2">
          {emptyNote}
        </Text>
      </div>
    )
  }

  return (
    <div
      className="flex max-h-[380px] min-h-[200px] flex-col gap-s6 overflow-y-auto rounded-large bg-inset p-s12"
      role="log"
      aria-label="Messages"
      aria-live="polite"
    >
      {entries.map((entry) => (
        <Bubble key={entry.id} entry={entry} />
      ))}
      <div ref={bottom} />
    </div>
  )
}

function Bubble({ entry }: { entry: ChatLogEntry }) {
  const { mine, message } = entry
  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div className="flex max-w-[85%] flex-col gap-s4">
        <div
          className={cn(
            // Radius 18 with the facing corner flattened to 4 — the design authority's chat
            // geometry. It is what makes a run of bubbles read as one side speaking.
            'rounded-[18px] border border-solid px-s12 py-s8',
            // STUDIO's sealed-room tints: mine is the gold wash with its hairline, theirs is a
            // plain raised bubble. A tint rather than solid gold, so a wall of my messages does
            // not shout.
            mine
              ? 'rounded-br-[4px] border-accent2Hovered bg-accent2 text-neutral1'
              : 'rounded-bl-[4px] border-transparent bg-raised text-neutral1',
          )}
        >
          <MessageBody message={message} mine={mine} />
        </div>

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

  if (message.kind === 'unsupported') {
    return (
      <Text variant="body4" className={mine ? 'opacity-80' : 'text-neutral2'}>
        A message this version cannot show yet.
      </Text>
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
