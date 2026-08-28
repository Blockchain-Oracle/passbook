import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { recordLocal } from '@strk20/protocol/activity-store'
import { toPlainText } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import {
  REGISTER_FUNDS_FLOOR_WEI,
  REGISTER_NEEDS_FUNDS,
  fundRefused,
} from '@strk20/protocol/onboarding-copy'
import type { OnboardingStage, RegistrationStage } from '@strk20/protocol/pipeline-stage'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'

import { claimAfterRegistration } from '../../shell/claim-after-registration'
import { requestDrip } from '../../shell/faucet'
import { readAccountStatus, type AccountStatus } from '../../shell/account-status'
import { registerAccount } from '../../shell/register'
import { labelAccount, useSession } from '../../shell/session'
import { deployAccount } from '../../shell/submit'
import { useFirstRun } from '../../shell/use-first-run'
import { usePoolFee } from '../../shell/use-pool-fee'
import { BackupCeremony } from '../BackupCeremony'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'
import { ConversionPanel } from './ConversionPanel'

const APP_NAME = 'Passbook'

/**
 * The account gate lives in the shell, above the route outlet. A deep link can therefore keep its
 * exact path and search string mounted underneath while account creation runs, then resume without
 * translating that destination through a second routing format.
 */
export function OnboardingGate() {
  const session = useSession()
  const firstRun = useFirstRun()
  const poolFee = usePoolFee()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [readNonce, setReadNonce] = useState(0)
  const [backedUp, setBackedUp] = useState(false)
  const [creationStage, setCreationStage] = useState<OnboardingStage | null>(null)
  const [registrationStage, setRegistrationStage] = useState<RegistrationStage | null>(null)
  const [reached, setReached] = useState<readonly OnboardingStage[]>([])
  const [failedAt, setFailedAt] = useState<OnboardingStage | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dripReceipt, setDripReceipt] = useState<{ amount: string; txHash: string } | null>(null)
  const [registrationReceipt, setRegistrationReceipt] = useState<{
    txHash: string
    block: number | null
  } | null>(null)
  const [creationDone, setCreationDone] = useState(false)
  const [entered, setEntered] = useState(false)
  const pendingClaim = useRef<{ name: string; claimPublicly: boolean }>({
    name: '',
    claimPublicly: false,
  })

  const ready = session.status === 'ready' ? session : null

  const gateActive =
    ready !== null &&
    !entered &&
    (status === null || status.rung === 'unknown' || status.rung !== 'ready' || creationDone)

  // The takeover is portalled outside the React root, then the entire shell is made inert. This
  // keeps the deep-linked route mounted without leaving its controls reachable to Tab or a screen
  // reader while account creation is mandatory.
  useEffect(() => {
    const shell = document.getElementById('root')
    if (!gateActive || !shell) return
    const previousHidden = shell.getAttribute('aria-hidden')
    shell.inert = true
    shell.setAttribute('aria-hidden', 'true')
    return () => {
      shell.inert = false
      if (previousHidden === null) shell.removeAttribute('aria-hidden')
      else shell.setAttribute('aria-hidden', previousHidden)
    }
  }, [gateActive])

  useEffect(() => {
    if (!ready) {
      setStatus(null)
      return
    }
    let live = true
    void readAccountStatus(ready.address).then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
    }
  }, [readNonce, ready])

  useEffect(() => {
    if (!ready || status === null || status.rung === 'ready' || status.rung === 'unknown') return
    firstRun.start('arrival', { hasAccount: false })
  }, [firstRun.start, ready, status])

  useEffect(() => {
    if (!ready || (status?.rung === 'ready' && !creationDone)) return
    const timer = window.setInterval(() => setReadNonce((value) => value + 1), 10_000)
    return () => window.clearInterval(timer)
  }, [creationDone, ready, status?.rung])

  const create = useCallback(async () => {
    if (!ready || creationStage !== null || creationDone) return
    if (!backedUp) {
      setProblem('Save the recovery file and verify its separate recovery code before continuing.')
      return
    }

    setProblem(null)
    setFailedAt(null)
    setReached([])
    setDripReceipt(null)
    setRegistrationReceipt(null)
    setCreationStage('drip')

    const drip = await requestDrip(ready.address)
    if (drip.ok) {
      setDripReceipt({
        amount: toPlainText(BigInt(drip.amountWei), KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? 18),
        txHash: drip.txHash,
      })
    }

    const funded = await readAccountStatus(ready.address)
    setStatus(funded)
    if (funded.strkWei !== null && funded.strkWei < REGISTER_FUNDS_FLOOR_WEI) {
      setCreationStage(null)
      setFailedAt('drip')
      setProblem(drip.ok ? REGISTER_NEEDS_FUNDS : fundRefused(drip.because))
      return
    }
    setReached(['drip'])

    setCreationStage('deploy')
    if (funded.rung === 'undeployed') {
      const deployed = await deployAccount(ready.accountKey, ready.address)
      if (!deployed.ok) {
        setCreationStage(null)
        setFailedAt('deploy')
        setProblem(deployed.because)
        return
      }
    }
    setReached(['drip', 'deploy'])

    setCreationStage('register')
    const registered = await registerAccount({
      accountKey: ready.accountKey,
      address: ready.address,
      backedUp: true,
      onStage: setRegistrationStage,
    })
    setRegistrationStage(null)
    if (!registered.ok) {
      setCreationStage(null)
      setFailedAt('register')
      setProblem(registered.because)
      return
    }
    setReached(['drip', 'deploy', 'register'])

    setCreationStage('confirm')
    setRegistrationReceipt({ txHash: registered.transactionHash, block: registered.block })
    recordLocal({
      id: `registration:${registered.transactionHash}`,
      chain: {
        state: 'optimistic',
        submittedAt: Date.now(),
        stage: 'confirmed',
        transactionHash: registered.transactionHash,
      },
      surface: 'wallet',
      label: 'Account registration',
    })
    setReached(['drip', 'deploy', 'register', 'confirm'])
    setCreationStage(null)
    setCreationDone(true)
    setStatus(await readAccountStatus(ready.address))

    void claimAfterRegistration({
      ...pendingClaim.current,
      address: ready.address,
      viewingKey: ready.viewingKey,
    })
    pendingClaim.current = { name: '', claimPublicly: false }
  }, [backedUp, creationDone, creationStage, ready])

  if (!ready) return null

  if (status === null) {
    return portal(<GateStatus title="Checking this account" detail="Reading its funding, deployment and pool registration." />)
  }

  if (status.rung === 'unknown') {
    return portal(
      <GateStatus
        title="The account could not be verified"
        detail={status.because ?? 'The chain did not return an account status.'}
        action={<Button onClick={() => setReadNonce((value) => value + 1)}>Try again</Button>}
      />,
    )
  }

  const needsOnboarding = status.rung !== 'ready'
  if ((!needsOnboarding && !creationDone) || entered) return null

  return portal(
    <ConversionPanel
      feeStrk={poolFee}
      appName={APP_NAME}
      inviter={firstRun.inviter}
      onGenerateKey={async (name, claimPublicly) => {
        pendingClaim.current = { name, claimPublicly }
        if (name !== '') await labelAccount(ready.address, name)
      }}
      onCreate={create}
      address={ready.address}
      fundsWei={status.strkWei}
      problem={problem ?? (registrationStage ? `Registration: ${registrationStage}` : null)}
      creation={{
        stage: creationStage,
        reached,
        failedAt,
        receipt: dripReceipt,
        registrationReceipt,
        done: creationDone,
      }}
      renderBackup={(onDone) => (
        <BackupCeremony
          accountKey={ready.accountKey}
          receiveAddress={ready.address}
          onComplete={() => {
            setBackedUp(true)
            onDone()
          }}
        />
      )}
      dismissible={false}
      onDismiss={() => {
        if (!creationDone) return
        setEntered(true)
        firstRun.complete()
      }}
    />,
  )
}

function portal(node: React.ReactNode): React.ReactNode {
  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}

function GateStatus({
  title,
  detail,
  action,
}: {
  title: string
  detail: string
  action?: React.ReactNode
}) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => root.current?.focus(), [])
  return (
    <section
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-live="polite"
      onKeyDown={(event) => trapTab(event, root.current)}
      className="fixed inset-s0 z-modal flex items-center justify-center bg-ground px-s20"
    >
      <div className="flex w-full max-w-[480px] flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s20">
        <Text variant="display3" as="h1">
          {title}
        </Text>
        <Text variant="body3" className="text-neutral2">
          {detail}
        </Text>
        {action}
      </div>
    </section>
  )
}

function trapTab(event: React.KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== 'Tab' || !root) return
  const controls = [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute('aria-hidden'))
  if (controls.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
