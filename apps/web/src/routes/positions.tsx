import { createFileRoute } from '@tanstack/react-router'

import { PositionsSurface } from '@/features/positions'

interface PositionsSearch {
  /** A group key (`launch:12`), so a venue's strip opens the position it points at. */
  open?: string
}

export const Route = createFileRoute('/positions')({
  validateSearch: (search: Record<string, unknown>): PositionsSearch =>
    typeof search.open === 'string' && search.open.length <= 64 ? { open: search.open } : {},
  component: PositionsRoute,
})

function PositionsRoute() {
  const { open } = Route.useSearch()
  return <PositionsSurface open={open} />
}
