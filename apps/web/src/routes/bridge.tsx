import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/bridge')({
  component: Bridge,
})

function Bridge() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Bridge</h1>
      <p className="text-body3 text-neutral2">
        Moving value between Starknet and other chains will happen here. The bridge surface is built
        in a later story.
      </p>
    </Surface>
  )
}
