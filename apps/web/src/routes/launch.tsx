import { createFileRoute } from '@tanstack/react-router'

import { LaunchBoard } from '@/features/launch/launch-board'

export const Route = createFileRoute('/launch')({
  component: LaunchBoard,
})
