import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/chat')({
  component: Chat,
})

// `Route.fullPath` — never `Route.id`, never `location.pathname`. See `../shell/Surface.tsx` for
// which of those three the gates read and why the other two fail a healthy route.
function Chat() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Chat</h1>
      <p className="text-body3 text-neutral2">
        Messages that travel with a payment will be written and read here. The chat surface is built
        in a later story.
      </p>
    </Surface>
  )
}
