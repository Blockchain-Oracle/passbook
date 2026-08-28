import { createFileRoute, Link } from '@tanstack/react-router'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { HouseRecord, houseTitle, useGovernanceRead } from '@/features/houses'

export const Route = createFileRoute('/houses_/$id')({
  component: HouseRoute,
})

function HouseRoute() {
  const { id } = Route.useParams()
  const read = useGovernanceRead()
  const house = read.houses.find((h) => String(h.id) === id)
  const name = house ? houseTitle(house) : `House ${id}`
  return (
    <Page
      kicker="Venues · Houses"
      title={name}
      description={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/houses" />}>Houses</BreadcrumbLink>
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
      <HouseRecord id={id} />
    </Page>
  )
}
