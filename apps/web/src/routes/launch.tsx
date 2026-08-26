import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/launch')({
  component: Launch,
})

function Launch() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Launch</h1>
      <p className="text-body3 text-neutral2">
        Creating a token and giving it a first market will happen here. The launch surface is built
        in a later story.
      </p>
    </Surface>
  )
}
