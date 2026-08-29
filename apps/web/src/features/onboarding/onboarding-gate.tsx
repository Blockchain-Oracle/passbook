import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { useBackupCeremony, useSession } from '@/app/session'
import { BrandLockup } from '@/components/brand/brand-mark'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { accountStatusQuery } from '@/queries'
import { BackupCeremony } from './backup-ceremony'
import { FundStep } from './fund-step'
import { ImportPanel } from './import-panel'
import { BootingScreen, CheckingScreen, LockedScreen, NoStorageScreen } from './locked-screen'
import { RegisterStep } from './register-step'
import { CustodyScreen, ForkScreen, NameScreen, TeachScreen, type NameChoice } from './screens'

type Step = 'fork' | 'import' | 'teach' | 'name' | 'custody' | 'backup' | 'fund' | 'register'

/** The numbered steps; `fork`/`import` sit before the count starts. */
const NUMBERED: readonly Step[] = ['teach', 'name', 'custody', 'backup', 'fund', 'register']
const KEYED: readonly Step[] = ['backup', 'fund', 'register']

/** Base UI's Dialog owns role, aria-modal, the focus trap and the scroll lock; this only fills the screen. */
function Frame({ step, onBack, onSkip, children }: { step: Step | null; onBack?: () => void; onSkip?: () => void; children: ReactNode }) {
  const index = step ? NUMBERED.indexOf(step) : -1
  return (
    <Dialog open modal disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 z-[60] block h-dvh w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none bg-background p-0 text-foreground ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Set up your wallet</DialogTitle>
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-8 px-4 py-8 md:px-8 md:py-12">
        <header className="flex items-center justify-between gap-3">
          <BrandLockup />
          <div className="flex items-center gap-2">
            {onBack ? (
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
            ) : null}
            {onSkip ? (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Skip for now
              </Button>
            ) : null}
          </div>
        </header>
        {index >= 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-kicker uppercase text-muted-foreground">
              Step {index + 1} of {NUMBERED.length}
            </p>
            <Progress value={Math.round(((index + 1) / NUMBERED.length) * 100)} aria-label="Onboarding progress" />
          </div>
        ) : null}
        <main className="flex-1">{children}</main>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Full-screen over the shell whenever this browser has no usable, registered account. Nothing
 * mints a key silently: `fresh` waits for a press, `locked` waits for the unlock, and a `ready`
 * key waits for its backup, its funding and its registration.
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

  if (session.status === 'booting') return <Frame step={null}><BootingScreen /></Frame>
  if (session.status === 'no-storage') return <Frame step={null}><NoStorageScreen reason={session.reason} /></Frame>

  if (session.status === 'locked') {
    if (step === 'import') {
      return (
        <Frame step={null} onBack={() => setStep('fork')}>
          <ImportPanel onDone={() => { setImported(true); setStep('fund') }} />
        </Frame>
      )
    }
    return <Frame step={null}><LockedScreen session={session} onImport={() => setStep('import')} /></Frame>
  }

  if (session.status === 'fresh') {
    // A key that is gone cannot be past a pre-key screen.
    switch (KEYED.includes(step) ? 'fork' : step) {
      case 'import':
        return (
          <Frame step={null} onBack={() => setStep('fork')}>
            <ImportPanel onDone={() => { setImported(true); setStep('fund') }} />
          </Frame>
        )
      case 'teach':
        return <Frame step={step} onBack={() => setStep('fork')}><TeachScreen onNext={() => setStep('name')} /></Frame>
      case 'name':
        return (
          <Frame step={step} onBack={() => setStep('teach')}>
            <NameScreen initial={choice} onNext={(c) => { setChoice(c); setStep('custody') }} />
          </Frame>
        )
      case 'custody':
        return (
          <Frame step={step} onBack={() => setStep('name')}>
            <CustodyScreen label={choice.name || null} onNext={() => setStep('backup')} />
          </Frame>
        )
      default:
        return <Frame step={null}><ForkScreen onCreate={() => setStep('teach')} onImport={() => setStep('import')} /></Frame>
    }
  }

  // ready
  if (entered) return null
  if (status.data?.rung === 'ready') return null
  if (!status.data || status.data.rung === 'unknown') {
    return (
      <Frame step={null}>
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
        <Frame step="fund" onSkip={skip}>
          <FundStep address={address} onNext={() => setStep('register')} />
        </Frame>
      )
    case 'register':
      return (
        <Frame step="register" onBack={() => setStep('fund')} onSkip={skip}>
          <RegisterStep address={address} name={choice.name || session.label || null} claimPublicly={choice.claimPublicly} backedUp={backedUp} onEnter={skip} />
        </Frame>
      )
    default:
      // No skip here: the copy says this is the one step that cannot be skipped, and it is true.
      return (
        <Frame step="backup">
          <BackupCeremony onComplete={() => setStep('fund')} />
        </Frame>
      )
  }
}
