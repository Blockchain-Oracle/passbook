import { createFileRoute, Outlet, useMatchRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { CHAT_HISTORY_IS_LOCAL, CHAT_MULTIPLEX_DISCLOSURE } from '@strk20/protocol/chat-copy'

import { ConversationList } from '../components/ConversationList'
import { NewMessageDialog } from '../components/NewMessageDialog'
import { Button } from '../components/LegacyButton'
import { Text } from '../components/Text'
import { cn } from '../lib/cn'
import { setChatSession, useChatBus, useConversations } from '../shell/chat-bus'
import { useAvatars, useDirectory } from '../shell/use-directory'
import { useSession } from '../shell/session'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/chat')({
  component: ChatLayout,
})

//
// CHAT IS A PLACE NOW, NOT A FORM.
//
// ── WHAT THIS ROUTE BECAME, AND WHY THE SPLIT ────────────────────────────────────────────
//
// It used to BE the thread: one address field, one conversation, everything in React state and
// gone on navigation. It is now the LAYOUT — it mounts the bus, renders the sidebar, and hands the
// right-hand side to `/chat` (pick one) or `/chat/$peer` (the thread). The split is what makes the
// URL the state: a conversation is a link somebody can bookmark, Back works without a custom
// history stack, and mobile gets real navigation instead of a mode flag.
//
// ── THE BUS IS MOUNTED HERE, ABOVE THE OUTLET ────────────────────────────────────────────
//
// Navigation swaps the outlet's subtree, so anything inside it unmounts when you change threads.
// The socket must not: messages for the conversation you are NOT looking at have to arrive, or the
// unread badge is a decoration. Mounting it at the layout is the whole mechanism, and it is the
// same argument the pipeline row's placement in `__root.tsx` makes.
//
// ── MONEY AS A MESSAGE STILL LIVES IN THE THREAD ─────────────────────────────────────────
//
// Every claim the old file made about the payment path is unchanged and moved to `chat.$peer.tsx`:
// the transfer settles FIRST and only a confirmed one produces a card, the degraded reason is read
// rather than asserted, and the standing disclosure sits beside the thread rather than behind a
// confirm step. What changed is where those live, not what they say.
//
function ChatLayout() {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const conversations = useConversations()
  const bus = useChatBus()
  const matchRoute = useMatchRoute()
  const [composing, setComposing] = useState(false)

  // Directory names and faces decorate the sidebar; the app is fully usable when neither
  // resolves. `useAvatars` asks only about the peers whose entry says they published one.
  const { entries } = useDirectory()
  const avatars = useAvatars(entries)

  //
  // POINTED AT THE ACCOUNT, AND IDEMPOTENT INSIDE THE BUS.
  //
  // `useSession` returns a new object per render, so this effect re-runs constantly — `setChatSession`
  // compares the address and the key and returns early, which is what stops it from dropping the
  // routing cache and reconnecting the socket several times a minute.
  //
  useEffect(() => {
    setChatSession(
      ready === null
        ? null
        : { address: ready.address, accountKey: ready.accountKey, viewingKey: ready.viewingKey },
    )
  }, [ready?.address, ready?.accountKey, ready?.viewingKey])

  // Torn down when chat is left entirely, so a closed surface is not holding a socket open. The
  // log survives — it is in storage — so unread counts are still correct on the next visit.
  useEffect(() => () => setChatSession(null), [])

  const threadMatch = matchRoute({ to: '/chat/$peer', fuzzy: false })
  const activePeer = typeof threadMatch === 'object' && threadMatch ? threadMatch.peer : null
  // ONE CLOCK for every row, so twenty timestamps cannot disagree by a second mid-render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])


  return (
    <Surface routeId={Route.fullPath}>
      <div
        className={cn(
          'mx-auto flex w-full max-w-[1180px] flex-col gap-s16',
          // Two panes from 1024 up: a 320px conversation rail and the thread. Below that the two
          // are separate PAGES — the sidebar is `/chat` and the thread is `/chat/$peer` — so the
          // phone gets real back-button navigation rather than a panel that slides over itself.
          'lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-s24',
        )}
      >
        <aside
          className={cn(
            'flex min-w-0 flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s12',
            // On mobile the list is hidden while a thread is open; on desktop it is always there.
            activePeer !== null ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div className="flex items-center justify-between gap-s8">
            <Text variant="display3" as="h1" className="text-neutral1">
              Chat
            </Text>
            <Button variant="secondary" size="sm" onClick={() => setComposing(true)} disabled={!ready}>
              New
            </Button>
          </div>

          <ConversationList
            conversations={conversations}
            activePeer={activePeer}
            now={now}
            avatars={avatars}
          />

          {/*
            THE TWO SENTENCES THE DESIGN SAYS MAY NEVER BE CUT, on the surface rather than behind a
            disclosure toggle. A conversation list is exactly what makes bounded retention visible —
            it shows a thread whose middle is missing — so the reader meets the explanation on the
            way past rather than after concluding the app lost their messages.
          */}
          <div className="mt-s8 flex flex-col gap-s8 border-t border-solid border-surface3 pt-s12">
            <Text variant="body4" className="text-neutral3">
              {CHAT_HISTORY_IS_LOCAL}
            </Text>
            {bus.connection !== 'idle' ? (
              <Text variant="body4" className="text-neutral3">
                {CHAT_MULTIPLEX_DISCLOSURE}
              </Text>
            ) : null}
          </div>
        </aside>

        <div className={cn('min-w-0', activePeer === null ? 'hidden lg:block' : 'block')}>
          <Outlet />
        </div>
      </div>

      <NewMessageDialog open={composing} onOpenChange={setComposing} />
    </Surface>
  )
}
