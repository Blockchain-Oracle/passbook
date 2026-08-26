import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { BookState, ShieldedBalance, TokenBalance } from '@strk20/protocol/balances'
import { toPlainText } from '@strk20/protocol/amount'

import { ActivityFeed } from '../components/ActivityFeed'
import { TokenLogo } from '../components/TokenLogo'
import { Button } from '../components/ui/Button'
import { Skeleton, SkeletonBox } from '../components/ui/Skeleton'
import { Text } from '../components/ui/Text'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { useBalance } from '../shell/use-balance'
import { findToken, useTokenList } from '../shell/use-token-list'
import { useSession, shortenFelt } from '../shell/session'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/wallet')({
  //
  // KEPT EAGER, DELIBERATELY, and this is the lever rather than a `vite.config.ts` edit.
  //
  // `/wallet` is where the cold open lands: `/` redirects here before anything paints, so this
  // surface is on the critical path of literally every first visit. The router plugin's default
  // groupings split `component`, `errorComponent` and `notFoundComponent` into their own chunks —
  // for this one route that turns first paint into a second round trip.
  //
  // An empty grouping list means "group nothing away". The plugin reads `codeSplitGroupings` off the
  // route options with a babel pass and it takes precedence over both the plugin-level
  // `splitBehavior` and the global default (`fromCode.groupings ?? pluginSplitBehavior ?? global`),
  // so this literal is the whole mechanism — it must stay an inline array literal in this call, not
  // a constant imported from somewhere, or the babel pass cannot see it.
  //
  codeSplitGroupings: [],
  component: Wallet,
})

//
// THE NAMESAKE OBLIGATION, NOW DISCHARGED.
//
// "A product named Passbook must render the book" — balance and history are the substrate, not a
// dashboard afterthought. Both halves are here: the balance is a real discovery walk against the
// mainnet pool, and the record is below it.
//
// The balance half was deferred for a real reason — the walk needs the privacy SDK and the bundle
// gate banned it outright. That gate now scopes its ban to what the DOCUMENT fetches at first
// paint, so the walk lives in a chunk this surface asks for after it has drawn.
//
function Wallet() {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, loading, refresh } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const [receiving, setReceiving] = useState(false)

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <div className="flex items-center justify-between gap-s12">
          <Text variant="heading3" as="h1">
            Wallet
          </Text>
          {ready ? (
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              {loading ? 'Reading…' : 'Refresh'}
            </Button>
          ) : null}
        </div>

        {session.status === 'failed' ? (
          <p className="text-body3 text-exposed">{session.because}</p>
        ) : (
          <>
            <BalanceCard balance={balance} loading={loading || session.status === 'loading'} />

            <div className="flex gap-s8">
              <Button variant="secondary" size="md" fill onClick={() => setReceiving(true)}>
                Receive
              </Button>
              {/*
                No Send button yet, and its absence is the honest form of "there is nothing to
                send". A button that opened a form which could not submit would be the overclaim
                this repository fails builds over. It arrives with the submission path.
              */}
            </div>
          </>
        )}

        <ActivityFeed />
      </div>

      {ready ? (
        <ResponsiveDialog open={receiving} onOpenChange={setReceiving} label="Receive" modal>
          <div className="flex w-full min-w-0 flex-col gap-s12">
            <Text variant="subheading1" as="h2">
              Receive
            </Text>
            <Text variant="body3" className="text-neutral2">
              This is where your account will live. It is exact before the account is deployed —
              anything sent here waits for it.
            </Text>
            <code className="break-all rounded-card bg-inset p-s12 font-mono text-mono text-neutral1">
              {ready.address}
            </code>
            <Button
              variant="secondary"
              size="md"
              fill
              onClick={() => void navigator.clipboard?.writeText(ready.address)}
            >
              Copy address
            </Button>
          </div>
        </ResponsiveDialog>
      ) : null}
    </Surface>
  )
}

/**
 * What the account holds — or, precisely, what we know about what it holds.
 *
 * THE FOUR BOOK STATES GET FOUR DIFFERENT SENTENCES. Collapsing `unknown` into a zero would tell
 * someone they have nothing when the truth is that the walk did not finish, which is the most
 * damaging thing this screen could say.
 */
