//
// The five-screen conversion flow (context/11-product-experience.md §1, presentation re-ratified
// to the STUDIO direction 2026-08-28).
//
// ── IT IS A FULL-SCREEN TAKEOVER NOW, AND THE OLD RULING IS SUPERSEDED ────────────────────
//
// §1 originally ruled "an inline bordered row above the button — never a scrimmed modal". The
// ratified Studio prototype makes first-run a viewport takeover: brand top-left, Skip top-right,
// five hairline progress segments, one centred column per step under an Anton title. What SURVIVES
// from the old ruling is the half that was about state, not geometry: this component renders while
// open and unmounts on dismiss, and any form composed underneath it is never unmounted — a fixed
// overlay leaves the page's tree exactly where it was.
//
// ── THE LAST STEP IS THE ACTION ───────────────────────────────────────────────────────────
//
// Yosuku's `Tutorial.tsx` is the shell pattern — step array, growing progress dots, Escape and
// backdrop and Skip — with ONE change that matters: its last step is a preference and ours is the
// irreversible thing. There is no Done button anywhere in this component. Step five's primary
// control is `Create your account`, and pressing it is the registration.
//
// ── AND EACH SCREEN EARNS THE NEXT ────────────────────────────────────────────────────────
//
// Name is free, local and reversible. Custody is where the key is generated. Backup GATES — a
// skipped backup would create an unrecoverable account with somebody else's sponsored transaction,
// which is the one outcome this flow must never produce. The deadlock is named rather than hidden
// because a fee somebody else pays, unexplained, reads as a trick. Only then does anything reach
// the chain.
//
import { useCallback, useEffect, useRef, useState } from 'react'

import { POOL_SEES } from '@strk20/protocol/disclosure-copy'
import {
  BACKUP_BODY,
  BACKUP_GATE_NOTE,
  BACKUP_TITLE,
  CUSTODY_BODY,
  CUSTODY_CTA,
  CUSTODY_TITLE,
  DEADLOCK_TITLE,
  FUND_CTA,
  FUND_PENDING,
  FUND_TITLE,
  NAME_CAPTION,
  NAME_CLAIM_NOTE,
  NAME_CLAIM_OPT_IN,
  NAME_CTA,
  NAME_PLACEHOLDER,
  NAME_TITLE,
  REGISTER_CTA,
  REGISTER_STEPS,
  REGISTER_TITLE,
  REGISTERED_BODY,
  REGISTERED_CTA,
  REGISTERED_TITLE,
  deadlockBody,
  deadlockFeeRow,
  deadlockInvitedTitle,
  fundArrived,
  fundRefused,
} from '@strk20/protocol/onboarding-copy'

import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'

//
// The six screens, in order. A `gate` step cannot be advanced past until it says it is done.
//
// `fund` COMES BEFORE `register` — M8's one-subsidy inversion. The drip stakes the journey, so
// it must land before the registration it pays for; the register screen is the terminal one,
// showing "you're in" only after the confirmed on-chain write. The drip still fires by ARRIVAL
// on its screen, not by a button: a re-render must not re-ask, and pressing it is not a decision
// anybody would make differently.
//
type ScreenId = 'name' | 'custody' | 'backup' | 'deadlock' | 'fund' | 'register'
const SCREENS: readonly ScreenId[] = ['name', 'custody', 'backup', 'deadlock', 'fund', 'register']

export interface ConversionPanelProps {
  /**
   * The live pool fee, already formatted, or `null` when the chain could not be asked.
   *
   * NEVER a literal — the brief's governing rule. A null renders the sentence without a number
   * rather than with a guess at one; see `deadlockBody`.
   */
  feeStrk: string | null
  /** This app's name, for the fee row. */
  appName: string
  /** Set when an invite is covering the registration; it becomes screen 4's title. */
  inviter?: string | null
  /** Generates the key. Called on screen 2, so screens 3–4 hide the prover round-trip. */
  onGenerateKey: (name: string, claimPublicly: boolean) => Promise<void> | void
  /** Runs the registration. Only reached from screen 5's primary control. */
  onRegister: () => Promise<void> | void
  /**
   * Asks for the starter STRK. Runs once, automatically, when screen 6 mounts.
   *
   * IT RESOLVES WITH A REFUSAL RATHER THAN REJECTING, because a refused drip is an ordinary
   * outcome — a spent daily budget, a deployment with no faucet — and the account is complete
   * either way. A rejection here would take out the panel on the one screen whose whole job is
   * to say that everything worked.
   */
  onFund: () => Promise<{ ok: boolean; amount?: string; because?: string; txHash?: string }>
  /** Renders the ceremony. Calls `onDone` when the code is confirmed and the file is saved. */
  renderBackup: (onDone: () => void) => React.ReactNode
  /** Renders the four-step pipeline once registration is in flight. */
  renderPipeline?: () => React.ReactNode
  onDismiss: () => void
  /** True once registration confirms; the panel closes on it. */
  registered?: boolean
}

