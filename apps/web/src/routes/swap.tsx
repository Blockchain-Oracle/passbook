import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/swap')({
  component: Swap,
})

function Swap() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Swap</h1>
      <p className="text-body3 text-neutral2">
        Exchanging one asset for another will happen here. The swap surface is built in a later
        story.
      </p>
    </Surface>
  )
}
