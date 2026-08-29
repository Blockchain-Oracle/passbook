import { createFileRoute } from '@tanstack/react-router'

import { MarketsBoard } from '@/features/markets/board'

export const Route = createFileRoute('/markets')({
  component: MarketsBoard,
})
