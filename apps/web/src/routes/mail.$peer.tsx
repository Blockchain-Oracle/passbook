import { createFileRoute } from '@tanstack/react-router'

import { Thread } from '@/features/mail'

export const Route = createFileRoute('/mail/$peer')({
  component: ThreadRoute,
})

function ThreadRoute() {
  const { peer } = Route.useParams()
  return <Thread peer={peer} />
}
