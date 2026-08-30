import { createFileRoute, Link } from '@tanstack/react-router'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { HouseRecord, houseTitle, useGovernanceRead } from '@/features/houses'

interface HouseSearch {
  /** A voter handle handed over in chat — the Delegate door opens holding it. */
  delegate?: string
}

const FELT = /^0x[0-9a-fA-F]{1,64}$/

export const Route = createFileRoute('/houses_/$id')({
  // A malformed handle prefills nothing rather than half of something, exactly as `/send` does.
  validateSearch: (search: Record<string, unknown>): HouseSearch =>
    typeof search.delegate === 'string' && FELT.test(search.delegate) ? { delegate: search.delegate } : {},
  component: HouseRoute,
})

function HouseRoute() {
  const { id } = Route.useParams()
  const { delegate } = Route.useSearch()
  const read = useGovernanceRead()
  const house = read.houses.find((h) => String(h.id) === id)
  const name = house ? houseTitle(house) : `DAO ${id}`
  return (
    <Page
      kicker="Venues · DAOs"
      title={name}
      description={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/houses" />}>DAOs</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      actions={<BoundaryBadge kind="bearer" />}
    >
      <HouseRecord id={id} delegate={delegate} />
    </Page>
  )
}