function BalanceCard({ balance, loading }: { balance: ShieldedBalance | null; loading: boolean }) {
  if (loading && !balance) {
    return (
      <div className="flex flex-col gap-s8 rounded-large bg-inset p-s16">
        <Skeleton>
          <SkeletonBox className="h-s16 w-[35%]" />
        </Skeleton>
        <Skeleton style={{ opacity: 0.6 }}>
          <SkeletonBox className="h-s28 w-[55%]" />
        </Skeleton>
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="rounded-large bg-inset p-s16">
        <Text variant="body3" className="text-neutral2">
          Your shielded balance hasn&rsquo;t been read yet.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-s12 rounded-large bg-inset p-s16">
      <div className="flex items-baseline justify-between gap-s8">
        <Text variant="body4" className="text-neutral2">
          Shielded balance
        </Text>
        {/*
          THE BLOCK STAMP, and the grammar is "as of about" rather than "at". The walk cannot be
          pinned to a block — `discoverWallet` explains why — so this is the height the same
          provider reported immediately before walking, and the copy says exactly that.
        */}
        {balance.blockNumber !== null ? (
          <Text variant="body4" className="numeric text-neutral3">
            as of about block {balance.blockNumber.toLocaleString('en-US')}
          </Text>
        ) : null}
      </div>

      {balance.tokens.length > 0 ? (
        <ul className="flex flex-col gap-s8">
          {balance.tokens.map((holding) => (
            <HoldingRow key={holding.token} holding={holding} />
          ))}
        </ul>
      ) : (
        <Text variant="body3" className={balance.book === 'unknown' ? 'text-exposed' : 'text-neutral2'}>
          {BOOK_SENTENCE[balance.book]}
        </Text>
      )}
    </div>
  )
}

/**
 * One holding.
 *
 * ── AN UNVERIFIED SCALE IS SHOWN IN RAW UNITS, AND LABELLED ──────────────────────────────
 *
 * `TokenBalance.decimals` is `null` when this app has not confirmed the token's scale against its
 * own contract. Rendering that as a decimal number means picking a scale, and the whole reason
 * `token-list.ts` verifies decimals on-chain is that a guessed 18 on a 6-decimal token misplaces
 * the value by a factor of a million — in the direction that looks like dust.
 *
 * So an unverified token shows its exact integer and says "raw units". Ugly on purpose: the
 * alternative is a pretty number that is wrong.
 */
function HoldingRow({ holding }: { holding: TokenBalance }) {
  const { tokens } = useTokenList()
  const known = findToken(tokens, holding.token)

  const label = known?.symbol ?? shortenFelt(holding.token)
  const amount =
    holding.decimals !== null
      ? toPlainText(holding.wei, holding.decimals)
      : `${holding.wei.toString()} raw units`

  return (
    <li className="flex items-center justify-between gap-s12">
      <span className="flex min-w-0 items-center gap-s8">
        <TokenLogo
          url={known?.logoUri}
          symbol={known?.symbol ?? label}
          name={known?.name ?? holding.token}
          size={28}
        />
        <Text variant="body2" className="truncate">
          {label}
        </Text>
      </span>
      <span className="flex shrink-0 items-baseline gap-s6">
        <Text variant="body2" className="numeric">
          {amount}
        </Text>
        {/* The note count is what a spend has to pick from, so it is a fact about spendability
            rather than trivia. */}
        <Text variant="body4" className="text-neutral3">
          {holding.noteCount === 1 ? '1 note' : `${holding.noteCount} notes`}
        </Text>
      </span>
    </li>
  )
}

/**
 * One sentence per book state, written out rather than derived.
 *
 * `unknown` is the one that must never read like an empty account: "we could not look" and "there
 * is nothing here" are different facts and only one of them is about the user's money.
 */
const BOOK_SENTENCE: Record<BookState, string> = {
  'not-registered':
    'This account isn’t registered with the pool yet, so nothing could have been sent to it.',
  'no-activity': 'Registered, and holding nothing yet.',
  holdings: 'Holding notes.',
  unknown: 'The pool couldn’t be read, so this isn’t a balance — it’s a gap.',
}
