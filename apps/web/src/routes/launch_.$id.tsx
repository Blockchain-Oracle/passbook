import { createFileRoute } from '@tanstack/react-router'

import { LaunchDetail } from '@/features/launch/launch-detail'

// `launch_` un-nests this from `/launch`: the detail page is its own surface, not a child panel.
export const Route = createFileRoute('/launch_/$id')({
  component: LaunchDetailRoute,
})

function LaunchDetailRoute() {
  const { id } = Route.useParams()
  const parsed = Number.parseInt(id, 10)
  return <LaunchDetail id={Number.isFinite(parsed) ? parsed : -1} />
}
