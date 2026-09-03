import { createFileRoute } from '@tanstack/react-router'

import { EarnMarketDetail } from '@/features/earn/market-detail'

export const Route = createFileRoute('/earn_/$id')({
  component: EarnMarketRoute,
})

function EarnMarketRoute() {
  const { id } = Route.useParams()
  return <EarnMarketDetail id={id} />
}
