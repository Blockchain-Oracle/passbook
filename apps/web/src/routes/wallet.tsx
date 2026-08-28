import { createFileRoute, Link } from '@tanstack/react-router'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BookState, ShieldedBalance, TokenBalance } from '@strk20/protocol/balances'
import { BOOK_EMPTY, BOOK_NOT_REGISTERED, BOOK_UNKNOWN } from '@strk20/protocol/activity-copy'
import {
  REGISTER_FUNDS_FLOOR_WEI,
  REGISTER_NEEDS_FUNDS,
} from '@strk20/protocol/onboarding-copy'
import { toPlainText } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { BRIDGE_USDC } from '@strk20/protocol/bridge'
import {
  LOCKED_BODY,
  LOCKED_BODY_SEALED,
  LOCKED_HEADLINE,
  LOCK_WHAT_IT_DOES,
  LOCK_WHAT_IT_DOES_SEALED,
  UNLOCK_ACTION,
  UNLOCK_FORGOT_PASSWORD,
  UNLOCK_PASSWORD_LABEL,
} from '@strk20/protocol/account-copy'

import { AccountLadder } from '../components/AccountLadder'
import { Icon } from '../components/icons'
import { BackupCeremony } from '../components/BackupCeremony'
import { ActivityFeed } from '../components/ActivityFeed'
import { IdentityDisc } from '../components/IdentityDisc'
import { PasswordField } from '../components/PasswordField'
import { TokenLogo } from '../components/TokenLogo'
import { ShieldDialog } from '../components/ShieldDialog'
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
import { usePublicBalances } from '../shell/use-public-balances'
import { useActivity } from '../shell/use-activity'
import { findToken, useTokenList } from '../shell/use-token-list'
import type { TokenInfo } from '@strk20/protocol/token-list'
import { unlockSession, useSession, shortenFelt, type SessionState } from '../shell/session'
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
          sealed={session.sealed}
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
      <WalletFrame rail={<BalanceHero balance={null} loading address={null} />} feed={null} />
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
  const activity = useActivity(read, session.accountKey, session.address)
  const [receiving, setReceiving] = useState(false)

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
    //
    // THE JOURNEY IS ONE BUTTON NOW — M8's drip-first order means the account arrives here
    // funded but possibly undeployed, and registration SRC5-probes the address, so a
    // counterfactual account cannot register (verified live 2026-08-24). Deploying from the
    // drip is part of what the stake paid for; a deploy failure reports as the register
    // problem, because to the user it is one action.
    //
    const standing = await readAccountStatus(session.address)
    // The panel's gate should have said this already; this is the race-proof restatement — a
    // registration that cannot be paid must fail with the sentence, never with a dead spinner.
    if (standing.strkWei !== null && standing.strkWei < REGISTER_FUNDS_FLOOR_WEI) {
      setRegistering(null)
      setRegisterProblem(REGISTER_NEEDS_FUNDS)
      return
    }
    if (standing.rung === 'undeployed') {
      const deployed = await deployAccount(session.accountKey, session.address)
      if (!deployed.ok) {
        setRegistering(null)
        setRegisterProblem(deployed.because)
        return
      }
    }
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
    // Re-read rather than assume the rung moved — the ladder reports what it reads. AND the
    // balance walk re-runs too: it probes the same registration fact through its own reader, and
    // leaving it stale had the hero saying "not registered with the pool" beside a ladder saying
    // "Registered" for the rest of the session.
    setStatusNonce((n) => n + 1)
    refresh()

  }, [session.accountKey, session.address, backedUp, refresh])

  //
  // Account creation itself lives in the shell-level gate. This ladder remains as the recovery
  // and diagnostic view for an account whose chain state changes later.
  //

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
    refresh()
  }, [session.accountKey, session.address, refresh])

  return (
    <>
      <WalletFrame
        head={
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Reading…' : 'Refresh'}
          </Button>
        }
        rail={
          <>
            <BalanceHero balance={balance} loading={loading} address={session.address} />

            {/*
              WHAT THE ACCOUNT HOLDS IN THE OPEN. The hero above is the SHIELDED reading — notes
              this account can decrypt inside the pool — and for most of this app's life it was the
              only balance rendered anywhere. That is why a funded account looked empty: the faucet
              drips public STRK, a friend sends public USDC, and nothing on this screen read either.
            */}
            <PublicHoldings address={session.address} onShielded={refresh} />

            <ActionRow
              onReceive={() => setReceiving(true)}
              disabled={false}
            />

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

            {/*
              THE FUNDING RAIL MOVED INTO THE ACCOUNT MODAL (AccountDrawer's connect view) — the
              28-Aug review's ruling superseding the earlier placement: "it's supposed to be in
              the modal… it is called Connect to Ready Wallet." The onboarding rule survives the
              move: the conversion flow still never asks anybody to connect anything; the verb
              sits behind the account chip, where somebody managing their account looks for it.
            */}
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
function WalletFrame({
  head,
  rail,
  feed,
}: {
  head?: ReactNode
  rail: ReactNode
  feed: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[480px] lg:max-w-[1180px]">
      {/*
        The Studio surface header: kicker, Anton title, the one control at the right, and a
        hairline underneath — full width, above both columns.
      */}
      <header className="mb-s20 flex items-end justify-between gap-s12 border-b border-solid border-surface3 pb-s12">
        <div className="flex min-w-0 flex-col gap-s8">
          <Text variant="kicker">01 — account</Text>
          <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
            Wallet
          </Text>
        </div>
        {head}
      </header>
      <div
        className={cn(
          'flex w-full flex-col gap-s16',
          // `items-start` so the rail does not stretch to the history's height, and `minmax(0,1fr)`
          // so a wide row inside the feed cannot blow the column out.
          'lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-s24',
        )}
      >
        <div className="flex flex-col gap-s16">{rail}</div>
        {feed}
      </div>
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
  sealed,
}: {
  address: string
  label: string | null
  problem: string | null
  accounts: number
  /** True when a password is required. Chooses the copy AND whether there is a field at all. */
  sealed: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  //
  // THE PASSWORD IS CLEARED ON SUCCESS ONLY, never on failure.
  //
  // Blanking the field after a wrong password is the reflex, and it is the wrong call: the common
  // wrong password is a typo in a long one, and making somebody retype twenty characters because
  // they got one wrong is a punishment for a slip. Wiping it on SUCCESS matters for a different
  // reason — this component unmounts on unlock, but a re-render before that must not leave the
  // string sitting in state a devtools inspection can read.
  //
  const unlock = () => {
    if (busy || (sealed && password === '')) return
    setBusy(true)
    void unlockSession(sealed ? password : undefined).then((result) => {
      setBusy(false)
      if (result.ok) setPassword('')
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col items-start gap-s16 py-s32">
      <IdentityDisc address={address} size={56} />
      <div className="flex flex-col gap-s4">
        <Text variant="heading3" as="h1">
          {LOCKED_HEADLINE}
        </Text>
        <Text variant="body2" className="text-neutral2">
          {sealed ? LOCKED_BODY_SEALED : LOCKED_BODY}
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

      {/*
        THE FIELD EXISTS ONLY WHEN IT DOES SOMETHING. An unsealed browser shown a password box
        would be asked for a secret it does not have and could not check — the exact "tells the
        user it protected something" overclaim `account-copy.ts`'s header refuses.
      */}
      {sealed ? (
        <div className="w-full">
          <PasswordField
            label={UNLOCK_PASSWORD_LABEL}
            value={password}
            onChange={setPassword}
            onSubmit={unlock}
            autoComplete="current-password"
            disabled={busy}
          />
        </div>
      ) : null}

      {problem ? (
        <Text variant="body3" className="text-irreversible" role="alert">
          {problem}
        </Text>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        fill
        disabled={busy || (sealed && password === '')}
        onClick={unlock}
      >
        {/*
          "Unlocking…" is doing real work here rather than decorating a fast call: deriving the key
          is 600,000 PBKDF2 rounds, which is half a second on a laptop and longer on a phone. A
          button that looked idle for that long would be pressed again.
        */}
        {busy ? 'Unlocking…' : UNLOCK_ACTION}
      </Button>

      <Text variant="body4" className="max-w-[42ch] text-neutral3">
        {sealed ? LOCK_WHAT_IT_DOES_SEALED : LOCK_WHAT_IT_DOES}
      </Text>

      {/*
        The way back in, on the screen rather than behind a link — see `UNLOCK_FORGOT_PASSWORD`.
        This sentence is what makes a forgotten password a detour instead of a loss.
      */}
      {sealed ? (
        <Text variant="body4" className="max-w-[42ch] text-neutral3">
          {UNLOCK_FORGOT_PASSWORD}
        </Text>
      ) : null}

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
    'border border-solid border-surface3 bg-raised px-s6 py-s12 no-underline',
    'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
    'hover:bg-raisedHovered',
  )
  // The Studio tile label: uppercase, bold, wide-tracked — the navLabel step, so the four labels
  // and the pill nav speak in one voice.
  const label = 'text-navLabel uppercase text-neutral1'

  return (
    <div className="grid grid-cols-4 gap-s8">
      <Link to="/send" className={tile}>
        <span className="text-neutral2"><Icon name="send" size={19} /></span>
        <span className={label}>Send</span>
      </Link>
      <button type="button" onClick={onReceive} disabled={disabled} className={cn(tile, 'disabled:opacity-60')}>
        <span className="text-neutral2"><Icon name="receive" size={19} /></span>
        <span className={label}>Receive</span>
      </button>
      <Link to="/swap" className={tile}>
        <span className="text-neutral2"><Icon name="swap" size={19} /></span>
        <span className={label}>Swap</span>
      </Link>
      <Link to="/bridge" className={tile}>
        <span className="text-neutral2"><Icon name="bridge" size={19} /></span>
        <span className={label}>Bridge</span>
      </Link>
    </div>
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
/**
 * The account's PUBLIC holdings — every token it holds on chain, in the open.
 *
 * ── WHY THIS EXISTS, IN ONE SENTENCE ─────────────────────────────────────────────────────
 *
 * "The money arrived and the balance still shows nothing" was true, and no amount of refreshing
 * could have fixed it: the faucet drips PUBLIC STRK, a friend sends PUBLIC USDC, and every balance
 * this app rendered was the SHIELDED reading. Two different numbers, and only one of them was on
 * screen.
 *
 * ── IT SAYS WHAT IT IS, LOUDLY ───────────────────────────────────────────────────────────
 *
 * A second balance beside a shielded one is a privacy hazard if it is not labelled: somebody who
 * reads this figure as "my Passbook balance" has misunderstood the entire product. So the kicker
 * says public, and the line under it says the consequence — anyone can look this up — rather than
 * a euphemism.
 *
 * STRK and USDC are structural rows rather than inferred holdings. Zero is a useful answer and a
 * failed read is not zero, so neither may make an asset disappear.
 */
const CORE_PUBLIC_TOKENS: readonly TokenInfo[] = [
  {
    address: STRK_TOKEN,
    symbol: 'STRK',
    name: 'Starknet Token',
    decimals: 18,
    logoUri: null,
    volumeUsd: null,
    verified: true,
  },
  {
    address: BRIDGE_USDC,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUri: null,
    volumeUsd: null,
    verified: true,
  },
]

function PublicHoldings({ address, onShielded }: { address: string; onShielded: () => void }) {
  const { tokens } = useTokenList()
  const core = useMemo(
    () => CORE_PUBLIC_TOKENS.map((fallback) => findToken(tokens, fallback.address) ?? fallback),
    [tokens],
  )
  const addresses = useMemo(() => core.map((token) => token.address), [core])
  const publicBalances = usePublicBalances(address, addresses)
  const [shielding, setShielding] = useState<TokenInfo | null>(null)
  const refreshBoth = useCallback(() => {
    publicBalances.refresh()
    onShielded()
  }, [onShielded, publicBalances.refresh])
  const publicStrkWei = publicBalances.byToken.get(STRK_TOKEN.toLowerCase())

  return (
    <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
      <div className="flex items-center justify-between gap-s8">
        <span className="kicker">In your wallet · public</span>
        <Text variant="body4" className="text-neutral3">
          {publicBalances.loading ? 'Reading…' : 'On Starknet'}
        </Text>
      </div>
      <ul className="flex flex-col gap-s8">
        {core.map((token) => {
          const wei = publicBalances.byToken.get(token.address.toLowerCase())
          const value =
            wei === undefined
              ? publicBalances.loading
                ? 'Reading…'
                : 'Not read'
              : wei === null
                ? 'Read failed'
                : toPlainText(wei, token.decimals)
          return (
            <li key={token.address} className="flex flex-wrap items-center gap-s8 rounded-card bg-inset p-s10">
              <span className="flex min-w-0 flex-1 items-center gap-s8 text-body3 text-neutral1">
                <TokenLogo url={token.logoUri} symbol={token.symbol} name={token.name} size={20} />
                {token.symbol}
              </span>
              <span
                className={cn(
                  'numeric min-w-[90px] text-right font-mono text-body3',
                  wei === null ? 'text-exposed' : 'text-neutral1',
                )}
              >
                {value}
              </span>
              <Button
                variant="tertiary"
                size="sm"
                disabled={typeof wei !== 'bigint' || wei === 0n || typeof publicStrkWei !== 'bigint'}
                onClick={() => setShielding(token)}
              >
                Shield now
              </Button>
            </li>
          )
        })}
      </ul>
      <Text variant="body4" className="text-neutral2">
        These are ordinary on-chain balances at your embedded Passbook address — anyone can look
        them up. Shielding is a separate transaction from this same account.
      </Text>

      {shielding && typeof publicStrkWei === 'bigint' ? (
        <ShieldDialog
          token={shielding}
          publicWei={publicBalances.byToken.get(shielding.address.toLowerCase()) ?? 0n}
          publicStrkWei={publicStrkWei}
          open
          onOpenChange={(next) => {
            if (!next) setShielding(null)
          }}
          onConfirmed={refreshBoth}
        />
      ) : null}
    </section>
  )
}

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

  //
  // THE INVERTED PANEL [STUDIO]. The hero is `neutral1` as a FILL with `ground` as its ink — bone
  // card on the black app, black card on the bone one. `neutral3` is the one ink token that reads
  // as the secondary voice on BOTH sides of that inversion (it is the middle of the ladder), which
  // is what every muted line inside this section uses instead of neutral2.
  //
  return (
    <section className="flex flex-col gap-s16 rounded-large bg-neutral1 p-s20 text-ground">
      <div className="flex items-center justify-between gap-s8">
        <span className="kicker">Shielded balance</span>
        <SyncState loading={loading} book={balance?.book ?? null} />
      </div>

      {loading && !balance ? (
        <Skeleton className="flex flex-col gap-s8">
          <SkeletonBox className="h-s48 w-[60%]" />
          <SkeletonBox className="h-s16 w-[35%]" />
        </Skeleton>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-s8">
            {/*
              The figure is the display face now — Anton digits are near-tabular by construction,
              and the panel exists for this number.
            */}
            <span
              className={cn(
                'display leading-none',
                // No figure yet renders as a QUIET dash, not a bar: Anton's em dash at hero size
                // is a solid slab that reads as redaction rather than absence.
                lead === null
                  ? 'text-display3 text-neutral3'
                  : balance?.book === 'unknown'
                    ? 'text-display1 text-neutral3 lg:text-displayHero'
                    : 'text-display1 text-ground lg:text-displayHero',
              )}
            >
              {lead === null ? '—' : headline}
            </span>
            {lead ? (
              <span className="display text-display4 text-neutral3">
                {known?.symbol ?? shortenFelt(lead.token, 4, 3)}
              </span>
            ) : null}
            {lead && lead.decimals === null ? (
              <span className="text-body4 text-exposed">raw units</span>
            ) : null}
          </div>

          {balance === null ? (
            <Text variant="body3" className="text-neutral3">
              Your shielded balance hasn&rsquo;t been read yet.
            </Text>
          ) : balance.tokens.length === 0 ? (
            <Text
              variant="body3"
              className={balance.book === 'unknown' ? 'text-exposed' : 'text-neutral3'}
            >
              {BOOK_SENTENCE[balance.book]}
            </Text>
          ) : balance.tokens.length > 1 ? (
            <ul className="flex flex-col gap-s8 border-t border-solid border-neutral3 pt-s12">
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
              <Text variant="mono" className="numeric text-neutral3">
                as of about block {balance.blockNumber.toLocaleString('en-US')}
              </Text>
            ) : (
              <span />
            )}
            {address ? (
              <span className="flex items-center gap-s6">
                <IdentityDisc address={address} size={14} />
                <Text variant="mono" className="numeric text-neutral3">
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
 * One sentence per book state — the three law-governed ones IMPORTED from `activity-copy`, so a
 * claim about the user's money has exactly one authored form. A hand-retyped copy of
 * `BOOK_NOT_REGISTERED` used to live here and had already drifted ("with the pool" vs "on the
 * pool"). `holdings` renders only beside a non-empty token list, so its sentence stays local.
 */
const BOOK_SENTENCE: Record<BookState, string> = {
  'not-registered': BOOK_NOT_REGISTERED,
  'no-activity': BOOK_EMPTY,
  holdings: 'Holding notes.',
  unknown: BOOK_UNKNOWN,
}
