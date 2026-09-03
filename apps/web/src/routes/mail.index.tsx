import { createFileRoute } from '@tanstack/react-router'

import { MailIndex } from '@/features/mail'

export const Route = createFileRoute('/mail/')({
  component: MailIndex,
})
