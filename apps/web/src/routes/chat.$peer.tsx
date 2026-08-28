import { createFileRoute } from '@tanstack/react-router'

import { Thread } from '@/features/chat'

export const Route = createFileRoute('/chat/$peer')({
  component: ThreadRoute,
})

function ThreadRoute() {
  const { peer } = Route.useParams()
  return <Thread peer={peer} />
}
