import { useState, useSyncExternalStore } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { AUDITOR_ESCROW, RELAYER_SEES } from '@strk20/protocol/disclosure-copy'
import { FORBIDDEN_CLAIMS } from '@strk20/protocol/forbidden-claims'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import {
  PASSWORD_BODY,
  PASSWORD_MISMATCH,
  PASSWORD_NO_RESET,
  PASSWORD_REMOVE_ACTION,
  PASSWORD_REMOVE_CONFIRM,
  PASSWORD_SET_ACTION,
  PASSWORD_TITLE,
} from '@strk20/protocol/account-copy'

import { PasswordField } from '../components/PasswordField'
import { Button } from '../components/ui/Button'
import { Surface } from '../shell/Surface'
// Aliased: `setPassword` is also this component's state setter, and two bindings of one name in
// one file is how the wrong one gets called.
import {
  clearPassword,
  setPassword as sealBrowser,
  shortenFelt,
  usePasswordSet,
  useSession,
} from '../shell/session'
import { toast } from '../shell/toast-store'
import { INTRO_SOUND, isMuted, play, setMuted, subscribeMuted } from '../shell/sound'
import { pinTheme, storedChoice, themeChoice } from '../shell/theme'
import type { ThemeChoice } from '../shell/theme'
import { NameClaim } from '../components/NameClaim'
import { Text } from '../components/ui/Text'
import { useFundingWallet } from '../shell/funding-wallet'
import { APP_CONTRACTS, GOVERNANCE_WRITE_SAFETY } from '../shell/app-contracts'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

//
// THREE OPTIONS, NOT A TOGGLE. "Follow the system" is a real state and the one a user who has
// pinned a theme by accident needs to get back to — a two-way switch cannot express it, so it
// strands them. `null` is that state; the radio group carries it as a value like any other.
//
// Radios rather than buttons because the browser already knows how to do this: one tab stop for the
// group, arrow keys between options, the current choice announced. Nothing here is re-implemented.
//
const THEME_OPTIONS = [
  { id: 'light', value: 'light', label: 'Light' },
  { id: 'dark', value: 'dark', label: 'Dark' },
  { id: 'system', value: null, label: 'Follow system' },
] as const satisfies readonly { id: string; value: ThemeChoice; label: string }[]

/**
 * The two facts this screen is allowed to speak from, read fresh every time it renders.
 *
 * NEITHER OF THEM IS "WHAT THE USER JUST CLICKED", and that is the whole design. `choice` is what
 * the document is painted as; `stored` is what a reload would restore. Every sentence below is a
 * comparison of those two, so the copy cannot drift from reality — not on a remount, not when a
 * write half-succeeded, not when the click never took at all.
 */
function readThemeState() {
  return { choice: themeChoice(), stored: storedChoice() }
}

function Settings() {
  //
  // Seeded from the DOM and from storage, never from click history. The bug this shape removes:
  // click-session state resets on remount, so navigating away from `/settings` and back used to
  // fall through to the durable sentence — claiming a pin was stored on a device that had refused
  // to store it. `choice` also cannot advance past a write that did not land, because it IS the
  // document's own attribute rather than the value that was requested.
  //
  const [state, setState] = useState(readThemeState)

  const choose = (next: ThemeChoice) => {
    pinTheme(next)
    setState(readThemeState())
  }

  return (
    <Surface routeId={Route.fullPath}>
      {/* [STUDIO] Settings is a 600px column, centred — cards stretched across a desktop read as
          a dashboard, and this page is a form. */}
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-s12">
      <Text variant="kicker">08 — controls</Text>
      <Text variant="display2" as="h1" className="text-neutral1">
        Settings
      </Text>

      <AccountAndNetwork />

      <fieldset className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
        <legend className="float-left text-body3 font-medium">Theme</legend>
        {THEME_OPTIONS.map((option) => (
          <label key={option.id} className="flex items-center gap-s8 text-body3">
            <input
              type="radio"
              name="theme"
              value={option.id}
              checked={state.choice === option.value}
              onChange={() => choose(option.value)}
              className="focus-ring"
            />
            {option.label}
          </label>
        ))}

        {/*
          What is actually true, said in the user's terms. `aria-live` because this text changes
          without the focus moving, and the paragraph is always rendered — describing the current
          state before any click — so choosing an option does not push the rest of the page down.
        */}
        <p className="text-body4 text-neutral2" aria-live="polite">
          <ThemeStatus choice={state.choice} stored={state.stored} />
        </p>
      </fieldset>

      <PasswordControl />

      <SoundControl />

      {/*
        The name claim lives here rather than on `/chat` because it is a property of the ACCOUNT,
        not of a conversation — the same reason the theme control does. Chat links to it from the
        new-message flow, which is where somebody first wants one.
      */}
      <NameClaim />

      {/*
        WHAT PASSBOOK DOES NOT CLAIM [STUDIO]. The settings page is where a careful reader goes to
        find out what they have actually been promised, so the refusals live here in one card. The
        first two sentences are this file's own statements of two facts every surface already
        discloses at its own moment; the second two are the canonical sentences, imported so they
        cannot drift from the disclosures that use them. The footer renders the REAL forbidden-
        claims list — the same array the copy tests scan for — so the card's last line is the
        enforcement, not a paraphrase of it.
      */}
      <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
        <Text variant="body2" as="h2" className="font-medium text-neutral1">
          What Passbook does not claim
        </Text>
        <div className="flex flex-col gap-s8">
          <Text variant="body4" className="text-neutral2">
            The recipient of a private transfer sees who sent it. Private is not anonymous to your
            counterparty.
          </Text>
          <Text variant="body4" className="text-neutral2">
            An open-note leg makes its amount public. Markets, Launch and Houses can record a
            bearer commitment instead of your account, but the transaction submitter remains
            visible on-chain.
          </Text>
          <Text variant="body4" className="text-neutral2">
            {RELAYER_SEES}
          </Text>
          <Text variant="body4" className="text-neutral2">
            {AUDITOR_ESCROW}
          </Text>
        </div>
        <Text variant="mono" className="text-neutral3">
          We will not say: {FORBIDDEN_CLAIMS.join(' · ')}
        </Text>
      </section>
      </div>
    </Surface>
  )
}

