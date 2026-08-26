import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/activity/$id')({
  component: Activity,
})

//
// NO LOADER, DELIBERATELY. `loader: ({ params }) => ({ id: params.id })` read as caution about the
// literal `$id` the build gate visits, but it does nothing `useParams()` does not already do — and
// it costs something: `loader` is one of the router's default code-split groupings, so a loader that
// only forwards a param buys the route an extra chunk to say the same word.
//
// The rule it was standing in for still holds and belongs where an id is actually USED, not here:
// the gate navigates to `/activity/$id` verbatim, so `params.id` is the three-character string
// `"$id"`. Whatever eventually resolves an id has to report a malformed one in the UI rather than
// throw, or that surface ships wearing `__error__` on every build.
//
function Activity() {
  const { id } = Route.useParams()
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Activity</h1>
      <p className="text-body3 text-neutral2">
        One transaction, told as what happened to it. The activity surface is built in a later
        story; the route exists now so the shell can link to it.
      </p>
      <p className="text-body4 text-neutral2 numeric">Requested id: {id}</p>
    </Surface>
  )
}
