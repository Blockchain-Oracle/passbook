import { createFileRoute } from '@tanstack/react-router'

import { TokenPage } from '@/features/wallet/token-page'

export const Route = createFileRoute('/token/$address')({
  component: TokenRoute,
})

function TokenRoute() {
  const { address } = Route.useParams()
  return <TokenPage address={address} />
}
