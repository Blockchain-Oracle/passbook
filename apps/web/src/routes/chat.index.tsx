import { createFileRoute } from '@tanstack/react-router'

import { ChatIndex } from '@/features/chat'

export const Route = createFileRoute('/chat/')({
  component: ChatIndex,
})
