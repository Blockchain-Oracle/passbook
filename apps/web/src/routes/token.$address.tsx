import { Link, createFileRoute } from '@tanstack/react-router'

import { UNITS_PER_EPOCH } from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { logoDisplayUrl } from '@strk20/protocol/token-media'

import { launchTalkTag } from '@strk20/protocol/open-room-tags'

import { ActivityTape } from '../components/launch/ActivityTape'
import { TalkThread } from '../components/launch/TalkThread'
import { Text } from '../components/ui/Text'
import { TokenLogo, accentFor } from '../components/TokenLogo'
import { shortenFelt } from '../shell/session'
import { useChainFeed } from '../shell/chain-feed'
import { useLaunches } from '../shell/use-app-reads'
import { findToken, useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/token/$address')({
  component: TokenPage,
})

/** Felts compare as numbers — `0x0a` and `0xA` are one address written two ways. */
function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

//
// THE TOKEN PAGE — what a launch becomes, and where any token address can land.
//
// Three honest arms. A token this launchpad graduated gets the full room: its birth carried a
// whole public history (every buy an event) and this page is where that history lives. A token
// the list merely knows gets its identity and the door to the swap. An address nobody knows gets
// the sentence saying so — never a skeleton pretending data is coming.
//
function TokenPage() {
  const { address } = Route.useParams()
  const read = useLaunches()
  const feed = useChainFeed()
  const { tokens } = useTokenList()

  const born = read.launches.find((l) => l.token !== '0x0' && sameFelt(l.token, address))
  const listed = findToken(tokens, address)

  const name = born?.name ?? listed?.name ?? null
  const symbol = born?.symbol ?? listed?.symbol ?? null
  const logo = born ? logoDisplayUrl(born.logoUri) : (listed?.logoUri ?? null)
  const accent = accentFor(name || symbol || address)

  if (!born && !listed) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s12">
          <Crumb />
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            {read.loading
              ? 'Reading the launch contract…'
              : 'Neither the launchpad nor the token list knows this address. If it is a token, it is not one this app can say anything true about.'}
          </Text>
          <Text variant="mono" className="text-neutral3">
            {shortenFelt(address, 12, 10)}
          </Text>
        </div>
      </Surface>
    )
  }

  const stake = born ? findToken(tokens, born.stakeToken) : null
  const stakeSymbol = stake?.symbol ?? 'STRK'
  const stakeDecimals = stake?.decimals ?? 18

  const stats: Array<[string, string]> | null = born
    ? [
        ['Raised at graduation', `${toPlainText(born.raised, stakeDecimals)} ${stakeSymbol}`],
        ['Units sold', `${born.sold} of ${born.epochs * UNITS_PER_EPOCH}`],
        ['Supply', `${toPlainText(born.unitTokens * BigInt(born.sold), 18)} ${born.symbol}`],
        ['Epochs', String(born.epochs)],
      ]
    : null

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <Crumb name={name ?? symbol ?? shortenFelt(address, 6, 4)} />

        <header
          className="flex flex-wrap items-center gap-s12 rounded-large border border-solid border-surface3 p-s16"
          style={{ backgroundImage: `radial-gradient(120% 130% at 0% 0%, ${accent}24, transparent 60%)` }}
        >
          <TokenLogo url={logo} symbol={symbol} name={name} size={48} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-s8">
              <Text variant="display3" as="h1" className="truncate text-neutral1">
                {name ?? symbol ?? 'Token'}
              </Text>
              {born ? (
                <span className="rounded-pill border border-solid border-settled px-s8 py-s2 font-mono text-mono text-settled">
                  Born here
                </span>
              ) : null}
            </div>
            <Text variant="mono" className="truncate text-neutral3">
              {symbol ?? '—'} · {shortenFelt(address, 10, 8)}
            </Text>
          </div>
        </header>

        <div className="grid gap-s16 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-s16">
            {stats ? (
              <section className="rounded-large border border-solid border-surface3 p-s16">
                <Text variant="kicker">The raise, settled</Text>
                <dl className="mt-s8 grid grid-cols-2 gap-s12 md:grid-cols-4">
                  {stats.map(([label, value]) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-body4 text-neutral3">{label}</dt>
                      <dd className="numeric m-s0 font-mono text-body3 text-neutral1">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {born ? (
              <>
                <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                  <Text variant="kicker">Its history</Text>
                  <ActivityTape
                    items={feed.tape}
                    markets={feed.markets}
                    launches={read.launches}
                    scope={{ launchId: born.id }}
                    emptyLine="Nothing from this token's sale is inside the feed's window — its full history stays on chain."
                  />
                </section>
                <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                  <Text variant="kicker">Talk</Text>
                  <TalkThread
                    tag={launchTalkTag(born.id)}
                    emptyLine="Nobody has said anything about this token yet. The room is open."
                  />
                </section>
              </>
            ) : (
              <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
                <Text variant="kicker">What this app knows</Text>
                <Text variant="body3" className="max-w-[70ch] text-neutral2">
                  This token comes from the public token list, not from this launchpad — so its
                  history is not ours to show. What is ours: you can hold it shielded, and swap it
                  without the swap being yours on chain.
                </Text>
              </section>
            )}
          </div>

          <aside className="flex flex-col gap-s12 self-start lg:sticky lg:top-[88px]">
            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
              <Text variant="subheading2" as="h2" className="text-neutral1">
                Trade it
              </Text>
              <Text variant="body4" className="text-neutral2">
                {born
                  ? 'Redeem your units into tokens from your positions, or swap it like any other asset — shielded, from the pool.'
                  : 'Swap it shielded, from the pool — the swap surface prices it live.'}
              </Text>
              <Link to="/swap" preload="intent" className="focus-ring text-body3 text-accent1 underline">
                Open the swap →
              </Link>
              {born ? (
                <Link
                  to="/launch/$id"
                  params={{ id: String(born.id) }}
                  preload="intent"
                  className="focus-ring text-body3 text-neutral2 underline"
                >
                  See the sale it came from →
                </Link>
              ) : null}
            </section>
          </aside>
        </div>
      </div>
    </Surface>
  )
}

function Crumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-s6 font-mono text-mono text-neutral3">
      <Link to="/launch" search={{ tab: 'tokens' }} className="focus-ring no-underline hover:text-neutral1">
        Tokens
      </Link>
      <span aria-hidden="true">›</span>
      <span className="text-neutral2">{name ?? '…'}</span>
    </nav>
  )
}
