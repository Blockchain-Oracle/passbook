import { createFileRoute } from '@tanstack/react-router'

import { EarnSurface } from '@/features/earn'

/** `?market=` so a market card, a position row or a shared link can open the right one. */
export const Route = createFileRoute('/earn')({
  validateSearch: (search: Record<string, unknown>) => ({
    market: typeof search.market === 'string' && search.market.length <= 64 ? search.market : undefined,
  }),
  component: EarnRoute,
})

function EarnRoute() {
  return <EarnSurface market={Route.useSearch().market} />
}
