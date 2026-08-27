//
// The sidebar: every conversation this browser remembers.
//
// ── THE ROW LIVES HERE, NOT IN ITS OWN FILE ──────────────────────────────────────────────
//
// A row that only ever appears in one list is not a module. `OptionRow` earned its own file
// because six different lists render it; this one has exactly one caller and splitting it would
// mean two files to open to answer "what does the sidebar look like".
//
// ── A RELATIVE TIMESTAMP IS HONEST HERE, AND IS NOT IN THE ACTIVITY FEED ─────────────────
//
// The activity feed refuses "3 days ago" because a pool event carries a block number and nothing
// timed it. `ChatLogEntry.at` is different: it is `Date.now()` at the moment THIS browser saw the
// message, recorded by this browser. It is not a claim about when the sender sent it — nothing
// signs a clock — and it is exactly what a "when did I last hear from them" line means.
//
import { Link } from '@tanstack/react-router'

import { CHAT_NO_CONVERSATIONS } from '@strk20/protocol/chat-copy'
import type { ConversationSummary } from '@strk20/protocol/chat-log'

import { cn } from '../lib/cn'
import { shortenFelt } from '../shell/session'
import { PeerAvatar } from './PeerAvatar'
import { Text } from './ui/Text'

/**
 * How long ago, in one or two characters.
 *
 * Rounded DOWN at every step and capped at days: "3d" for anything older is enough for a sidebar,
 * and a date there would be a second time format in a column two characters wide.
 */
export function agoLabel(at: number, now: number): string {
  const seconds = Math.floor((now - at) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export interface ConversationListProps {
  conversations: readonly ConversationSummary[]
  /** The peer whose thread is on screen, so the row can say it is the current one. */
  activePeer: string | null
  /** Passed in rather than read here, so a list of rows renders from one clock. */
  now: number
  /** Directory avatars by lowercased address, when the directory has been fetched. */
  avatars?: Readonly<Record<string, string | undefined>>
}

export function ConversationList({ conversations, activePeer, now, avatars }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <p className="px-s12 py-s16 text-body4 text-neutral2">{CHAT_NO_CONVERSATIONS}</p>
    )
  }

  return (
    <ul className="flex flex-col gap-s2">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.peer}
          conversation={conversation}
          active={activePeer !== null && sameKey(activePeer, conversation.peer)}
          now={now}
          avatar={avatars?.[conversation.peer.toLowerCase()]}
        />
      ))}
    </ul>
  )
}

/** Peers are stored lowercased; a caller holding a route param may not have lowercased it. */
function sameKey(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function ConversationRow({
  conversation,
  active,
  now,
  avatar,
}: {
  conversation: ConversationSummary
  active: boolean
  now: number
  avatar?: string
}) {
  const unread = conversation.unread > 0
  const label = conversation.nickname ?? shortenFelt(conversation.peer)

  return (
    <li>
      <Link
        to="/chat/$peer"
        params={{ peer: conversation.peer }}
        className={cn(
          'focus-ring flex items-center gap-s12 rounded-card px-s12 py-s8 no-underline',
          'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
          active ? 'bg-inset' : 'hover:bg-inset',
        )}
        // The router sets `aria-current="page"` on the active link with no configuration, so the
        // "which conversation am I in" fact reaches a screen reader without a second attribute.
      >
        <PeerAvatar address={conversation.peer} avatar={avatar} size={40} />

        <span className="flex min-w-0 flex-1 flex-col gap-s2">
          <span className="flex items-baseline gap-s8">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body3',
                // Weight AND colour, never colour alone: an unread row has to survive greyscale,
                // and `neutral2` against `neutral1` is a difference some readers cannot see.
                unread ? 'font-medium text-neutral1' : 'text-neutral1',
                conversation.nickname ? '' : 'numeric',
              )}
            >
              {label}
            </span>
            <span className="shrink-0 text-body4 text-neutral3">
              {conversation.lastAt > 0 ? agoLabel(conversation.lastAt, now) : ''}
            </span>
          </span>

          <span className="flex items-center gap-s8">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-body4',
                unread ? 'text-neutral1' : 'text-neutral3',
              )}
            >
              {/* A payment renders as "Sent 25 USDC" — `chat-log.ts` derives the preview on insert,
                  so the sidebar and the thread cannot disagree about what a message was. */}
              {conversation.preview || 'No messages yet'}
            </span>
            {unread ? (
              <span
                className={cn(
                  'shrink-0 rounded-pill bg-accent1 px-s6 text-body4 text-ground',
                  'min-w-s20 text-center',
                )}
              >
                {/* Capped, so a thread nobody opened for a week cannot widen the sidebar. */}
                {conversation.unread > 99 ? '99+' : conversation.unread}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  )
}

/** The unread badge, for the nav item. Exported because the chrome renders one too. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="ml-s4 inline-flex min-w-s16 justify-center rounded-pill bg-accent1 px-s4 text-body4 text-ground"
      // Announced as a sentence rather than as a bare number, which on its own reads as part of
      // the nav label ("Chat 3" sounds like a third chat).
      aria-label={`${count} unread ${count === 1 ? 'message' : 'messages'}`}
    >
      <Text variant="body4" as="span" className="text-ground">
        {count > 99 ? '99+' : count}
      </Text>
    </span>
  )
}
