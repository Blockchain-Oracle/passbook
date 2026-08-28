import { createFileRoute } from '@tanstack/react-router'

import { PayResolver, rawPaySearch } from '@/features/wallet/pay-resolver'

// The param is an address or an `@name`; `pay-link.ts` decides which, not the route.
export const Route = createFileRoute('/pay/$address')({
  validateSearch: rawPaySearch,
  component: PayRoute,
})

function PayRoute() {
  const { address } = Route.useParams()
  const search = Route.useSearch()
  return <PayResolver reference={address} search={search} />
}
