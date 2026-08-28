import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { GOV_BALLOT_VISIBLE } from '@strk20/protocol/disclosure-copy'

import { CreateHouse } from '../components/houses/CreateHouse'
import { HouseCard } from '../components/houses/HouseCard'
import { YourPositions } from '../components/launch/YourPositions'
import { Button } from '../components/ui/Button'
import { Text } from '../components/ui/Text'
import { GOVERNANCE_DEPLOYED } from '../shell/app-contracts'
import { useGovernance } from '../shell/use-governance'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/houses')({
  component: Houses,
})

//
// HOUSES — governance the pool makes possible and nobody else ships.
//
// The surface says the three sentences the whole design stands on, then gets out of the way:
// your tokens are the ballot; a wrong tally is unpublishable, not merely detectable; and the box
// shows participation while the direction stays sealed — the state no transparent voting product
// can render. Every card below is a chain read; every door is a real transaction.
//
function Houses() {
  const read = useGovernance()
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <header className="flex flex-col gap-s8 border-b border-solid border-surface3 pb-s12">
          <Text variant="kicker">07 — governance</Text>
          <div className="flex flex-wrap items-end justify-between gap-s12">
            <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
              Houses
            </Text>
            {GOVERNANCE_DEPLOYED ? (
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                Create a House
              </Button>
            ) : null}
          </div>
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            Sealed ballots on any token, tallied by a machine that refuses to be wrong. Your
            tokens are the vote, escrowed and returned; your choice travels sealed; who you are
            is nobody&rsquo;s to know — the pool&rsquo;s whole point, applied to power.
          </Text>
        </header>

        {GOVERNANCE_DEPLOYED ? (
          <>
            {read.problem ? (
              <Text variant="body4" className="text-exposed" role="status">
                {read.problem}
              </Text>
            ) : null}

            {read.houses.length === 0 ? (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                <Text variant="body3" className="text-neutral2">
                  {read.loading
                    ? 'Reading the Governor…'
                    : 'No House is standing yet. Any token can raise one — including one launched next door.'}
                </Text>
                {/* ONE VERB. "Activate" and "Raise" were two more words for the same action. */}
                <Button variant="primary" size="md" className="self-start" onClick={() => setCreating(true)}>
                  Create the first one
                </Button>
              </section>
            ) : (
              <div className="flex flex-col gap-s12">
                {read.houses.map((house) => (
                  <HouseCard
                    key={house.id}
                    house={house}
                    proposals={read.proposals.filter((p) => p.houseId === house.id)}
                    now={now}
                  />
                ))}
              </div>
            )}

            <YourPositions venue="governance" />
          </>
        ) : (
          <section className="rounded-large border border-solid border-surface3 p-s16">
            <Text variant="subheading2" as="h2">
              Not standing yet
            </Text>
            <Text variant="body3" className="mt-s4 max-w-[70ch] text-neutral2">
              The Governor is written and tested — 18 contract tests hold the accumulator that
              makes a wrong tally unpublishable — and its deploy has not landed. When it does,
              this surface lights up with no further release.
            </Text>
          </section>
        )}

        <footer className="rounded-large border border-solid border-surface3 p-s16">
          <Text variant="body4" className="text-neutral3">
            {GOV_BALLOT_VISIBLE} Until close, our Teller can read choices early; it cannot forge,
            drop or miscount them — the contract checks the math before a tally can publish.
          </Text>
        </footer>

        <CreateHouse open={creating} onClose={() => setCreating(false)} />
      </div>
    </Surface>
  )
}
