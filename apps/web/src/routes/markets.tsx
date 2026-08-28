import { createFileRoute } from '@tanstack/react-router'
import { PRAGMA_PAIR_LIST, type PragmaPair } from '@strk20/protocol/pragma-pairs'

import { MarketsBoard } from '@/features/markets/board'

interface MarketsSearch {
  pair?: PragmaPair
}

export const Route = createFileRoute('/markets')({
  validateSearch: (search: Record<string, unknown>): MarketsSearch => {
    const pair = search.pair
    return typeof pair === 'string' && PRAGMA_PAIR_LIST.includes(pair as PragmaPair) ? { pair: pair as PragmaPair } : {}
  },
  component: MarketsRoute,
})

function MarketsRoute() {
  const { pair } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <MarketsBoard pair={pair ?? 'BTC/USD'} onPair={(next) => void navigate({ search: { pair: next }, replace: true })} />
}
