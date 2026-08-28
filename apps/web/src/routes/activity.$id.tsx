import { createFileRoute } from '@tanstack/react-router'

import { ReceiptView } from '@/features/wallet/receipt-view'

export const Route = createFileRoute('/activity/$id')({
  component: ActivityRoute,
})

function ActivityRoute() {
  const { id } = Route.useParams()
  return <ReceiptView id={id} />
}
