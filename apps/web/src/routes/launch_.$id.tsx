import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import {
  UNITS_PER_EPOCH,
  currentEpoch,
  raiseTarget,
  soldPct,
  timeLeft,
  unitPriceAt,
} from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { logoDisplayUrl } from '@strk20/protocol/token-media'

import { launchTalkTag } from '@strk20/protocol/open-room-tags'

import { ActivityTape } from '../components/launch/ActivityTape'
import { BuyForm } from '../components/launch/BuyPanel'
import { TalkThread } from '../components/launch/TalkThread'
import { Staircase } from '../components/launch/Staircase'
import { YourPositions } from '../components/launch/YourPositions'
import { PHASE_CHIP, PHASE_SENTENCE, phaseOf } from '../components/launch/phase'
import { Text } from '../components/ui/Text'
import { TokenLogo, accentFor } from '../components/TokenLogo'
import { shortenFelt } from '../shell/session'
import { useChainFeed } from '../shell/chain-feed'
import { useLaunches } from '../shell/use-app-reads'
import { findToken, useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/launch_/$id')({
  component: LaunchDetail,
})

//
// ONE SALE, WHOLE — the curve page. Uniswap's token-detail grammar (breadcrumb → header → left
// column of fact, right rail of action, the rail always mounted) applied to a launch in progress:
// the staircase at full size, the numbers the contract holds, the sale's own public history, and
// the buy form standing beside it all — never behind a second click.
//
function LaunchDetail() {
  const { id } = Route.useParams()
  const launchId = /^\d+$/.test(id) ? Number(id) : null
  const read = useLaunches()
  const feed = useChainFeed()
  const { tokens } = useTokenList()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const launch = launchId === null ? undefined : read.launches.find((l) => l.id === launchId)

  if (!launch) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s12">
          <Crumb />
          <Text variant="body3" className="text-neutral2">
            {launchId === null
              ? 'That is not a launch id.'
              : read.loading
                ? 'Reading the launch contract…'
                : `Launch ${launchId} is not in the read window — the list carries the newest launches, and this one is either older than that or not created yet.`}
          </Text>
        </div>
      </Surface>
    )
  }

  const stake = findToken(tokens, launch.stakeToken)
  const symbol = stake?.symbol ?? shortenFelt(launch.stakeToken, 4, 3)
  const decimals = stake?.decimals ?? 18
  const phase = phaseOf(launch, now)
  const epoch = currentEpoch(launch)
  const price = unitPriceAt(launch, epoch)
  const target = raiseTarget(launch)
  const accent = accentFor(launch.name || launch.symbol)

  const stats: Array<[string, string]> = [
    ['Raised', `${toPlainText(launch.raised, decimals)} ${symbol}`],
    ['Target', `${toPlainText(target, decimals)} ${symbol}`],
    ['Sold', `${launch.sold} of ${launch.epochs * UNITS_PER_EPOCH} units · ${soldPct(launch)}%`],
    ['Epoch', `${epoch + 1} of ${launch.epochs}`],
    ['Price this epoch', `${toPlainText(price, decimals)} ${symbol} / unit`],
    [
      phase === 'selling' ? 'Closes' : 'Closed',
      phase === 'selling' ? timeLeft(launch.deadline, now) : new Date(launch.deadline * 1000).toLocaleDateString(),
    ],
  ]

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <Crumb name={launch.name || launch.symbol} />

        <header
          className="flex flex-wrap items-center gap-s12 rounded-large border border-solid border-surface3 p-s16"
          style={{ backgroundImage: `radial-gradient(120% 130% at 0% 0%, ${accent}24, transparent 60%)` }}
        >
          <TokenLogo url={logoDisplayUrl(launch.logoUri)} symbol={launch.symbol} name={launch.name} size={48} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-s8">
              <Text variant="display3" as="h1" className="truncate text-neutral1">
                {launch.name || `Launch ${launch.id}`}
              </Text>
              <span className="rounded-pill border border-solid border-surface3 px-s8 py-s2 font-mono text-mono text-neutral2">
                {PHASE_CHIP[phase]}
              </span>
            </div>
            <Text variant="mono" className="text-neutral3">
              {launch.symbol} · stakes {symbol}
            </Text>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <Text variant="display3" as="p" className="numeric text-neutral1">
              {toPlainText(price, decimals)} {symbol}
            </Text>
            <Text variant="body4" className="text-neutral3">
              per unit — same for everyone inside epoch {epoch + 1}
            </Text>
          </div>
        </header>

        <div className="grid gap-s16 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-s16">
            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The curve</Text>
              <div style={{ color: accent }}>
                <Staircase epochs={launch.epochs} at={epoch} height={120} />
              </div>
              <Text variant="body4" className="text-neutral3">
                Flat within an epoch, a step between them — being first inside an epoch is worth
                nothing, which is the whole point.
              </Text>
            </section>

            <section className="rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The numbers</Text>
              <dl className="mt-s8 grid grid-cols-2 gap-s12 md:grid-cols-3">
                {stats.map(([label, value]) => (
                  <div key={label} className="flex flex-col">
                    <dt className="text-body4 text-neutral3">{label}</dt>
                    <dd className="numeric m-s0 font-mono text-body3 text-neutral1">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Activity</Text>
              <ActivityTape
                items={feed.tape}
                markets={feed.markets}
                launches={read.launches}
                scope={{ launchId: launch.id }}
                emptyLine="No buys have landed in the feed's window yet — the next one appears here as it happens."
              />
            </section>

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Talk</Text>
              <TalkThread
                tag={launchTalkTag(launch.id)}
                emptyLine="Nobody has said anything about this sale yet. The room is open."
              />
            </section>
          </div>

          <aside className="flex flex-col gap-s12 self-start lg:sticky lg:top-[88px]">
            {phase === 'selling' ? (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
                <Text variant="subheading2" as="h2" className="text-neutral1">
                  Buy this epoch
                </Text>
                <BuyForm launch={launch} />
              </section>
            ) : (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
                <Text variant="subheading2" as="h2" className="text-neutral1">
                  {PHASE_CHIP[phase]}
                </Text>
                <Text variant="body4" className="text-neutral2">
                  {PHASE_SENTENCE[phase as Exclude<typeof phase, 'selling'>]}
                </Text>
                {phase === 'graduated' && launch.token !== '0x0' ? (
                  <Link
                    to="/token/$address"
                    params={{ address: launch.token }}
                    preload="intent"
                    className="focus-ring text-body3 text-accent1 underline"
                  >
                    Open the token page →
                  </Link>
                ) : null}
              </section>
            )}
            <YourPositions
              launchId={launch.id}
              launch={launch}
              stakeSymbol={symbol}
              stakeDecimals={decimals}
            />
          </aside>
        </div>
      </div>
    </Surface>
  )
}

function Crumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-s6 font-mono text-mono text-neutral3">
      <Link to="/launch" className="focus-ring no-underline hover:text-neutral1">
        Launch
      </Link>
      <span aria-hidden="true">›</span>
      <span className="text-neutral2">{name ?? '…'}</span>
    </nav>
  )
}