function AccountAndNetwork() {
  const session = useSession()
  const fundingWallet = useFundingWallet()
  const [copied, setCopied] = useState(false)
  const address = session.status === 'ready' || session.status === 'locked' ? session.address : null
  const contracts = [
    { label: 'Shielded pool', address: NET.pool, status: 'Pinned protocol deployment' },
    { label: 'Markets', address: APP_CONTRACTS.markets, status: 'Verified deployment evidence' },
    { label: 'Launch', address: APP_CONTRACTS.launch, status: 'Verified deployment evidence' },
    {
      label: 'Houses',
      address: APP_CONTRACTS.governance,
      status: GOVERNANCE_WRITE_SAFETY.enabled ? 'Verified for writes' : 'Read-only on this class',
    },
  ] as const

  const copyAddress = () => {
    if (!address || !navigator.clipboard) {
      toast({
        kind: 'error',
        title: 'Could not copy',
        detail: 'Select the address and copy it manually in this browser.',
      })
      return
    }
    void navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      },
      () =>
        toast({
          kind: 'error',
          title: 'Could not copy',
          detail: 'This browser refused clipboard access. Select the address and copy it manually.',
        }),
    )
  }

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <div className="flex flex-wrap items-start justify-between gap-s8">
        <div className="flex flex-col gap-s4">
          <Text variant="body2" as="h2" className="font-medium text-neutral1">
            Account &amp; network
          </Text>
          <Text variant="body4" className="text-neutral2">
            This embedded Passbook account owns your public funds, shielded notes and viewing keys.
          </Text>
        </div>
        <span className="rounded-full bg-accent2 px-s8 py-s4 font-mono text-mono text-accent1">
          {ACTIVE_NETWORK}
        </span>
      </div>

      {address ? (
        <button
          type="button"
          className="focus-ring flex w-full min-w-0 max-w-full items-center justify-between gap-s12 overflow-hidden rounded-card bg-inset p-s12 text-left"
          onClick={copyAddress}
          aria-label={`Copy embedded Passbook address ${address}`}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-s4 overflow-hidden">
            <span className="text-body4 text-neutral2">Embedded Passbook address</span>
            <span className="numeric truncate font-mono text-mono text-neutral1">{address}</span>
          </span>
          <span className="shrink-0 text-body4 text-accent1">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      ) : (
        <Text variant="body4" className="text-neutral2">
          The embedded account is unavailable while this browser session is loading.
        </Text>
      )}

      <dl className="grid gap-s8 sm:grid-cols-2">
        <Fact label="Chain ID" value={NET.chainId} />
        <Fact
          label="Connected funding wallet"
          value={
            fundingWallet
              ? `${fundingWallet.name} · ${shortenFelt(fundingWallet.address, 6, 4)}`
              : 'Not connected'
          }
        />
      </dl>
      <Text variant="body4" className="text-neutral2">
        A connected wallet is only a public funding source. It never replaces the embedded account,
        and shielding is always signed by the embedded account after funds arrive there.
      </Text>

      <div className="flex flex-col gap-s4 border-t border-solid border-surface3 pt-s12">
        {contracts.map((contract) => (
          <div key={contract.label} className="flex min-w-0 items-center justify-between gap-s12 py-s4">
            <span className="flex min-w-0 flex-col">
              <span className="text-body4 font-medium text-neutral1">{contract.label}</span>
              <span className="text-mono font-mono text-neutral3">{contract.status}</span>
            </span>
            {contract.address ? (
              <a
                className="focus-ring shrink-0 rounded-control px-s4 font-mono text-mono text-accent1 hover:text-accent1Hovered"
                href={`${NET.explorer}/contract/${contract.address}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${contract.label} contract on Voyager`}
              >
                {shortenFelt(contract.address, 6, 4)} ↗
              </a>
            ) : (
              <span className="font-mono text-mono text-neutral3">Not recorded</span>
            )}
          </div>
        ))}
      </div>

      {!GOVERNANCE_WRITE_SAFETY.enabled ? (
        <Text variant="body4" className="text-irreversible">
          Houses writes are disabled: {GOVERNANCE_WRITE_SAFETY.because}
        </Text>
      ) : null}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-card bg-inset p-s12">
      <dt className="text-body4 text-neutral2">{label}</dt>
      <dd className="numeric mt-s4 truncate font-mono text-mono text-neutral1" title={value}>
        {value}
      </dd>
    </div>
  )
}

