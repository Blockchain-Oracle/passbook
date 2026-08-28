//
// Account creation: TWO STEPS AND A LADDER (prototype `Passbook.dc.html`, Abu's ruling 2026-08-28).
//
// ── WHAT HAPPENED TO THE OTHER FOUR SCREENS ───────────────────────────────────────────────
//
// This was `name → custody → backup → deadlock → fund → register`. Six screens, five of which
// carried a single paragraph and a Continue button. The prototype runs `Step 1 of 2` and
// `Step 2 of 2`, and the four that went away did not lose their content: `CUSTODY_BODY` is the
// note under the derived address, `deadlockBody` and `POOL_SEES` are the fee card above Create,
// and `fund` is no longer a screen at all because the drip is the first rung of the ladder.
//
// Every sourced sentence still renders and `onboarding-copy.test.ts` still pins each of them
// byte-exact. What changed is how many times somebody presses Continue to read them.
//
// ── THE DRIP IS A RUNG, NOT A BUTTON ──────────────────────────────────────────────────────
//
// A `Claim faucet` button lived here for an afternoon. The complaint it answered was real — the
// faucet was invisible, and the word appeared in this flow exactly once, inside a refusal — but
// the remedy was wrong, and the prototype says so: `{label:'Drip lands', note:'…the receipt above
// is its record'}`. Money that arrives with its own named rung and its own transaction hash is
// visible. A button asking somebody to accept a gift nobody would decline is a chore.
//
// ── AND THE REFUSAL PATH SURVIVED THE COLLAPSE, DELIBERATELY ──────────────────────────────
//
// Folding `fund` into rung one is exactly where `f339cbf`'s work — the funds floor, the copyable
// address, the live "it landed" line — would have been quietly deleted. It is not: a refused drip
// fails the ladder AT the drip rung with the relayer's own sentence and the address underneath,
// and `createFeeNote` promises that fallback up front rather than springing it.
//
import { useCallback, useEffect, useRef, useState } from 'react'

import { POOL_SEES } from '@strk20/protocol/disclosure-copy'
import { ONBOARDING_STAGES, type OnboardingStage } from '@strk20/protocol/pipeline-stage'
import { stepsFor } from '@strk20/protocol/progress'
import {
  ADDRESS_NOTE,
  BACKUP_BODY,
  BACKUP_GATE_NOTE,
  BACKUP_TITLE,
  CREATE_BLOCKED,
  CREATE_CTA,
  CREATE_TITLE,
  CUSTODY_BODY,
  DRIP_RECEIPT_SUB,
  ENTER_CTA,
  FUND_ADDRESS_HINT,
  NAME_CAPTION,
  NAME_CLAIM_NOTE,
  NAME_CLAIM_OPT_IN,
  NAME_CTA,
  NAME_PLACEHOLDER,
  NAME_TITLE,
  ONBOARDING_STAGE_NOTES,
  REGISTER_FUNDS_FLOOR_WEI,
  REGISTER_NEEDS_FUNDS,
  createFeeNote,
  deadlockFeeRow,
  deadlockInvitedTitle,
  doneSub,
  doneTitle,
  dripReceiptSubInvited,
  fundsArrived,
  namePreview,
} from '@strk20/protocol/onboarding-copy'

import { toPlainText } from '@strk20/protocol/amount'

import { cn } from '../../lib/cn'
import { INTRO_SOUND, play } from '../../shell/sound'
import { ProgressMachine } from '../ProgressMachine'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'

type ScreenId = 'name' | 'create'
const SCREENS: readonly ScreenId[] = ['name', 'create']

/**
 * Everything the surface knows about a creation in flight.
 *
 * One object rather than six props, because these six values are only ever meaningful together —
 * a `receipt` without a `reached` is a receipt for a rung that has not run.
 */
export interface CreationState {
  /** The rung currently running. `null` before Create is pressed and after the ladder ends. */
  stage: OnboardingStage | null
  /** Every rung that has completed. Order does not matter; the furthest one wins. */
  reached: readonly OnboardingStage[]
  /** The rung it stopped at, if it stopped. Nothing after it activates. */
  failedAt: OnboardingStage | null
  /** Set once the drip lands — the amount and hash the chip reports. */
  receipt: { amount: string; txHash: string } | null
  /** True once the whole ladder has confirmed. */
  done: boolean
}

