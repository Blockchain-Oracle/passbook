import { createFileRoute } from '@tanstack/react-router'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { CreateHouseButton, HousesList } from '@/features/houses'

export const Route = createFileRoute('/houses')({
  component: HousesRoute,
})

function HousesRoute() {
  return (
    <Page
      kicker="Venues"
      title="DAOs"
      actions={
        <>
          <BoundaryBadge kind="bearer" />
          <CreateHouseButton />
        </>
      }
    >
      <HousesList />
    </Page>
  )
}
