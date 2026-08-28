// The chat surface: conversation list on the left, the route's child (index or a thread) on the
// right. The list owns the one stream every room shares — it is mounted for as long as chat is.
import { useMemo, type ReactNode } from 'react'
import { CHAT_HISTORY_IS_LOCAL, CHAT_MULTIPLEX_DISCLOSURE, CHAT_OFFLINE_GAP } from '@strk20/protocol/chat-copy'

import { useSession } from '@/app/session'
import { Page } from '@/components/layout/page'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'

import { ChatContext } from './chat-context'
import { peerKey, useConversations } from './chat-log-store'
import { ConversationList } from './conversation-list'
import { NewMessageDialog } from './new-message-dialog'
import type { RoomInputs } from './queries'
import { useOpenRooms, usePeerIdentities } from './use-peers'
import { useRoomStream } from './use-room-stream'

export interface ChatShellProps {
  /** The `$peer` param when a thread route is active; `null` on the index. */
  activePeer: string | null
  /** The child route (the layout's `Outlet`); it reads the session and stream via `ChatContext`. */
  children: ReactNode
}

export function ChatShell({ activePeer, children }: ChatShellProps) {
  const session = useSession()
  const me = useMemo<RoomInputs | null>(
    () => (session.status === 'ready' && session.address && session.accountKey ? { address: session.address, accountKey: session.accountKey } : null),
    [session.status, session.address, session.accountKey],
  )
  const conversations = useConversations(me?.address)
  const active = activePeer ? peerKey(activePeer) : null
  // Every remembered conversation plus the open thread, so the stream carries the one on screen
  // even before its first message lands in the log.
  const peers = useMemo(() => {
    const list = conversations.map((c) => c.peer)
    return active && !list.includes(active) ? [active, ...list] : list
  }, [conversations, active])
  const rooms = useOpenRooms(me, peers)
  const connection = useRoomStream(me?.address, rooms)
  const identities = usePeerIdentities(peers)
  const now = useNow(30_000)
  const threadOpen = active !== null

  return (
    <Page
      kicker="Venues"
      title="Chat"
      className="max-w-6xl lg:h-svh lg:overflow-hidden"
      actions={me ? <NewMessageDialog address={me.address} /> : null}
    >
      {me ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className={cn('flex min-h-0 flex-col gap-3', threadOpen && 'hidden lg:flex')}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList conversations={conversations} identities={identities} activePeer={active} now={now} />
            </div>
            <div className="flex flex-col gap-2 text-body4 text-muted-foreground">
              <p>{CHAT_HISTORY_IS_LOCAL}</p>
              <p>{CHAT_OFFLINE_GAP}</p>
              {connection !== 'idle' ? <p>{CHAT_MULTIPLEX_DISCLOSURE}</p> : null}
            </div>
          </aside>
          <div className={cn('flex min-h-0 flex-col', !threadOpen && 'hidden lg:flex')}>
            <ChatContext.Provider value={{ me, connection }}>{children}</ChatContext.Provider>
          </div>
        </div>
      ) : (
        <p className="text-body3 text-muted-foreground">
          {session.status === 'booting' ? 'Opening your account…' : 'Chat needs an open account. Unlock or create one first.'}
        </p>
      )}
    </Page>
  )
}
