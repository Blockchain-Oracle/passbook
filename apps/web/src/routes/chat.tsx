import { Outlet, createFileRoute, useMatchRoute } from '@tanstack/react-router'

import { ChatShell } from '@/features/chat'

export const Route = createFileRoute('/chat')({
  component: ChatLayout,
})

function ChatLayout() {
  const matchRoute = useMatchRoute()
  const match = matchRoute({ to: '/chat/$peer' })
  return (
    <ChatShell activePeer={match ? match.peer : null}>
      <Outlet />
    </ChatShell>
  )
}