/**
 * Set or remove this browser's password.
 *
 * ── IT IS ON SETTINGS AND NOT IN THE FIRST-RUN FLOW, WHICH IS A DELIBERATE REFUSAL ────────
 *
 * ZK Freighter asks for a vault password as step 2 of 2 in onboarding, and copying that here was
 * the obvious move. It is wrong for this product for the reason `use-first-run.ts` spends its
 * header on: the conversion flow is already five screens ending in an irreversible on-chain write,
 * and one of them is a backup ceremony that GATES. Adding a sixth screen with two more fields to
 * the path between "I want to try this" and "I have an account" buys a protection nobody has
 * anything to protect yet — the account is seconds old and holds nothing.
 *
 * So the password is offered where somebody who now HAS something goes looking for it. The cost is
 * that most users will never set one, which is why the default path stays honest about being
 * plaintext rather than quietly assuming everybody opted in.
 *
 * ── AND REMOVING IT ASKS FOR IT ───────────────────────────────────────────────────────────
 *
 * See `PASSWORD_REMOVE_CONFIRM`. The session is already unlocked, so the check reads as theatre
 * until the threat is named: it is the unattended screen, and this is the one control in Settings
 * that hands over a key.
 */
function PasswordControl() {
  const set = usePasswordSet()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // `null` is "not answered yet". Rendering either branch before the storage tier replies would
  // flash a control that then swaps for its opposite.
  if (set === null) return null

  const clear = () => {
    setPassword('')
    setConfirm('')
  }

  const mismatch = confirm !== '' && password !== confirm

  const submitSet = () => {
    if (busy || password === '' || password !== confirm) return
    setBusy(true)
    setProblem(null)
    void sealBrowser(password).then((result) => {
      setBusy(false)
      if (result.ok) {
        clear()
        toast({ kind: 'success', title: 'Password set', detail: 'This browser’s accounts are now encrypted.' })
      } else {
        setProblem(result.because)
      }
    })
  }

  const submitRemove = () => {
    if (busy || password === '') return
    setBusy(true)
    setProblem(null)
    void clearPassword(password).then((result) => {
      setBusy(false)
      if (result.ok) {
        clear()
        toast({ kind: 'success', title: 'Password removed', detail: 'The key is back in this browser’s storage.' })
      } else {
        setProblem(result.because)
      }
    })
  }

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <Text variant="body2" as="h2" className="font-medium text-neutral1">
        {PASSWORD_TITLE}
      </Text>

      <Text variant="body4" className="text-neutral2">
        {set ? PASSWORD_REMOVE_CONFIRM : PASSWORD_BODY}
      </Text>

      <PasswordField
        label={set ? 'Current password' : 'New password'}
        value={password}
        onChange={setPassword}
        onSubmit={set ? submitRemove : submitSet}
        // `current-password` when proving one, `new-password` when creating one — see
        // `PasswordField`. A manager offered the wrong token here overwrites the saved entry.
        autoComplete={set ? 'current-password' : 'new-password'}
        disabled={busy}
        showStrength={!set}
      />

      {set ? null : (
        <>
          <PasswordField
            label="Confirm"
            value={confirm}
            onChange={setConfirm}
            onSubmit={submitSet}
            autoComplete="new-password"
            disabled={busy}
          />
          {/*
            The mismatch is announced BEFORE the button is pressed, because the alternative is a
            user who types a long password twice, presses the button, and is told to do it again
            with both fields cleared.
          */}
          {mismatch ? (
            <Text variant="body4" className="text-irreversible" role="alert">
              {PASSWORD_MISMATCH}
            </Text>
          ) : null}
          <Text variant="body4" className="text-neutral2">
            {PASSWORD_NO_RESET}
          </Text>
        </>
      )}

      {problem ? (
        <Text variant="body4" className="text-irreversible" role="alert">
          {problem}
        </Text>
      ) : null}

      <Button
        variant={set ? 'secondary' : 'primary'}
        size="md"
        disabled={busy || password === '' || (!set && password !== confirm)}
        onClick={set ? submitRemove : submitSet}
        className="self-start"
      >
        {/* The wait is 600,000 PBKDF2 rounds — real enough that an idle-looking button gets
            double-pressed, which is why the label changes rather than only the disabled state. */}
        {busy ? 'Working…' : set ? PASSWORD_REMOVE_ACTION : PASSWORD_SET_ACTION}
      </Button>
    </section>
  )
}

