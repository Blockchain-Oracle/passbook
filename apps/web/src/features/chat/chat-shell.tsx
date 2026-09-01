//
// The chat surface: conversation list on the left, the route's child (index or a thread) on the
// right. The socket is NOT here — `ChatStreamProvider` owns it at the app root, so a message
// arrives whether or not this page is on screen. This is the layout and nothing else.
//
// ── THE PHONE IS A DIFFERENT SHAPE, NOT A NARROWER ONE ───────────────────────────────────
//
// Below `@3xl` the two panes become one: the list is the page, and opening a thread replaces it
// (the thread header carries the back arrow). Two things follow, and both were missing:
//
//   1. The column has to be BOUNDED, not merely tall. `flex-1 min-h-0` inside a shell that is
//      itself viewport-height is what gives the message list its own scrollbar. Without it the
//      list has no height to overflow, so the document grows instead and the composer rides down
//      the page — every new message pushing the thing you type into further off screen.
//   2. The page title is dead weight next to an open thread. "CHAT" over a header that already
//      names the person costs a phone a fifth of its height to say something it can read from
//      the tab bar, so it is hidden exactly when a thread is open and shown otherwise.
//
// ── AND `min-w-0` ON EVERY CONTAINER IN THE CHAIN, WHICH IS NOT OPTIONAL ─────────────────
//
// A grid or flex item defaults to `min-width: auto`, meaning "never shrink below your content".
// So a wide card or a long address does not overflow its column — it WIDENS the column, and the
// whole page slides out from under the phone's right edge, taking the header with it. Adding it
// to one container only moves the problem to the next one down, which is why the grid, both
// panes, the thread section and the message list all carry it.
//
import { useMemo, type ReactNode } from 'react'
import { CHAT_HISTORY_IS_LOCAL, CHAT_MULTIPLEX_DISCLOSURE, CHAT_OFFLINE_GAP } from '@strk20/protocol/chat-copy'

import { useSession } from '@/app/session'
import { Page } from '@/components/layout/page'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'

import { useChatContext } from './chat-context'
import { peerKey, useConversations } from './chat-log-store'
import { ConversationList } from './conversation-list'
import { NewMessageDialog } from './new-message-dialog'
import { useAllPresence } from './room-presence'
import { usePeerIdentities } from './use-peers'

export interface ChatShellProps {
  /** The `$peer` param when a thread route is active; `null` on the index. */
  activePeer: string | null
  /** The child route (the layout's `Outlet`); it reads the session and stream via `ChatContext`. */
  children: ReactNode
}

export function ChatShell({ activePeer, children }: ChatShellProps) {
  const session = useSession()
  const chat = useChatContext()
  const me = chat?.me ?? null
  const conversations = useConversations(me?.address)
  const active = activePeer ? peerKey(activePeer) : null
  const peers = useMemo(() => conversations.map((c) => c.peer), [conversations])
  const identities = usePeerIdentities(peers)
  const presence = useAllPresence()
  const now = useNow(30_000)
  const threadOpen = active !== null

  return (
    <Page
      kicker="Venues"
      title="Chat"
      className="min-h-0 max-w-6xl flex-1 gap-4"
      headerClassName={cn(threadOpen && 'hidden @3xl:flex')}
      actions={me ? <NewMessageDialog address={me.address} /> : null}
    >
      {me ? (
        <div className="grid min-h-0 min-w-0 flex-1 gap-4 @3xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <aside className={cn('flex min-h-0 min-w-0 flex-col', threadOpen && 'hidden @3xl:flex')}>
            {/* The three sentences scroll WITH the list rather than under it. They are the ones
                `chat-copy.ts` says may never be cut, and a fixed footer on a 640px-tall phone is
                how copy gets cut: it either eats the list or gets hidden at a breakpoint. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
              <ConversationList
                conversations={conversations}
                identities={identities}
                presence={presence}
                activePeer={active}
                now={now}
              />
              <div className="flex flex-col gap-2 pb-1 text-body4 text-muted-foreground">
                <p>{CHAT_HISTORY_IS_LOCAL}</p>
                <p>{CHAT_OFFLINE_GAP}</p>
                {chat && chat.connection !== 'idle' ? <p>{CHAT_MULTIPLEX_DISCLOSURE}</p> : null}
              </div>
            </div>
          </aside>
          <div className={cn('flex min-h-0 min-w-0 flex-col', !threadOpen && 'hidden @3xl:flex')}>{children}</div>
        </div>
      ) : (
        <p className="text-body3 text-muted-foreground">
          {session.status === 'booting' ? 'Opening your account…' : 'Chat needs an open account. Unlock or create one first.'}
        </p>
      )}
    </Page>
  )
}
