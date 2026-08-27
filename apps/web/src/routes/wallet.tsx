import { createFileRoute, Link } from '@tanstack/react-router'
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BookState, ShieldedBalance, TokenBalance } from '@strk20/protocol/balances'
import { toPlainText } from '@strk20/protocol/amount'
import {
  LOCKED_BODY,
  LOCKED_HEADLINE,
  LOCK_WHAT_IT_DOES,
  UNLOCK_ACTION,
} from '@strk20/protocol/account-copy'

import { AccountLadder } from '../components/AccountLadder'
import { ConversionPanel } from '../components/onboarding/ConversionPanel'
import { BackupCeremony } from '../components/BackupCeremony'
import { ActivityFeed } from '../components/ActivityFeed'
import { IdentityDisc } from '../components/IdentityDisc'
import { TokenLogo } from '../components/TokenLogo'
import { Button } from '../components/ui/Button'
import { Skeleton, SkeletonBox } from '../components/ui/Skeleton'
import { Text } from '../components/ui/Text'
import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { readAccountStatus, type AccountStatus } from '../shell/account-status'
import { deployAccount } from '../shell/submit'
import { registerAccount } from '../shell/register'
import type { RegistrationStage } from '@strk20/protocol/pipeline-stage'
import { useBalance } from '../shell/use-balance'
import { useActivity } from '../shell/use-activity'
import { findToken, useTokenList } from '../shell/use-token-list'
import { labelAccount, unlockSession, useSession, shortenFelt, type SessionState } from '../shell/session'
import { useFirstRun } from '../shell/use-first-run'
import { usePoolFee } from '../shell/use-pool-fee'
import { claimAfterRegistration } from '../shell/claim-after-registration'
import { Surface } from '../shell/Surface'

//
// THE QR LIBRARY IS BEHIND A LAZY BOUNDARY, AND THIS ROUTE IS WHY.
//
// `/wallet` is deliberately eager (see `codeSplitGroupings` below), so anything it imports
// statically is fetched, parsed and executed before first paint on every cold open. `qrcode.react`
// is only needed once somebody presses Receive, and the gate caps first paint at 700 kB — so it
// lives in its own chunk that the dialog asks for when it opens.
//
const ReceivePanel = lazy(() => import('../components/ReceivePanel'))

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
// mainnet pool, and the record is beside it.
//
// THIS FUNCTION IS ONLY THE SESSION'S FOUR ARMS. The account's own surface is `WalletAccount`,
// mounted under a `key`; the geometry is `WalletFrame`. Both splits are explained where they live.
//
/**
 * The app's own name, for the fee row.
 *
 * NOT imported from `register.ts`, which is where `DEFAULT_APP_NAME` lives: that module is loaded
 * lazily on purpose and a static import of it for one short string would pull the whole
 * registration graph into the eager chunk. The build gate caught exactly that and refused it.
 * `onboarding-copy.test.ts` pins the fee row's shape; the name inside it is a caller's to supply.
 */
const APP_NAME = 'Passbook'

function Wallet() {
  const session = useSession()

  if (session.status === 'failed') {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s12">
          <Text variant="heading3" as="h1">
            Wallet
          </Text>
          <p className="text-body3 text-exposed">{session.because}</p>
        </div>
      </Surface>
    )
  }

  //
  // THE LOCK IS A WHOLE-SURFACE STATE, NOT A BANNER.
  //
  // A locked wallet that still renders a balance and four action buttons has not locked anything
  // that matters — the point of the state is that the key is out of the page, so every control
  // that would need it is genuinely unavailable rather than styled as if it were.
  //
  if (session.status === 'locked') {
    return (
      <Surface routeId={Route.fullPath}>
        <WalletLocked
          address={session.address}
          label={session.label}
          problem={session.problem}
          accounts={session.accounts.length}
        />
      </Surface>
    )
  }

  //
  // KEYED ON THE ADDRESS, AND THAT `key` IS A CORRECTNESS FIX RATHER THAN A HINT.
  //
  // Everything below this line is a fact about ONE account: what it holds, where it stands on the
  // ladder, whether its recovery file has been written. React keeps state across a re-render, so
  // with the account switcher shipped, a switch used to re-render this surface with a new address
  // and every one of those values still describing the old one.
  //
  // The worst of them was `backedUp`. It is the ceremony's terminal state and the only input to
  // `canRegister`, so completing the ceremony for account A and then creating account B left
  // Register enabled for an account whose Recovery File had never been written — and the pool
  // writes a viewing key ONCE, so that account would have been permanently unrecoverable. Exactly
  // the outcome `backup-gate.ts` exists to prevent.
  //
  // A reset effect per value would have fixed the four that exist today and been forgotten by the
  // fifth — `accountStatus` was already missed once that way. Remounting on identity change makes
  // it structural: state that belongs to an account cannot outlive it, and nothing has to remember.
  //
  return session.status === 'loading' ? (
    <Surface routeId={Route.fullPath}>
      {/* The same frame, so nothing moves sideways when the account arrives a beat after paint. */}
      <WalletFrame
        rail={
          <>
            <Text variant="heading3" as="h1">
              Wallet
            </Text>
            <BalanceHero balance={null} loading address={null} />
          </>
        }
        feed={null}
      />
    </Surface>
  ) : (
    <Surface routeId={Route.fullPath}>
      <WalletAccount key={session.address} session={session} />
    </Surface>
  )
}