/**
 * The sound switch.
 *
 * ── A CHECKBOX, WHERE THE THEME NEEDED RADIOS ─────────────────────────────────────────────
 *
 * The theme has three states because "follow the system" is a real one. Sound has two: the OS
 * exposes no ambient preference for it (there is no `prefers-reduced-sound`), so there is nothing
 * to follow and a third option would be a lie. Two states is a checkbox.
 *
 * ── AND THE PREVIEW IS THE HONEST PART ────────────────────────────────────────────────────
 *
 * A muted app is silent, so a user who turns sound back on gets no confirmation that anything
 * happened — the setting's only evidence is a sound that plays three seconds into a visit they are
 * not currently making. The preview button is that evidence, and it is called from a click handler
 * so the page is already past the autoplay gate and `play` needs none of `arm`'s machinery.
 *
 * `useSyncExternalStore` rather than local state because `sound.ts` is the owner: the cold open
 * reads the same key, and two components holding private copies of one preference is how they
 * disagree.
 */
function SoundControl() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, isMuted)

  return (
    <fieldset className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <legend className="float-left text-body3 font-medium">Sound</legend>

      <label className="flex items-center gap-s8 text-body3">
        <input
          type="checkbox"
          checked={!muted}
          onChange={(e) => setMuted(!e.target.checked)}
          className="focus-ring"
        />
        Play the welcome chime
      </label>

      <p className="text-body4 text-neutral2">
        {muted ? (
          <>Passbook is silent. It plays no sound anywhere.</>
        ) : (
          <>One short chime, on the first visit from this browser. Nothing else in Passbook makes noise.</>
        )}
      </p>

      {/*
        Hidden while muted rather than disabled: a preview button that cannot preview is a control
        with nothing behind it, and the checkbox above it already explains why.
      */}
      {muted ? null : (
        <button
          type="button"
          onClick={() => play(INTRO_SOUND)}
          className="focus-ring self-start rounded-control px-s8 py-s4 text-body4 text-neutral2 hover:text-neutral1"
        >
          Hear it
        </button>
      )}
    </fieldset>
  )
}

/**
 * The honest sentence for each of the three relationships between "painted" and "stored".
 *
 * The durable promise is made in exactly one branch — the one where the two agree — and the other
 * two say what a reload will really do. The failures this closes are both real and both were
 * shipped: private mode, where nothing was stored and the copy claimed it had been; and a failed
 * CLEAR, where the page now follows the system while storage still holds the pin it just dropped,
 * so the reload the copy described would have brought the old theme back.
 *
 * Written as JSX rather than as returned strings on purpose: prose in a string literal is scanned by
 * the token lint as a possible class list, and a sentence containing an ordinary word like "to" is
 * indistinguishable from one.
 */
function ThemeStatus({ choice, stored }: { choice: ThemeChoice; stored: ThemeChoice | 'unreadable' }) {
  if (stored === 'unreadable') {
    return choice === null ? (
      <>Following your system setting. This device will not store a preference, so a reload does the same.</>
    ) : (
      <>
        Applied to this tab. It could not be stored on this device, so a reload will follow your
        system setting again.
      </>
    )
  }

  if (stored === choice) {
    return choice === null ? (
      <>Following your system setting. Changing it there changes this app.</>
    ) : (
      <>Stored on this device. Passbook opens in this theme until you change it here.</>
    )
  }

  return (
    <>
      Applied to this tab. It is not what this device has stored, so a reload will use{' '}
      {stored === null ? <>your system setting</> : <>the {stored} theme</>} instead.
    </>
  )
}
