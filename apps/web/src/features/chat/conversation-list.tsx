import { Link } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import { CHAT_NO_CONVERSATIONS } from '@strk20/protocol/chat-copy'
import type { ConversationSummary } from '@strk20/protocol/chat-log'

import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'

import { PeerAvatar, peerLabel } from './peer-avatar'
import type { PeerIdentity } from './use-peers'

function when(lastAt: number, now: number): string {
  const ago = Math.max(0, now - lastAt)
  if (ago < 60_000) return 'now'
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m`
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h`
  return `${Math.floor(ago / 86_400_000)}d`
}

export function ConversationList({
  conversations,
  identities,
  activePeer,
  now,
}: {
  conversations: readonly ConversationSummary[]
  identities: Record<string, PeerIdentity>
  activePeer: string | null
  now: number
}) {
  if (conversations.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircle aria-hidden />
          </EmptyMedia>
          <EmptyDescription>{CHAT_NO_CONVERSATIONS}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ItemGroup className="gap-1">
      {conversations.map((c) => {
        const identity = identities[c.peer]
        const active = activePeer === c.peer
        return (
          <Item
            key={c.peer}
            size="sm"
            variant={active ? 'muted' : 'default'}
            render={<Link to="/chat/$peer" params={{ peer: c.peer }} aria-current={active ? 'page' : undefined} />}
            className={cn(active && 'border-border')}
          >
            <ItemMedia>
              <PeerAvatar peer={c.peer} identity={identity} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex w-full items-center gap-2">
                <span className="truncate">{c.nickname ?? peerLabel(c.peer, identity)}</span>
                <span className="ml-auto shrink-0 text-body4 text-muted-foreground">{when(c.lastAt, now)}</span>
              </ItemTitle>
              <ItemDescription className="flex items-center gap-2">
                <span className="truncate">{c.preview || 'No messages yet'}</span>
                {c.unread > 0 ? <Badge className="ml-auto shrink-0">{c.unread}</Badge> : null}
              </ItemDescription>
            </ItemContent>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
