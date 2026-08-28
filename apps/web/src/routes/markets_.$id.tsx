import { createFileRoute } from '@tanstack/react-router'

import { MarketDetail } from '@/features/markets/detail'

export const Route = createFileRoute('/markets_/$id')({
  component: MarketRoute,
})

function MarketRoute() {
  const { id } = Route.useParams()
  const parsed = Number.parseInt(id, 10)
  return <MarketDetail id={Number.isFinite(parsed) ? parsed : -1} />
}
