import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import { enteredSnapshot, hasEntered, setEntered as setEnteredFor, subscribeEntered } from '@/app/onboarding-entry'
import { useBackupCeremony, useSession } from '@/app/session'
import { accountStatusQuery } from '@/queries'
import { BackupCeremony } from './backup-ceremony'
import { Frame, KEYED, type Step } from './frame'
import { FundStep } from './fund-step'
import { ImportPanel } from './import-panel'
import { BootingScreen, CheckingScreen, LockedScreen, NoStorageScreen } from './locked-screen'
import { RegisterStep } from './register-step'
import { CustodyScreen } from './custody-screen'
import { ForkScreen, NameScreen, TeachScreen, type NameChoice } from './screens'

/**
 * The gate: the onboarding stack, which is exactly as tall as the account is short. It renders
 * nothing once the account is ready, or once its owner has pressed Enter / Skip for this address.
 */
export function OnboardingGate() {
  const session = useSession()
  const backup = useBackupCeremony()
  const [step, setStep] = useState<Step>('fork')
  const [choice, setChoice] = useState<NameChoice>({ name: '', claimPublicly: true })
  const [imported, setImported] = useState(false)
  // Which address has been let in, PERSISTED and shared. It used to be a `useState` here, which
  // meant Skip did not survive a reload and nothing outside this component could read it — so the
  // shell had no way to tell "still deciding" from "in the app, unregistered, and stuck".
  useSyncExternalStore(subscribeEntered, enteredSnapshot, enteredSnapshot)
  const ready = session.status === 'ready' && !!session.address
  const status = useQuery({
    ...accountStatusQuery(ready ? session.address : undefined),
    refetchInterval: 10_000,
  })
  const entered = ready && hasEntered(session.address)

  // Reopening starts from the RUNG, not from wherever this tab was left. The gate stays mounted
  // rendering `null` after a skip, so `step` survives — and since a skip always happens on a KEYED
  // screen, `step` would win over `resume` below and drop someone back on the step they finished.
  const wasEntered = useRef(entered)
  useEffect(() => {
    if (wasEntered.current && !entered) setStep('fork')
    wasEntered.current = entered
  }, [entered])
  const setEntered = (next: boolean) => setEnteredFor(next ? (session.address ?? null) : null)

  if (session.status === 'booting') return <Frame screen="booting" step={null}><BootingScreen /></Frame>
  if (session.status === 'no-storage') return <Frame screen="no-storage" step={null}><NoStorageScreen reason={session.reason} /></Frame>

  if (session.status === 'locked') {
    if (step === 'import') {
      return (
        <Frame screen="import" step={null} onBack={() => setStep('fork')}>
          <ImportPanel onDone={() => { setImported(true); setStep('fund') }} />
        </Frame>
      )
    }
    return <Frame screen="locked" step={null}><LockedScreen session={session} onImport={() => setStep('import')} /></Frame>
  }

  if (session.status === 'fresh') {
    // A key that is gone cannot be past a pre-key screen.
    switch (KEYED.includes(step) ? 'fork' : step) {
      case 'import':
        return (
          <Frame screen="import" step={null} onBack={() => setStep('fork')}>
            <ImportPanel onDone={() => { setImported(true); setStep('fund') }} />
          </Frame>
        )
      case 'teach':
        return <Frame screen="teach" step={step} onBack={() => setStep('fork')}><TeachScreen onNext={() => setStep('name')} /></Frame>
      case 'name':
        return (
          <Frame screen="name" step={step} onBack={() => setStep('teach')}>
            <NameScreen initial={choice} onNext={(c) => { setChoice(c); setStep('custody') }} />
          </Frame>
        )
      case 'custody':
        return (
          <Frame screen="custody" step={step} onBack={() => setStep('name')}>
            <CustodyScreen label={choice.name || null} onNext={() => setStep('backup')} />
          </Frame>
        )
      default:
        return <Frame screen="fork" step={null}><ForkScreen onCreate={() => setStep('teach')} onImport={() => setStep('import')} /></Frame>
    }
  }

  // ready
  if (entered) return null
  if (status.data?.rung === 'ready') return null
  if (!status.data || status.data.rung === 'unknown') {
    return (
      <Frame screen="checking" step={null} address={session.address}>
        <CheckingScreen
          problem={status.data?.because ?? (status.isError ? status.error.message : null)}
          onRetry={() => void status.refetch()}
          onContinue={() => setEntered(true)}
        />
      </Frame>
    )
  }

  const address = session.address!
  const skip = () => setEntered(true)
  const backedUp = backup.complete || imported
  // Where an UNTOUCHED gate opens, which is what a return through the banner gets. Derived from
  // the rung rather than fixed at `fund`: someone sent back here by "Register" is already funded,
  // and starting them on the funding screen would make them press past a step they finished.
  const resume = !backedUp ? 'backup' : status.data.rung === 'unfunded' ? 'fund' : 'register'
  // A key that exists cannot be on a pre-key screen.
  switch (KEYED.includes(step) ? step : resume) {
    case 'fund':
      return (
        <Frame screen="fund" step="fund" address={address} onSkip={skip}>
          <FundStep address={address} onNext={() => setStep('register')} />
        </Frame>
      )
    case 'register':
      return (
        <Frame screen="register" step="register" address={address} onBack={() => setStep('fund')} onSkip={skip}>
          <RegisterStep address={address} name={choice.name || session.label || null} claimPublicly={choice.claimPublicly} backedUp={backedUp} onEnter={skip} />
        </Frame>
      )
    default:
      // ── SKIPPABLE NOW, AND THE SAFETY IT USED TO CARRY MOVED RATHER THAN VANISHED ────────
      //
      // This frame had no exit, because the gate was once the only way to register and leaving it
      // meant never registering. With a standing banner that is no longer true — and the missing
      // exit became a trap: someone who imported a recovery file, skipped, and reloaded lost
      // `imported`, landed back here through the banner, and could not get out of a modal that
      // dismisses on nothing. The rule it was enforcing — never register a key nobody saved — is
      // enforced where it belongs, at the write: `useRegister` gates on `backedUp` and
      // `registerSponsored` refuses with `backup-not-confirmed`. A door is not a safety property.
      return (
        <Frame screen="backup" step="backup" address={address} onSkip={skip}>
          <BackupCeremony onComplete={() => setStep('fund')} />
        </Frame>
      )
  }
}
