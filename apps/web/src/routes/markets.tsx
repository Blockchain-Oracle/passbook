import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/markets')({
  component: Markets,
})

function Markets() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Markets</h1>
      <p className="text-body3 text-neutral2">
        Prices and pools, read from the chain rather than from a fixture, will be shown here. The
        markets surface is built in a later story.
      </p>
    </Surface>
  )
}
