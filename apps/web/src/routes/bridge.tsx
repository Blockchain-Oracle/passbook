import { createFileRoute } from '@tanstack/react-router'
import { destinationFor } from '@strk20/protocol/bridge'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { BridgeSurface } from '@/features/bridge/bridge-surface'

export const Route = createFileRoute('/bridge')({
  // `?chain=base` preselects a destination; anything else falls back to the first.
  validateSearch: (search: Record<string, unknown>): { chain?: string } =>
    typeof search.chain === 'string' && destinationFor(search.chain) ? { chain: search.chain } : {},
  component: BridgeRoute,
})

function BridgeRoute() {
  const { chain } = Route.useSearch()
  return (
    <Page
      kicker="Money"
      title="Exit to public"
      description="Shielded USDC out to another chain through CCTP. One direction only."
      actions={<BoundaryBadge kind="publicExit" />}
    >
      <BridgeSurface initialChain={chain} />
    </Page>
  )
}
