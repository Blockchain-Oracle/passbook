import { createFileRoute } from '@tanstack/react-router'

import { PayResolver, rawPaySearch } from '@/features/wallet/pay-resolver'

// A profile link is a pay link by name: `/u/alice` resolves `@alice` and opens Send.
export const Route = createFileRoute('/u/$name')({
  validateSearch: rawPaySearch,
  component: ProfileRoute,
})

function ProfileRoute() {
  const { name } = Route.useParams()
  const search = Route.useSearch()
  const reference = name.startsWith('@') ? name : `@${name}`
  return <PayResolver reference={reference} search={search} />
}