export function ConversionPanel({
  feeStrk,
  appName,
  inviter = null,
  onGenerateKey,
  onRegister,
  onFund,
  renderBackup,
  renderPipeline,
  onDismiss,
  registered = false,
}: ConversionPanelProps) {
  const [index, setIndex] = useState(0)
  const [name, setName] = useState('')
  const [claimPublicly, setClaimPublicly] = useState(false)
  const [backupDone, setBackupDone] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [funding, setFunding] = useState<{ done: boolean; message: string; txHash?: string }>({
    done: false,
    message: FUND_PENDING,
  })
  const rootRef = useRef<HTMLDivElement>(null)

  const screen = SCREENS[index]!
  const advance = useCallback(() => setIndex((i) => Math.min(i + 1, SCREENS.length - 1)), [])

  // Escape dismisses, exactly as it does in the tutorial pattern — EXCEPT once the registration is
  // in flight. A keystroke must not close the panel over a transaction somebody else is paying for
  // and that cannot be taken back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !registering) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss, registering])

  // Focus moves into the panel when it opens, because a row that appears above the button somebody
  // just pressed is invisible to a screen reader otherwise.
  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  //
  // A CONFIRMED REGISTRATION ADVANCES TO SCREEN SIX; IT NO LONGER DISMISSES.
  //
  // It used to close the panel, which was right when `register` was the last screen. Closing on
  // the same signal now would race screen six out of existence: `accountStatus` re-reads after
  // the write lands, so the panel would unmount in the same beat the drip was being asked for.
  //
  // `Math.min` rather than an assignment, so a late `registered` cannot pull the panel BACKWARDS
  // out of the funding screen it is already on.
  //
  useEffect(() => {
    // The terminal screen is `register` now — a confirmed write lands there and renders the
    // "you're in" state; it never pulls the panel backwards.
    if (registered) setIndex((i) => Math.max(i, SCREENS.indexOf('register')))
  }, [registered])

  //
  // The drip fires ONCE, when screen six first mounts, and is not a button.
  //
  // A button would be a second thing to press after the one irreversible act, on a screen whose
  // message is that the work is finished — and pressing it is not a decision anybody would make
  // differently. The guard is `funding.done` rather than a ref because a re-render on this screen
  // must not re-ask: the relayer burns the address's one claim on the first request, so a second
  // one comes back refused and would overwrite a success message with a refusal.
  //
  useEffect(() => {
    if (screen !== 'fund' || funding.done) return
    let live = true
    void onFund().then((result) => {
      if (!live) return
      setFunding({
        done: true,
        message: result.ok
          ? fundArrived(result.amount ?? '')
          : fundRefused(result.because ?? 'Starter STRK is not available right now.'),
        txHash: result.txHash,
      })
    })
    return () => {
      live = false
    }
  }, [screen, funding.done, onFund])

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label="Create an account"
      /*
        `inset-s0`, NEVER `inset-0`: the spacing scale is named (`s<N>`), so the numeric utility
        generates NO RULE — a fixed overlay with no offsets sat mid-page, which is exactly the
        loud-no-op the token sheet promises. The focus ring stays off this section: it takes
        programmatic focus on open, and a gold outline around the whole viewport is not a ring.
      */
      className="fixed inset-s0 z-modal flex flex-col overflow-y-auto bg-ground outline-none"
    >
      {/* The gold radial wash. Atmosphere only, so it neither takes clicks nor reaches a reader. */}
      <div aria-hidden="true" className="onboarding-glow pointer-events-none absolute inset-s0" />

      <header className="relative flex items-center justify-between gap-s12 px-s24 py-s20">
        <span className="flex items-center gap-s8 text-neutral1">
          <span aria-hidden="true" className="brand-mark" />
          <span className="display text-display4">Passbook</span>
        </span>
        {/* Skip is present on every screen EXCEPT while registering, for the same reason Escape is
            suppressed there: there is nothing to skip once the transaction is away. */}
        {/*
          Suppressed while registering, for the reason above — and on the funding screen too,
          where the account already exists. "Skip for now" there would offer to skip something
          that has already happened, beside a button that does the same thing and says so.
        */}
        {registering || registered ? null : (
          <button
            type="button"
            onClick={onDismiss}
            className="focus-ring shrink-0 rounded-control px-s8 py-s4 text-body4 text-neutral3 hover:text-neutral1"
          >
            Skip for now
          </button>
        )}
      </header>

      <Segments count={SCREENS.length} at={index} />

      <div className="relative flex flex-1">
      <div className="m-auto flex w-full max-w-[560px] flex-col gap-s12 px-s20 py-s36">
        <span className="kicker">{`Step ${index + 1} of ${SCREENS.length}`}</span>
        <Text variant="display2" as="h2" className="display text-neutral1 md:text-display1">
          {screen === 'deadlock' && inviter
            ? deadlockInvitedTitle(inviter)
            : screen === 'register' && registered
              ? REGISTERED_TITLE
              : TITLES[screen]}
        </Text>
        <div className="flex flex-col gap-s12">
        {screen === 'name' ? (
          <NameScreen
            name={name}
            onNameChange={setName}
            claimPublicly={claimPublicly}
            onClaimChange={setClaimPublicly}
            onContinue={advance}
          />
        ) : null}

        {screen === 'custody' ? (
          <>
            <Text variant="body3" className="text-neutral2">
              {CUSTODY_BODY}
            </Text>
            <Button
              variant="primary"
              size="lg"
              fill
              onClick={async () => {
                // The key is generated HERE, one screen before it is needed, so the read time on
                // screens 3 and 4 covers the prover round-trip rather than a spinner doing it.
                await onGenerateKey(name.trim(), claimPublicly)
                advance()
              }}
            >
              {CUSTODY_CTA}
            </Button>
          </>
        ) : null}

        {screen === 'backup' ? (
          <>
            <Text variant="body3" className="text-neutral2">
              {BACKUP_BODY}
            </Text>
            <Text variant="body4" className="text-neutral2">
              {BACKUP_GATE_NOTE}
            </Text>
            {renderBackup(() => {
              setBackupDone(true)
              advance()
            })}
            {/* NO "continue anyway". This is the gate: a skipped backup here would create an
                unrecoverable account with a sponsored transaction — somebody else's money spent on
                an account nobody can ever open. */}
            {backupDone ? null : (
              <Text variant="body4" className="text-neutral3">
                Finish the backup to continue.
              </Text>
            )}
          </>
        ) : null}

        {screen === 'deadlock' ? (
          <>
            <Text variant="body3" className="text-neutral2">
              {deadlockBody(feeStrk)}
            </Text>
            <div className="flex flex-col gap-s4 rounded-card bg-inset p-s12">
              <Text variant="body4" className="numeric text-neutral1">
                {deadlockFeeRow(appName, feeStrk)}
              </Text>
              {/* The SANCTIONED sentence. "your address never appears" is banned until the
                  relayer's claim is proven on mainnet; this is what ships in its place, imported
                  rather than re-typed so the two can never drift. */}
              <Text variant="body4" className="text-neutral2">
                {POOL_SEES}
              </Text>
            </div>
            <Button variant="primary" size="lg" fill onClick={advance}>
              Continue
            </Button>
          </>
        ) : null}

        {screen === 'fund' ? (
          <>
            <Text variant="body3" className="text-neutral2" aria-live="polite">
              {funding.message}
            </Text>
            {funding.txHash ? (
              <a
                href={`https://voyager.online/tx/${funding.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="focus-ring self-start font-mono text-mono text-neutral3 underline hover:text-neutral1"
              >
                the funding transaction ↗
              </a>
            ) : null}
            {/*
              CONTINUE UNLOCKS WHEN THE REQUEST RESOLVES — success OR refusal. The next screen
              is the registration this money pays for, so leaving before the answer exists would
              race the payer decision; but a REFUSED drip must not trap anybody, because the
              register screen's sponsored fallback covers exactly that case.
            */}
            <Button variant="primary" size="lg" fill aria-disabled={!funding.done} onClick={() => funding.done && advance()}>
              {funding.done ? FUND_CTA : 'Asking for your stake…'}
            </Button>
          </>
        ) : null}

        {screen === 'register' ? (
          registered ? (
            <>
              <Text variant="body3" className="text-neutral2">
                {REGISTERED_BODY}
              </Text>
              <Button variant="primary" size="lg" fill onClick={onDismiss}>
                {REGISTERED_CTA}
              </Button>
            </>
          ) : (
          <>
            {registering && renderPipeline ? (
              renderPipeline()
            ) : (
              <Text variant="body3" className="text-neutral2">
                {`This writes your key on-chain. ${REGISTER_STEPS.join(' → ')}.`}
              </Text>
            )}
            {/*
              THE LAST STEP IS THE ACTION. Yosuku's final screen sets a preference and ends in Done;
              ours ends in the irreversible thing — the Done above only exists once the chain
              confirmed it.
            */}
            <Button
              variant="primary"
              size="lg"
              fill
              aria-disabled={registering}
              onClick={async () => {
                if (registering) return
                setRegistering(true)
                try {
                  await onRegister()
                } finally {
                  // Cleared even on failure, so a failed registration is retryable rather than a
                  // panel locked open on a dead button.
                  setRegistering(false)
                }
              }}
            >
              {registering ? 'Registering…' : REGISTER_CTA}
            </Button>
          </>
          )
        ) : null}
        </div>
      </div>
      </div>
    </section>
  )
}

const TITLES: Record<ScreenId, string> = {
  name: NAME_TITLE,
  custody: CUSTODY_TITLE,
  backup: BACKUP_TITLE,
  deadlock: DEADLOCK_TITLE,
  register: REGISTER_TITLE,
  fund: FUND_TITLE,
}

function NameScreen({
  name,
  onNameChange,
  claimPublicly,
  onClaimChange,
  onContinue,
}: {
  name: string
  onNameChange: (v: string) => void
  claimPublicly: boolean
  onClaimChange: (v: boolean) => void
  onContinue: () => void
}) {
  return (
    <>
      <label className="flex flex-col gap-s6">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={NAME_PLACEHOLDER}
          aria-label="Your name"
          autoComplete="off"
          className="focus-ring w-full rounded-control bg-inset px-s12 py-s12 text-body1 text-neutral1 outline-none placeholder:text-neutral3"
        />
        <Text variant="body4" className="text-neutral2">
          {NAME_CAPTION}
        </Text>
      </label>

      {/* The public claim is OPT-IN and separate from the local label, because they are different
          acts: a label is private to this browser, a claim is a record anyone can look up. */}
      <label className="flex items-start gap-s8">
        <input
          type="checkbox"
          checked={claimPublicly}
          onChange={(e) => onClaimChange(e.target.checked)}
          className="focus-ring mt-s2 shrink-0"
        />
        <span className="flex flex-col gap-s2">
          <Text variant="body3" className="text-neutral1" as="span">
            {NAME_CLAIM_OPT_IN}
          </Text>
          <Text variant="body4" className="text-neutral2" as="span">
            {NAME_CLAIM_NOTE}
          </Text>
        </span>
      </label>

      <Button
        variant="primary"
        size="lg"
        fill
        aria-disabled={name.trim() === ''}
        onClick={() => {
          if (name.trim() !== '') onContinue()
        }}
      >
        {NAME_CTA}
      </Button>
    </>
  )
}

/**
 * The Studio progress segments: five hairline bars across the top of the takeover, gold up to and
 * including the current step. Decoration beside the spoken "Step N of 5", so it is hidden from
 * assistive technology rather than announced twice.
 */
function Segments({ count, at }: { count: number; at: number }) {
  return (
    <div className="relative mx-auto flex w-full max-w-[600px] gap-s6 px-s24" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-s2 flex-1 rounded-pill transition-colors duration-[var(--transition-duration-quickLong)]',
            i <= at ? 'bg-accent1' : 'bg-surface3',
          )}
        />
      ))}
    </div>
  )
}