export interface ConversionPanelProps {
  /**
   * The live pool fee, already formatted, or `null` when the chain could not be asked.
   *
   * NEVER a literal — the brief's governing rule. A null renders the sentence without a number
   * rather than with a guess at one; see `createFeeNote`.
   */
  feeStrk: string | null
  /** This app's name, for the fee row. */
  appName: string
  /** Set when an invite is covering the registration. Names the staker on the receipt. */
  inviter?: string | null
  /** Names the account locally and records whether the claim is wanted. Runs on leaving step 1. */
  onGenerateKey: (name: string, claimPublicly: boolean) => Promise<void> | void
  /**
   * Runs the whole ladder: drip → deploy → register → confirm.
   *
   * ONE ACTION, because it is one thing the user asked for. It used to be two — a `fund` screen
   * that asked for STRK and a `register` screen that spent it — and the seam between them was a
   * Continue button in the middle of a process nobody wanted to supervise.
   */
  onCreate: () => Promise<void> | void
  /** This browser's account address — the funding target when the drip cannot stake. */
  address: string
  /** The account's live public STRK, off the wallet's status poll. `null` while unread. */
  fundsWei?: bigint | null
  /** The last failure, in a sentence — rendered at the rung that produced it. */
  problem?: string | null
  /** Renders the ceremony. Calls `onDone` when the code is confirmed and the file is saved. */
  renderBackup: (onDone: () => void) => React.ReactNode
  onDismiss: () => void
  /** The live creation state. */
  creation: CreationState
}