/**
 * One account's wallet. Remounted whenever the account changes — see `Wallet`'s `key`.
 */
function WalletAccount({ session }: { session: Extract<SessionState, { status: 'ready' }> }) {
  const { balance, read, loading, refresh } = useBalance(session.address, session.accountKey)
  // The record, off the same walk. It publishes into the store `ActivityFeed` subscribes to, so
  // nothing is threaded through — but its two honest sentences are, because the feed cannot know
  // that a read failed or was truncated from the rows alone.
  const activity = useActivity(read, session.accountKey)
  const [receiving, setReceiving] = useState(false)
  const firstRun = useFirstRun()
  const poolFee = usePoolFee()
  //
  // WHAT THE NAME SCREEN ASKED FOR, held until registration confirms.
  //
  // The claim cannot be made earlier: the relayer verifies it against the public key the POOL
  // holds, and before registration the pool holds nothing. So the intent is captured on screen 1
  // and spent at the end — a ref rather than state, because nothing renders from it and a re-render
  // between the two moments would be noise.
  //
  const pendingClaim = useRef<{ name: string; claimPublicly: boolean }>({ name: '', claimPublicly: false })

  // Plain JSON-RPC, no SDK — so the ladder can say where the account stands before the crypto
  // graph has finished loading.
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null)
  const [statusNonce, setStatusNonce] = useState(0)
  const [deploying, setDeploying] = useState(false)
  const [deployProblem, setDeployProblem] = useState<string | null>(null)
  // The ceremony's terminal state IS `canRegister`. Registration reads it and the pipeline
  // enforces it again — a guard that lives only in the caller is one the next caller forgets.
  const [backedUp, setBackedUp] = useState(false)
  const [registering, setRegistering] = useState<RegistrationStage | null>(null)
  const [registerProblem, setRegisterProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void readAccountStatus(session.address).then((status) => {
      if (live) setAccountStatus(status)
    })
    return () => {
      live = false
    }
  }, [session.address, statusNonce])

  const onRegister = useCallback(async () => {
    setRegisterProblem(null)
    setRegistering('build')
    const result = await registerAccount({
      accountKey: session.accountKey,
      address: session.address,
      backedUp,
      onStage: setRegistering,
    })
    setRegistering(null)
    if (!result.ok) {
      setRegisterProblem(result.because)
      return
    }
    // Re-read rather than assume the rung moved — the ladder reports what it reads.
    setStatusNonce((n) => n + 1)

    // THE NAME, NOW THAT THERE IS A KEY ON-CHAIN TO VERIFY IT AGAINST.
    //
    // Not awaited, and every failure inside it becomes a toast rather than an error state — see
    // `claim-after-registration.ts`. The registration has already confirmed at this point, so
    // nothing about a directory entry is allowed to make a working account look broken.
    void claimAfterRegistration({
      ...pendingClaim.current,
      address: session.address,
      viewingKey: session.viewingKey,
    })
    pendingClaim.current = { name: '', claimPublicly: false }
  }, [session.accountKey, session.address, session.viewingKey, backedUp])

  const onDeploy = useCallback(async () => {
    setDeploying(true)
    setDeployProblem(null)
    const result = await deployAccount(session.accountKey, session.address)
    setDeploying(false)
    if (!result.ok) {
      setDeployProblem(result.because)
      return
    }
    // Re-read rather than assuming the rung moved. `deployAccount` already confirmed the class is
    // on chain, but the ladder's job is to report what it reads.
    setStatusNonce((n) => n + 1)
  }, [session.accountKey, session.address])

  return (
    <>
      <WalletFrame
        rail={
          <>
            <div className="flex items-center justify-between gap-s12">
              <Text variant="heading3" as="h1">
                Wallet
              </Text>
              <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
                {loading ? 'Reading…' : 'Refresh'}
              </Button>
            </div>

            <BalanceHero balance={balance} loading={loading} address={session.address} />

            <ActionRow
              onReceive={() => {
                // TRIGGER 2 of the brief's three: pressing Receive. It opens conversion only for an
                // account that cannot yet be paid — a registered account pressing Receive wants the
                // QR, not a walkthrough.
                if (accountStatus !== null && accountStatus.rung !== 'ready') {
                  firstRun.start('receive', { hasAccount: false })
                  return
                }
                setReceiving(true)
              }}
              disabled={false}
            />

            {/*
              CONVERSION, INLINE AND ABOVE THE LADDER.

              A row on the page rather than a scrimmed dialog, per §1: the page stays interactive and
              anything the visitor already composed survives. It renders only while it is open, so
              the ordinary wallet is unchanged for an account that has already registered.
            */}
            {firstRun.open ? (
              <ConversionPanel
                feeStrk={poolFee}
                appName={APP_NAME}
                onGenerateKey={async (label, claimPublicly) => {
                  // Held for the registration step; see `pendingClaim`.
                  pendingClaim.current = { name: label, claimPublicly }
                  // The key already exists — the session mints one on first boot — so this names it
                  // rather than generating it. See the note on `feeStrk` below for why that gap is
                  // reported rather than papered over.
                  if (label !== '') await labelAccount(session.address, label)
                }}
                onRegister={onRegister}
                registered={accountStatus?.rung === 'ready'}
                renderBackup={(onDone) => (
                  <BackupCeremony
                    accountKey={session.accountKey}
                    receiveAddress={session.address}
                    onComplete={() => {
                      setBackedUp(true)
                      onDone()
                    }}
                  />
                )}
                onDismiss={firstRun.dismiss}
              />
            ) : null}

            {/*
              WHAT THIS ACCOUNT CAN DO, AND WHAT IT NEEDS NEXT.

              An embedded key is not yet an account that can transact — it has to be funded, then
              deployed, then registered, in that order, and the order is protocol rather than
              preference. Naming the rung is what turns "something went wrong" into "here is the
              one thing to do next".
            */}
            {accountStatus ? (
              <AccountLadder
                status={accountStatus}
                onDeploy={onDeploy}
                deploying={deploying}
                problem={deployProblem}
                onRegister={onRegister}
                registering={registering}
                registerProblem={registerProblem}
                canRegister={backedUp}
                backup={
                  <BackupCeremony
                    accountKey={session.accountKey}
                    receiveAddress={session.address}
                    onComplete={() => setBackedUp(true)}
                  />
                }
              />
            ) : null}
          </>
        }
        feed={
          <ActivityFeed
            problem={activity.problem}
            windowNote={activity.windowNote}
            headBlock={balance?.blockNumber ?? null}
          />
        }
      />

      <ResponsiveDialog open={receiving} onOpenChange={setReceiving} label="Receive" modal>
        {/*
          The fallback reserves the panel's rough height so opening the dialog does not draw a
          box that then doubles in size when the QR chunk lands.
        */}
        <Suspense
          fallback={
            <Skeleton className="flex w-full flex-col gap-s12">
              <SkeletonBox className="h-s28 w-[40%]" />
              <SkeletonBox className="h-[200px] w-full rounded-card" />
            </Skeleton>
          }
        >
          <ReceivePanel address={session.address} />
        </Suspense>
      </ResponsiveDialog>
    </>
  )
}

