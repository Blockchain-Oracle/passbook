import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useBackupCeremony, useSession } from '@/app/session'
import { accountStatusQuery } from '@/queries'
import { BackupCeremony } from './backup-ceremony'
import { Frame, KEYED, type Step } from './frame'
import { FundStep } from './fund-step'
import { ImportPanel } from './import-panel'
import { BootingScreen, CheckingScreen, LockedScreen, NoStorageScreen } from './locked-screen'
import { RegisterStep } from './register-step'
import { CustodyScreen, ForkScreen, NameScreen, TeachScreen, type NameChoice } from './screens'

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
  /** The address that pressed Enter / Skip; a lock or a switch re-arms the gate. */
  const [enteredFor, setEnteredFor] = useState<string | null>(null)
  const ready = session.status === 'ready' && !!session.address
  const status = useQuery({
    ...accountStatusQuery(ready ? session.address : undefined),
    refetchInterval: 10_000,
  })
  const entered = ready && enteredFor === session.address
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
  // A key that exists cannot be on a pre-key screen.
  switch (KEYED.includes(step) ? step : backedUp ? 'fund' : 'backup') {
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
      // No skip here: the copy says this is the one step that cannot be skipped, and it is true.
      return (
        <Frame screen="backup" step="backup" address={address}>
          <BackupCeremony onComplete={() => setStep('fund')} />
        </Frame>
      )
  }
}
