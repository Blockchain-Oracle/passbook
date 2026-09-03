import { Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { MAIL_NO_THREADS, MAIL_NO_THREADS_HINT } from '@strk20/protocol/mail-copy'
import type { MailThread } from '@strk20/protocol/mail-discover'

import { IdentityAvatar } from '@/components/money/identity-avatar'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { handleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Identity } from '@/queries/identity'

import { isUnread } from './mail-seen'

/** The last line of a thread, in the words of its newest mail. */
function preview(thread: MailThread): string {
  const last = thread.items[thread.items.length - 1]
  if (!last) return ''
  const who = last.direction === 'out' ? 'You: ' : ''
  if (!last.body) return `${who}Could not be opened`
  switch (last.body.kind) {
    case 'text':
      return `${who}${last.body.text}`
    case 'request':
      return `${who}Asked for ${last.body.amount} ${last.body.symbol}`
    case 'handle':
      return `${who}A voter handle`
    case 'market':
      return `${who}A finished bet`
    case 'unsupported':
      return `${who}A message this app does not read yet`
  }
}

export function ThreadList({
  address,
  threads,
  identities,
  activePeer,
}: {
  address: string
  threads: readonly MailThread[]
  identities: Record<string, Identity>
  activePeer: string | null
}) {
  if (threads.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mail aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{MAIL_NO_THREADS}</EmptyTitle>
          <EmptyDescription>{MAIL_NO_THREADS_HINT}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ItemGroup className="gap-1">
      {threads.map((thread) => {
        const identity = identities[thread.peer]
        const active = activePeer !== null && BigInt(activePeer) === BigInt(thread.peer)
        const unread = isUnread(address, thread)
        return (
          <Item
            key={thread.peer}
            size="sm"
            variant={active ? 'muted' : 'default'}
            render={<Link to="/mail/$peer" params={{ peer: thread.peer }} aria-current={active ? 'page' : undefined} />}
            className={cn(active && 'border-border')}
          >
            <ItemMedia>
              <IdentityAvatar address={thread.peer} name={identity?.name} avatar={identity?.avatar} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex w-full items-center gap-2">
                <span className={cn('truncate', unread && 'font-semibold')}>{handleLabel(identity?.name, thread.peer, 10, 8)}</span>
                <span className="ml-auto shrink-0 font-mono text-body4 text-muted-foreground">#{thread.lastBlock.toLocaleString()}</span>
              </ItemTitle>
              <ItemDescription className="flex items-center gap-2">
                <span className="truncate">{preview(thread)}</span>
                {unread ? <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
              </ItemDescription>
            </ItemContent>
          </Item>
        )
      })}
    </ItemGroup>
  )
}