/**
 * The surface's geometry, with nothing in it.
 *
 * ── THE 480px COLUMN IS GONE ON THIS ROUTE ───────────────────────────────────────────────
 *
 * Every surface in this app used to be the same centred `max-w-[480px]` stack, which is right for
 * a form and wrong for a wallet: it puts the history below the fold on a 1440px screen, where most
 * of the people judging this will open it. From 1024 up the surface is two columns — a 380px rail
 * carrying the balance, the four actions and the setup ladder, and the rest of the width carrying
 * the record. Below that it is the same stack it always was, because one column IS the right
 * answer on a phone.
 *
 * Separated from `WalletAccount` so the loading arm holds the same geometry rather than drawing a
 * narrower one that jumps sideways when the account arrives.
 */
function WalletFrame({ rail, feed }: { rail: ReactNode; feed: ReactNode }) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[480px] flex-col gap-s16',
        // `items-start` so the rail does not stretch to the history's height, and `minmax(0,1fr)`
        // so a wide row inside the feed cannot blow the column out.
        'lg:grid lg:max-w-[1180px] lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-s24',
      )}
    >
      <div className="flex flex-col gap-s16">{rail}</div>
      {feed}
    </div>
  )
}

/**
 * The locked surface.
 *
 * It shows WHICH account is locked — the disc and the short address — because a browser can hold
 * several and unlocking the wrong one is a wasted step. It shows no balance, because reading one
 * needs the key this state does not have.
 */
