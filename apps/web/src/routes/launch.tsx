import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  LAUNCH_BUYER_HIDDEN,
  LAUNCH_EPOCH_FACT,
  LAUNCH_GRADUATION,
  LAUNCH_NOT_DEPLOYED,
  LAUNCH_REFUND,
  LAUNCH_STANDING_LINE,
  LAUNCH_TITLE,
} from '@strk20/protocol/markets-copy'
import type { OnChainLaunch } from '@strk20/protocol/app-reads'

import { ActivityTape } from '../components/launch/ActivityTape'
import { BuyTicket } from '../components/launch/BuyPanel'
import { CreateLaunch } from '../components/launch/CreateLaunch'
import { LaunchCard } from '../components/launch/LaunchCard'
import { TokenTable } from '../components/launch/TokenTable'
import { YourPositions } from '../components/launch/YourPositions'
import { Button } from '../components/ui/Button'
import { Text } from '../components/ui/Text'
import { cn } from '../lib/cn'
import { LAUNCH_DEPLOYED } from '../shell/app-contracts'
import { useChainFeed } from '../shell/chain-feed'
import { useLaunches } from '../shell/use-app-reads'
import { Surface } from '../shell/Surface'

type LaunchTab = 'launches' | 'tokens' | 'activity'

const TABS: ReadonlyArray<{ id: LaunchTab; label: string }> = [
  { id: 'launches', label: 'Launches' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'activity', label: 'Activity' },
]

export const Route = createFileRoute('/launch')({
  // The tab travels in the URL so a view is linkable — Uniswap's tabs-are-routes intent, carried
  // by a search param because three views of one surface are not three surfaces.
  validateSearch: (search: Record<string, unknown>): { tab?: LaunchTab } => ({
    tab: search.tab === 'tokens' || search.tab === 'activity' ? search.tab : undefined,
  }),
  component: Launch,
})

//
// LAUNCH — the launchpad, whole: what is selling, what has become a token, and what just happened.
//
// Three tabs over one chain feed. `Launches` is the sale grid — every card the contract's real
// state, the buy one press away. `Tokens` is the table those sales become. `Activity` is the
// contracts' own events, live off the relayer stream, each row with its transaction. The rules
// that used to fill this page with cards are now one quiet strip at the foot — still true, still
// taught, no longer standing where the product goes.
//
function Launch() {
  const { tab = 'launches' } = Route.useSearch()
  const read = useLaunches()
  const feed = useChainFeed()
  const [buying, setBuying] = useState<OnChainLaunch | null>(null)
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
          <Text variant="kicker">06 — issuance</Text>
          <div className="flex flex-wrap items-end justify-between gap-s12">
            <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
              {LAUNCH_TITLE}
            </Text>
            {LAUNCH_DEPLOYED ? (
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                Create a launch
              </Button>
            ) : null}
          </div>
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            {LAUNCH_STANDING_LINE}
          </Text>
        </header>

        {LAUNCH_DEPLOYED ? (
          <>
            <nav aria-label="Launch views" className="flex gap-s16 border-b border-solid border-surface3">
              {TABS.map(({ id, label }) => (
                <Link
                  key={id}
                  to="/launch"
                  search={id === 'launches' ? {} : { tab: id }}
                  className={cn(
                    'focus-ring -mb-px border-b-2 border-solid pb-s8 no-underline transition-colors',
                    tab === id
                      ? 'border-accent1 text-neutral1'
                      : 'border-transparent text-neutral3 hover:text-neutral2',
                  )}
                >
                  <Text variant="subheading2" as="span">
                    {label}
                  </Text>
                </Link>
              ))}
            </nav>

            {read.problem ? (
              <Text variant="body4" className="text-exposed" role="status">
                {read.problem}
              </Text>
            ) : null}

            {tab === 'launches' ? (
              <div className="flex flex-col gap-s12">
                {read.launches.length === 0 ? (
                  <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                    <Text variant="body3" className="text-neutral2">
                      {read.loading
                        ? 'Reading the launch contract…'
                        : 'Nothing is selling right now. Anyone can launch a token — including you.'}
                    </Text>
                    <Button variant="primary" size="md" className="self-start" onClick={() => setCreating(true)}>
                      Create a launch
                    </Button>
                  </section>
                ) : (
                  <div className="grid gap-s12 md:grid-cols-2">
                    {read.launches.map((launch) => (
                      <LaunchCard
                        key={launch.id}
                        launch={launch}
                        now={now}
                        onBuy={() => setBuying(launch)}
                      />
                    ))}
                  </div>
                )}
                <YourPositions />
              </div>
            ) : null}

            {tab === 'tokens' ? (
              <TokenTable
                launches={read.launches}
                now={now}
                emptyLine={
                  read.loading
                    ? 'Reading the launch contract…'
                    : 'No tokens yet — the first launch to graduate lands here.'
                }
              />
            ) : null}

            {tab === 'activity' ? (
              <ActivityTape
                items={feed.tape}
                markets={feed.markets}
                launches={read.launches}
                emptyLine={
                  feed.stream === 'live'
                    ? 'Quiet on-chain right now — the next buy, launch or graduation lands here as it happens.'
                    : 'The live feed is reconnecting. Activity resumes with it; nothing is lost.'
                }
              />
            ) : null}
          </>
        ) : (
          <section className="rounded-large border border-solid border-surface3 p-s16">
            <Text variant="subheading2" as="h2">
              Not open yet
            </Text>
            <Text variant="body3" className="mt-s4 max-w-[70ch] text-neutral2">
              {LAUNCH_NOT_DEPLOYED}
            </Text>
          </section>
        )}

        {/* The mechanism, kept — one quiet strip instead of three cards standing where the product goes. */}
        <footer className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16 lg:flex-row lg:gap-s16">
          {[LAUNCH_EPOCH_FACT, LAUNCH_BUYER_HIDDEN, `${LAUNCH_GRADUATION} ${LAUNCH_REFUND}`].map(
            (fact) => (
              <Text key={fact.slice(0, 24)} variant="body4" className="flex-1 text-neutral3">
                {fact}
              </Text>
            ),
          )}
        </footer>

        {buying ? (
          <BuyTicket launch={buying} open={buying !== null} onClose={() => setBuying(null)} />
        ) : null}
        <CreateLaunch open={creating} onClose={() => setCreating(false)} />
      </div>
    </Surface>
  )
}
