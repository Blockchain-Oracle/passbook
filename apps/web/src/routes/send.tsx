import { createFileRoute } from '@tanstack/react-router'
import { parsePayLinkSearch, parseRecipientReference } from '@strk20/protocol/pay-link'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { SendForm, type SendSearch } from '@/features/send'

export const Route = createFileRoute('/send')({
  // A pay link that fails to parse prefills nothing rather than half of something.
  validateSearch: (search: Record<string, unknown>): SendSearch => {
    const to = typeof search.to === 'string' ? parseRecipientReference(search.to) : null
    const request = parsePayLinkSearch(search)
    return {
      ...(to?.ok ? { to: to.value.kind === 'address' ? to.value.address : to.value.display } : {}),
      ...(request.ok ? request.value : {}),
    }
  },
  component: SendRoute,
})

function SendRoute() {
  const search = Route.useSearch()
  return (
    <Page kicker="Money" title="Send" actions={<BoundaryBadge kind="shielded" />}>
      {/* Keyed so a fresh pay link reseeds the form instead of leaking the last draft. */}
      <SendForm key={JSON.stringify(search)} initial={search} />
    </Page>
  )
}