export function ConversionPanel({
  feeStrk,
  appName,
  inviter = null,
  onGenerateKey,
  onCreate,
  address,
  fundsWei = null,
  problem = null,
  renderBackup,
  onDismiss,
  creation,
}: ConversionPanelProps) {
  const [index, setIndex] = useState(0)
  const [name, setName] = useState('')
  // DEFAULTS TO TRUE, which is the prototype's `claim:true` and a deliberate product position: a
  // name nobody can resolve is a name that does not do the thing the step just promised. The
  // toggle is right there, and `NAME_CLAIM_NOTE` says plainly what claiming publishes.
  const [claimPublicly, setClaimPublicly] = useState(true)
  const [backupDone, setBackupDone] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const screen = SCREENS[index]!
  const running = creation.stage !== null
  const { done } = creation

  // The honest gate — `null` funds reads as "unknown", which blocks nothing: an unreadable balance
  // must not tell a funded user they are broke.
  const fundsShort = fundsWei !== null && fundsWei < REGISTER_FUNDS_FLOOR_WEI

  // Escape dismisses — EXCEPT while the ladder is running. A keystroke must not close the panel
  // over a transaction that cannot be taken back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss, running])

  // Focus moves into the panel when it opens, or a screen reader never learns it appeared.
  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  // Arrival gets its chime, once, when the ladder finishes.
  useEffect(() => {
    if (done) play(INTRO_SOUND, 0.6)
  }, [done])

  const goCreate = useCallback(async () => {
    if (running || done) return
    await onCreate()
  }, [running, done, onCreate])

  const shownName = name.trim() === '' ? 'yours' : name.trim()

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label="Create an account"
      /*
        `inset-s0`, NEVER `inset-0`: the spacing scale is named (`s<N>`), so the numeric utility
        generates NO RULE — a fixed overlay with no offsets sat mid-page.
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
        {/* Suppressed once the ladder starts: there is nothing to skip over a transaction that is
            already away, and nothing to skip after it lands. */}
        {running || done ? null : (
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
          {done ? null : (
            <span className="kicker">{`Step ${index + 1} of ${SCREENS.length}`}</span>
          )}
          <Text variant="display2" as="h2" className="display text-neutral1 md:text-display1">
            {done
              ? doneTitle(shownName)
              : screen === 'create' && inviter
                ? deadlockInvitedTitle(inviter)
                : screen === 'create'
                  ? CREATE_TITLE
                  : NAME_TITLE}
          </Text>

          <div className="flex flex-col gap-s12">
            {screen === 'name' ? (
              <NameScreen
                name={name}
                onNameChange={setName}
                claimPublicly={claimPublicly}
                onClaimChange={setClaimPublicly}
                onContinue={async () => {
                  await onGenerateKey(name.trim(), claimPublicly)
                  setIndex(1)
                }}
              />
            ) : null}

            {screen === 'create' ? (
              done ? (
                <>
                  <Text variant="body3" className="text-neutral2">
                    {doneSub(claimPublicly)}
                  </Text>
                  <Ladder creation={creation} inviter={inviter} />
                  <Button variant="primary" size="lg" fill onClick={onDismiss}>
                    {ENTER_CTA}
                  </Button>
                </>
              ) : running || creation.failedAt !== null ? (
                <>
                  <Ladder creation={creation} inviter={inviter} />
                  {/*
                    THE REFUSAL RENDERS AT THE RUNG THAT PRODUCED IT, with the address underneath
                    when the account cannot pay its own way. This is `f339cbf`'s path, re-homed
                    rather than deleted by the collapse.
                  */}
                  {problem ? (
                    <Text variant="body4" className="text-exposed" role="alert">
                      {problem}
                    </Text>
                  ) : null}
                  {creation.failedAt !== null && fundsShort ? (
                    <>
                      <Text variant="body4" className="text-neutral2">
                        {REGISTER_NEEDS_FUNDS}
                      </Text>
                      <AddressCard address={address} />
                    </>
                  ) : null}
                  {creation.failedAt !== null && fundsWei !== null && !fundsShort ? (
                    <Text variant="body3" className="text-settled" role="status">
                      {fundsArrived(toPlainText(fundsWei, 18))}
                    </Text>
                  ) : null}
                  {/* A stopped ladder is retryable. A stopped ladder with no way forward is a
                      dead end wearing a progress list. */}
                  {creation.failedAt !== null ? (
                    <Button variant="primary" size="lg" fill onClick={() => void goCreate()}>
                      Try again
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <AddressPanel address={address} />
                  <Text variant="body4" className="text-neutral2">
                    {CUSTODY_BODY}
                  </Text>

                  <div className="flex flex-col gap-s6">
                    <Text variant="body3" as="h3" className="text-neutral1">
                      {BACKUP_TITLE}
                    </Text>
                    <Text variant="body4" className="text-neutral2">
                      {BACKUP_BODY}
                    </Text>
                    <Text variant="body4" className="text-neutral2">
                      {BACKUP_GATE_NOTE}
                    </Text>
                    {renderBackup(() => setBackupDone(true))}
                  </div>

                  <div className="flex flex-col gap-s4 rounded-card bg-inset p-s12">
                    <Text variant="body4" className="text-neutral2">
                      {createFeeNote(feeStrk)}
                    </Text>
                    <Text variant="body4" className="numeric text-neutral1">
                      {deadlockFeeRow(appName, feeStrk)}
                    </Text>
                    {/* The SANCTIONED sentence. "your address never appears" is banned until the
                        relayer's claim is proven on mainnet; this is what ships in its place. */}
                    <Text variant="body4" className="text-neutral2">
                      {POOL_SEES}
                    </Text>
                  </div>

                  {problem ? (
                    <Text variant="body4" className="text-exposed" role="alert">
                      {problem}
                    </Text>
                  ) : null}

                  {/* NO "continue anyway". A skipped backup would create an unrecoverable account
                      with a sponsored transaction — money spent on an account nobody can open. */}
                  <Button
                    variant="primary"
                    size="lg"
                    fill
                    aria-disabled={!backupDone}
                    onClick={() => void goCreate()}
                  >
                    {CREATE_CTA}
                  </Button>
                  {backupDone ? null : (
                    <Text variant="body4" className="text-neutral3">
                      {CREATE_BLOCKED}
                    </Text>
                  )}
                </>
              )
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The four rungs, drawn by the app's ONE progress machine.
 *
 * `ProgressMachine` had zero importers before this — a finished five-channel ladder, shipped with
 * its CSS, rendered nowhere. It takes rows and knows nothing about which pipeline it is drawing,
 * which is exactly the claim that makes a third pipeline free.
 */
function Ladder({ creation, inviter }: { creation: CreationState; inviter: string | null }) {
  const steps = stepsFor({
    stages: ONBOARDING_STAGES,
    reached: creation.done ? ONBOARDING_STAGES : creation.reached,
    failedAt: creation.failedAt,
  })
  const note =
    creation.stage !== null ? ONBOARDING_STAGE_NOTES[creation.stage] : null

  return (
    <div className="flex flex-col gap-s8">
      <ProgressMachine steps={steps} label="Creating your account" />
      {/* ONE note, for the rung that is running — the prototype's `noteOn: i===reg`. Four notes at
          once is a paragraph with bullets, and the eye has nowhere to land. */}
      {note ? (
        <Text variant="body4" className="text-neutral3" aria-live="polite">
          {note}
        </Text>
      ) : null}
      {creation.receipt ? (
        <div className="flex flex-col gap-s2 rounded-card bg-inset p-s12">
          <Text variant="body3" className="numeric text-settled">
            {`+${creation.receipt.amount} STRK`}
          </Text>
          <Text variant="body4" className="text-neutral3">
            {inviter ? dripReceiptSubInvited(inviter) : DRIP_RECEIPT_SUB}
          </Text>
          <a
            href={`https://voyager.online/tx/${creation.receipt.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring self-start font-mono text-mono text-neutral3 underline hover:text-neutral1"
          >
            {`tx ${creation.receipt.txHash.slice(0, 6)}…${creation.receipt.txHash.slice(-4)} ↗`}
          </a>
        </div>
      ) : null}
    </div>
  )
}

/** The derived address, stated as provenance rather than as a value to check. */
function AddressPanel({ address }: { address: string }) {
  return (
    <div className="flex flex-col gap-s2 rounded-card bg-inset p-s12">
      <span className="numeric break-all font-mono text-body4 text-neutral1">{address}</span>
      <Text variant="body4" className="text-neutral3">
        {ADDRESS_NOTE}
      </Text>
    </div>
  )
}

/**
 * The copyable funding target. The address IS the affordance — tapping it copies, the way every
 * wallet has taught — with a state word on the right so the copy is confirmed where it happened.
 */
function AddressCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-s4">
      <Text variant="body4" className="uppercase text-neutral3">
        {FUND_ADDRESS_HINT}
      </Text>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(address).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
        }}
        className="focus-ring flex items-baseline gap-s8 rounded-card border border-solid border-surface3 bg-inset p-s12 text-left"
      >
        <span className="numeric min-w-0 flex-1 break-all font-mono text-body4 text-neutral1">{address}</span>
        <span className="shrink-0 font-mono text-mono text-neutral3">{copied ? 'copied' : 'copy'}</span>
      </button>
    </div>
  )
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
  const trimmed = name.trim()
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
        {/* THE PREVIEW ONLY EXISTS ONCE THERE IS A NAME — the prototype's `prevOn: nm!==''`.
            "You'll be @ — anyone can pay you by typing it" is a sentence about nothing. */}
        {trimmed === '' ? (
          <Text variant="body4" className="text-neutral2">
            {NAME_CAPTION}
          </Text>
        ) : (
          <Text variant="body3" className="text-accent1" aria-live="polite">
            {namePreview(trimmed, claimPublicly)}
          </Text>
        )}
      </label>

      {/* The public claim is separate from the local label, because they are different acts: a
          label is private to this browser, a claim is a record anyone can look up. */}
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
        aria-disabled={trimmed === ''}
        onClick={onContinue}
      >
        {NAME_CTA}
      </Button>
    </>
  )
}

/**
 * The Studio progress segments across the top of the takeover, accent up to and including the
 * current step. Decoration beside the spoken "Step N of 2", so it is hidden from assistive
 * technology rather than announced twice.
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
