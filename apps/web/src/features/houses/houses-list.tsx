import { useState } from 'react'
import { Landmark, ShieldAlert } from 'lucide-react'
import { GOV_BALLOT_VISIBLE, GOV_NOT_ANONYMITY, GOV_TELLER_PEEK } from '@strk20/protocol/disclosure-copy'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { CreateHouse } from './create-house'
import { shutDoor } from './house-doors'
import { HouseCard } from './house-card'
import { PositionsStrip } from '@/features/positions'
import { useGovernanceRead } from './queries'

/** A 30 s clock for "closes in" and phase words. */
export const HOUSE_CLOCK_MS = 30_000

/** When writes are blocked, say why — never hide the surface. */
export function WritesBlocked({ because }: { because: string }) {
  return (
    <Alert>
      <ShieldAlert />
      <AlertTitle>Writes are closed on this class</AlertTitle>
      <AlertDescription>
        {because} Existing DAOs and their records remain visible, but creating, proposing, voting, joining and funding are
        unavailable.
      </AlertDescription>
    </Alert>
  )
}

/** The Houses surface: every card a chain read, every door a real transaction. */
export function HousesList() {
  const read = useGovernanceRead()
  const now = useNow(HOUSE_CLOCK_MS)
  const [creating, setCreating] = useState(false)
  const writesEnabled = read.writes.enabled

  if (!read.deployed) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Landmark />
          </EmptyMedia>
          <EmptyTitle>Not standing yet</EmptyTitle>
          <EmptyDescription>
            No Governance deployment is recorded for this build. Houses appear here only from verified deployment evidence; no
            placeholder address or fixture is used.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-body3 text-muted-foreground">
        Sealed ballots on any token, tallied by a machine that refuses to be wrong. Your tokens are the vote, escrowed and
        returned; your choice travels sealed.
      </p>
      {!read.writes.enabled ? <WritesBlocked because={read.writes.because} /> : null}
      {read.problem ? (
        <p className="text-body4 text-exposed" role="status">
          {read.problem}
        </p>
      ) : null}

      {read.loading && read.houses.length === 0 ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : read.houses.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Landmark />
            </EmptyMedia>
            <EmptyTitle>No DAO is standing yet</EmptyTitle>
            <EmptyDescription>Any token can raise one — including one launched next door.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              aria-disabled={!writesEnabled || undefined}
              onClick={() => (read.writes.enabled ? setCreating(true) : shutDoor(read.writes.because))}
            >
              {writesEnabled ? 'Create the first one' : 'Creating is disabled on this class'}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {read.houses.map((house) => (
            <HouseCard
              key={house.id}
              house={house}
              proposals={read.proposals.filter((p) => p.houseId === house.id)}
              now={now}
              writesEnabled={writesEnabled}
            />
          ))}
        </div>
      )}

      <PositionsStrip venue="governance" />

      <footer className="flex flex-col gap-1 rounded-lg border p-4 text-body4 text-muted-foreground">
        <p>{GOV_BALLOT_VISIBLE}</p>
        <p>{GOV_TELLER_PEEK}</p>
        <p>{GOV_NOT_ANONYMITY}</p>
      </footer>

      <CreateHouse open={creating} onOpenChange={setCreating} />
    </div>
  )
}

/** The header door, so the route can place it in `Page.actions`. */
export function CreateHouseButton() {
  const read = useGovernanceRead()
  const [creating, setCreating] = useState(false)
  if (!read.deployed) return null
  const enabled = read.writes.enabled
  return (
    <>
      {/* The label follows the state and the click always answers — this one used to say
          "Create a House" while blocked and then do nothing at all. */}
      <Button
        aria-disabled={!enabled || undefined}
        onClick={() => (read.writes.enabled ? setCreating(true) : shutDoor(read.writes.because))}
      >
        {read.writes.enabled ? 'Create a DAO' : read.writes.blocker}
      </Button>
      <CreateHouse open={creating} onOpenChange={setCreating} />
    </>
  )
}