function WalletLocked({
  address,
  label,
  problem,
  accounts,
}: {
  address: string
  label: string | null
  problem: string | null
  accounts: number
}) {
  const [busy, setBusy] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col items-start gap-s16 py-s32">
      <IdentityDisc address={address} size={56} />
      <div className="flex flex-col gap-s4">
        <Text variant="heading3" as="h1">
          {LOCKED_HEADLINE}
        </Text>
        <Text variant="body2" className="text-neutral2">
          {LOCKED_BODY}
        </Text>
      </div>

      <div className="flex flex-col gap-s2">
        <Text variant="body3" className="truncate">
          {label ?? 'This browser’s account'}
        </Text>
        <Text variant="mono" className="text-neutral3">
          {shortenFelt(address, 10, 8)}
        </Text>
      </div>

      {problem ? (
        <Text variant="body3" className="text-irreversible" role="alert">
          {problem}
        </Text>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void unlockSession().then(() => setBusy(false))
        }}
      >
        {busy ? 'Unlocking…' : UNLOCK_ACTION}
      </Button>

      <Text variant="body4" className="max-w-[42ch] text-neutral3">
        {LOCK_WHAT_IT_DOES}
      </Text>

      {accounts > 1 ? (
        <Text variant="body4" className="text-neutral3">
          {accounts} accounts are saved in this browser. Unlock, then switch from the account menu.
        </Text>
      ) : null}
    </div>
  )
}

/**
 * The four things a wallet does, as one row.
 *
 * ── THREE ANCHORS AND ONE BUTTON, WHICH IS THE HONEST SPLIT ──────────────────────────────
 *
 * Send, Swap and Bridge are DESTINATIONS, so they are real `<a>`s — middle-click, cmd-click and
 * "open in new tab" work, and they only work on an anchor. Receive is not a destination; it opens
 * a dialog and stays where it is. Making all four look alike is a styling job, not a reason to
 * make the wrong element.
 */
function ActionRow({ onReceive, disabled }: { onReceive: () => void; disabled: boolean }) {
  const tile = cn(
    'focus-ring flex flex-1 cursor-pointer flex-col items-center gap-s6 rounded-card',
    'border border-solid border-surface3 bg-raised px-s8 py-s12 no-underline',
    'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
    'hover:bg-inset',
  )

  return (
    <div className="flex gap-s8">
      <Link to="/send" className={tile}>
        <ActionGlyph d="M12 19V5M12 5l-6 6M12 5l6 6" />
        <span className="text-buttonLabel3 text-neutral1">Send</span>
      </Link>
      <button type="button" onClick={onReceive} disabled={disabled} className={cn(tile, 'disabled:opacity-60')}>
        <ActionGlyph d="M12 5v14M12 19l6-6M12 19l-6-6" />
        <span className="text-buttonLabel3 text-neutral1">Receive</span>
      </button>
      <Link to="/swap" className={tile}>
        <ActionGlyph d="M7 7h11l-3-3M17 17H6l3 3" />
        <span className="text-buttonLabel3 text-neutral1">Swap</span>
      </Link>
      <Link to="/bridge" className={tile}>
        <ActionGlyph d="M4 15c0-4 3.6-7 8-7s8 3 8 7M4 15h16M8 15v4M16 15v4" />
        <span className="text-buttonLabel3 text-neutral1">Bridge</span>
      </Link>
    </div>
  )
}

