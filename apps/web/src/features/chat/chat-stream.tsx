//
// The one room socket, opened for as long as the app is.
//
// ── WHY IT IS NOT THE CHAT PAGE'S ANYMORE ────────────────────────────────────────────────
//
// It used to be mounted by `ChatShell`, which meant the socket existed only while `/chat` was on
// screen. Everything that follows from that was wrong in the same way: a message sent while you
// were on Wallet was not merely unseen, it was UNRECEIVED — the relayer buffers for thirty idle
// minutes and nothing was attached to take delivery — and the unread count in the navigation
// could never light up, because the only thing that could have incremented it was unmounted.
//
// So it lives here, above the router's outlet, and the surfaces below read it. That is also the
// only shape in which "you have two unread messages" can be true on a page that is not chat.
//
// ── WHAT DECIDES WHICH ROOMS IT CARRIES ──────────────────────────────────────────────────
//
// Every remembered conversation, plus the thread currently open if it is not one of them yet.
// The open thread is read from the ROUTER rather than passed down, because the router is already
// the thing that decides which thread is open and a second copy of that fact would be a second
// thing to keep in step.
//
import { useMatchRoute } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'

import { useSession } from '@/app/session'

import { ChatContext } from './chat-context'
import { peerKey, useConversations } from './chat-log-store'
import type { RoomInputs } from './queries'
import { useOpenRooms } from './use-peers'
import { useRoomStream } from './use-room-stream'

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const me = useMemo<RoomInputs | null>(
    () =>
      session.status === 'ready' && session.address && session.accountKey
        ? { address: session.address, accountKey: session.accountKey }
        : null,
    [session.status, session.address, session.accountKey],
  )

  const matchRoute = useMatchRoute()
  const match = matchRoute({ to: '/chat/$peer' })
  const active = match ? peerKey(match.peer) : null

  const conversations = useConversations(me?.address)
  const peers = useMemo(() => {
    const list = conversations.map((c) => c.peer)
    return active && !list.includes(active) ? [active, ...list] : list
  }, [conversations, active])

  const rooms = useOpenRooms(me, peers)
  const connection = useRoomStream(me?.address, rooms)

  // `null` until an account is open. Chat's surfaces already render their own "unlock first" state
  // off this, so an absent value has one meaning rather than two.
  const value = useMemo(() => (me ? { me, connection } : null), [me, connection])
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
