import { Outlet, createFileRoute, useMatchRoute } from '@tanstack/react-router'

import { MailShell } from '@/features/mail'

export const Route = createFileRoute('/mail')({
  component: MailLayout,
})

function MailLayout() {
  const matchRoute = useMatchRoute()
  const match = matchRoute({ to: '/mail/$peer' })
  return (
    <MailShell activePeer={match ? match.peer : null}>
      <Outlet />
    </MailShell>
  )
}
