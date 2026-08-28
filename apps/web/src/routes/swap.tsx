import { createFileRoute } from '@tanstack/react-router'

import { SwapSurface } from '@/features/swap/swap-surface'

function felt(value: unknown): string | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(value) ? value : undefined
}

export const Route = createFileRoute('/swap')({
  // `/swap?buy=0x…` from a token or launch page; anything that is not a felt is dropped.
  validateSearch: (search: Record<string, unknown>) => ({ sell: felt(search.sell), buy: felt(search.buy) }),
  component: SwapRoute,
})

function SwapRoute() {
  const { sell, buy } = Route.useSearch()
  return <SwapSurface seed={{ sell, buy }} />
}
