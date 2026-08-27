//
// The five-screen conversion panel (context/11-product-experience.md §1).
//
// ── IT IS A ROW ON THE PAGE, NOT A DIALOG OVER IT ─────────────────────────────────────────
//
// The brief: "an inline bordered row above the button — never a scrimmed modal, the page stays
// interactive, the composed form stays filled". So this renders in flow. A visitor who reached here
// by pressing Send on a half-filled swap form gets their form back when the panel closes, because
// it was never unmounted.
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
  NAME_CAPTION,
  NAME_CLAIM_NOTE,
  NAME_CLAIM_OPT_IN,
  NAME_CTA,
  NAME_PLACEHOLDER,
  NAME_TITLE,
  REGISTER_CTA,
  REGISTER_STEPS,
  REGISTER_TITLE,
  deadlockBody,
  deadlockFeeRow,
  deadlockInvitedTitle,
} from '@strk20/protocol/onboarding-copy'

import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'

/** The five screens, in order. A `gate` step cannot be advanced past until it says it is done. */
type ScreenId = 'name' | 'custody' | 'backup' | 'deadlock' | 'register'
const SCREENS: readonly ScreenId[] = ['name', 'custody', 'backup', 'deadlock', 'register']

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

  useEffect(() => {
    if (registered) onDismiss()
  }, [registered, onDismiss])

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label="Create an account"
      className="focus-ring flex w-full flex-col gap-s16 rounded-card border border-solid border-surface3 bg-raised p-s16"
    >
      <header className="flex items-start justify-between gap-s12">
        <div className="flex min-w-0 flex-col gap-s2">
          <Text variant="body4" className="text-neutral2">
            {`Step ${index + 1} of ${SCREENS.length}`}
          </Text>
          <Text variant="body1" as="h2" className="text-neutral1">
            {screen === 'deadlock' && inviter ? deadlockInvitedTitle(inviter) : TITLES[screen]}
          </Text>
        </div>
        {/* Skip is present on every screen EXCEPT while registering, for the same reason Escape is
            suppressed there: there is nothing to skip once the transaction is away. */}
        {registering ? null : (
          <button
            type="button"
            onClick={onDismiss}
            className="focus-ring shrink-0 rounded-control px-s8 py-s4 text-body4 text-neutral2 hover:bg-inset hover:text-neutral1"
          >
            Skip
          </button>
        )}
      </header>

      <Dots count={SCREENS.length} at={index} />

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

        {screen === 'register' ? (
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
              ours ends in the irreversible thing, so the button IS the registration and there is no
              Done anywhere in this component.
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
        ) : null}
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

/** Growing progress dots — the tutorial pattern's own affordance. */
function Dots({ count, at }: { count: number; at: number }) {
  return (
    <div className="flex items-center gap-s6" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-[6px] rounded-pill transition-all duration-[var(--transition-duration-simple)]',
            i === at ? 'w-[20px] bg-accent1' : i < at ? 'w-[6px] bg-neutral3' : 'w-[6px] bg-surface3',
          )}
        />
      ))}
    </div>
  )
}