/** One 20px stroke glyph. `currentColor` so it follows the tile's ink in both themes. */
function ActionGlyph({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-neutral2"
    >
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * What the account holds — or, precisely, what we know about what it holds.
 *
 * ── ONE OBJECT, ONE NUMBER, AND THE NUMBER IS NOT A TOTAL ────────────────────────────────
 *
 * zk-freighter's hero is a 52px tabular figure and it is right about the scale: the balance is the
 * reason the screen exists and everything else on it is subordinate. What this one cannot copy is
 * the word "total" — summing USDC and STRK needs prices, this app reads no oracle, and a number
 * labelled as a total that is actually one holding is the most quietly wrong thing a wallet can
 * print. So the hero is the FIRST holding the walk reported, with its own symbol beside it, the
 * rest are rows underneath, and nothing anywhere claims to be a sum.
 *
 * ── THE FOUR BOOK STATES GET FOUR DIFFERENT SENTENCES ────────────────────────────────────
 *
 * Collapsing `unknown` into a zero would tell someone they have nothing when the truth is that the
 * walk did not finish, which is the most damaging thing this screen could say.
 */
function BalanceHero({
  balance,
  loading,
  address,
}: {
  balance: ShieldedBalance | null
  loading: boolean
  address: string | null
}) {
  const { tokens } = useTokenList()

  const lead = balance?.tokens[0] ?? null
  const known = lead ? findToken(tokens, lead.token) : null
  const headline =
    lead === null
      ? '—'
      : lead.decimals !== null
        ? toPlainText(lead.wei, lead.decimals)
        : lead.wei.toString()

  return (
    <section
      className={cn(
        'flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-inset p-s16',
      )}
    >
      <div className="flex items-center justify-between gap-s8">
        <Text variant="body4" className="text-neutral2">
          Shielded balance
        </Text>
        <SyncState loading={loading} book={balance?.book ?? null} />
      </div>

      {loading && !balance ? (
        <Skeleton className="flex flex-col gap-s8">
          <SkeletonBox className="h-s48 w-[60%]" />
          <SkeletonBox className="h-s16 w-[35%]" />
        </Skeleton>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-s8">
            {/*
              `numeric` is the app's tabular-figures class. Without it the digits change width as
              the value changes and the hero jitters on every refresh.
            */}
            <span
              className={cn(
                'numeric text-heading1 leading-none',
                balance?.book === 'unknown' ? 'text-neutral3' : 'text-neutral1',
              )}
            >
              {headline}
            </span>
            {lead ? (
              <span className="text-subheading1 text-neutral2">
                {known?.symbol ?? shortenFelt(lead.token, 4, 3)}
              </span>
            ) : null}
            {lead && lead.decimals === null ? (
              <span className="text-body4 text-exposed">raw units</span>
            ) : null}
          </div>

          {balance === null ? (
            <Text variant="body3" className="text-neutral2">
              Your shielded balance hasn&rsquo;t been read yet.
            </Text>
          ) : balance.tokens.length === 0 ? (
            <Text
              variant="body3"
              className={balance.book === 'unknown' ? 'text-exposed' : 'text-neutral2'}
            >
              {BOOK_SENTENCE[balance.book]}
            </Text>
          ) : balance.tokens.length > 1 ? (
            <ul className="flex flex-col gap-s8 border-t border-solid border-surface3 pt-s12">
              {balance.tokens.slice(1).map((holding) => (
                <HoldingRow key={holding.token} holding={holding} />
              ))}
            </ul>
          ) : null}

          <div className="flex items-center justify-between gap-s8">
            {/*
              THE BLOCK STAMP, and the grammar is "as of about" rather than "at". The walk cannot be
              pinned to a block — `discoverWallet` explains why — so this is the height the same
              provider reported immediately before walking, and the copy says exactly that.
            */}
            {balance?.blockNumber != null ? (
              <Text variant="body4" className="numeric text-neutral3">
                as of about block {balance.blockNumber.toLocaleString('en-US')}
              </Text>
            ) : (
              <span />
            )}
            {address ? (
              <span className="flex items-center gap-s6">
                <IdentityDisc address={address} size={14} />
                <Text variant="body4" className="numeric text-neutral3">
                  {shortenFelt(address)}
                </Text>
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Whether the number above is current, as a dot and a word.
 *
 * A DOT ALONE WOULD NOT DO IT. Green-versus-amber is one channel, and the design authority forbids
 * hue from carrying meaning by itself — so the word is what a greyscale or colour-blind reader
 * gets, and the dot is the thing the eye finds first.
 */
function SyncState({ loading, book }: { loading: boolean; book: BookState | null }) {
  const tone = loading
    ? { dot: 'bg-neutral3', ink: 'text-neutral2', word: 'Reading the pool…' }
    : book === 'unknown'
      ? { dot: 'bg-exposed', ink: 'text-exposed', word: 'Incomplete read' }
      : book === null
        ? { dot: 'bg-neutral3', ink: 'text-neutral3', word: 'Not read yet' }
        : { dot: 'bg-settled', ink: 'text-neutral2', word: 'Up to date' }

  return (
    <span className="flex items-center gap-s6">
      <span aria-hidden="true" className={cn('size-s6 rounded-pill', tone.dot)} />
      <span className={cn('text-body4', tone.ink)}>{tone.word}</span>
    </span>
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
