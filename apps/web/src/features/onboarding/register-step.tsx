import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { DIRECTORY_NAME_PATTERN } from '@strk20/protocol/directory-name'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { ONBOARDING_STAGES, type OnboardingStage } from '@strk20/protocol/pipeline-stage'
import {
  CREATE_BLOCKED,
  ENTER_CTA,
  FUND_ADDRESS_HINT,
  ONBOARDING_STAGE_NOTES,
  REGISTERED_BODY,
  REGISTERED_TITLE,
  REGISTER_CTA,
  REGISTER_NEEDS_FUNDS,
  REGISTER_TITLE,
  createFeeNote,
  doneSub,
  doneTitle,
} from '@strk20/protocol/onboarding-copy'
import { toast } from 'sonner'

import { OperationPipeline } from '@/components/money/operation-pipeline'
import { Receipt } from '@/components/money/receipt'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { explorerTx, formatWei } from '@/lib/format'
import { useDeployAccount, useDirectoryClaim, useRegister } from '@/mutations'
import { accountStatusQuery, poolConstantsQuery } from '@/queries'
import { AddressQr } from './address-qr'

const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? 18

interface Ladder {
  reached: OnboardingStage[]
  failedAt: OnboardingStage | null
  startedAt: number | null
  problem: string | null
  receipt: { transactionHash: string; block: number | null } | null
  done: boolean
}

const IDLE: Ladder = { reached: [], failedAt: null, startedAt: null, problem: null, receipt: null, done: false }

interface RegisterStepProps {
  address: string
  name: string | null
  claimPublicly: boolean
  /** The ceremony reached `ready`, or the key came in through a recovery file. */
  backedUp: boolean
  onEnter: () => void
}

/**
 * The ladder: drip (already landed, or not) → deploy → register → confirm. Each rung is a real
 * callback. The SELF_PAY floor and the sponsored fallback live in `useRegister`.
 */
export function RegisterStep({ address, name, claimPublicly, backedUp, onEnter }: RegisterStepProps) {
  const fee = useQuery(poolConstantsQuery())
  const status = useQuery({ ...accountStatusQuery(address), refetchInterval: 10_000 })
  const deploy = useDeployAccount()
  const register = useRegister()
  const claim = useDirectoryClaim()
  const [ladder, setLadder] = useState<Ladder>(IDLE)
  const feeStrk = fee.data ? formatWei(fee.data.feeWei, STRK_DECIMALS, 2) : null
  const running = deploy.isPending || register.isPending

  const run = async () => {
    if (running || ladder.done) return
    const current = status.data ?? (await status.refetch()).data
    if (!current) return
    const patch = (p: Partial<Ladder>) => setLadder((l) => ({ ...l, ...p }))
    setLadder({ ...IDLE, startedAt: Date.now() })

    if (current.rung === 'unknown') {
      patch({ failedAt: 'drip', problem: current.because ?? 'The account could not be read.' })
      return
    }
    if (current.rung === 'unfunded') {
      patch({ failedAt: 'drip', problem: REGISTER_NEEDS_FUNDS })
      return
    }
    patch({ reached: ['drip'] })

    if (current.rung === 'undeployed') {
      const deployed = await deploy.mutateAsync()
      if (!deployed.ok) {
        patch({ failedAt: 'deploy', problem: deployed.because })
        return
      }
    }
    patch({ reached: ['drip', 'deploy'] })

    if (current.rung !== 'ready') {
      const registered = await register.mutateAsync({ backedUp })
      if (!registered.ok) {
        patch({ failedAt: 'register', problem: registered.because })
        return
      }
      patch({ receipt: { transactionHash: registered.transactionHash, block: registered.block } })
    }
    patch({ reached: [...ONBOARDING_STAGES], done: true })

    if (claimPublicly && name && DIRECTORY_NAME_PATTERN.test(name)) {
      const outcome = await claim.mutateAsync({ name })
      if (outcome.ok) toast.success(`You are @${name}`, { description: 'Anyone can now find this address by that name.' })
      else toast.info('Your account is ready', { description: `The name @${name} was not claimed: ${outcome.because} You can claim one in Settings.` })
    }
  }

  const started = ladder.startedAt !== null
  const rung = status.data?.rung

  if (ladder.done) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="font-display text-display3 uppercase">{name ? doneTitle(name) : REGISTERED_TITLE}</h2>
          <p className="mt-1 text-body3 text-muted-foreground">{name ? doneSub(claimPublicly) : REGISTERED_BODY}</p>
        </div>
        <OperationPipeline stages={ONBOARDING_STAGES} reached={ladder.reached} startedAt={ladder.startedAt} />
        {ladder.receipt ? (
          <Receipt
            title="Account registered"
            transactionHash={ladder.receipt.transactionHash}
            boundary="revealsInfo"
            explorerUrl={explorerTx(ladder.receipt.transactionHash)}
            rows={[{ label: 'Confirmed', value: ladder.receipt.block ? `block ${ladder.receipt.block}` : 'on Starknet' }]}
          />
        ) : null}
        <Button size="lg" className="self-start" onClick={onEnter}>
          {ENTER_CTA}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-display3 uppercase">{REGISTER_TITLE}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{createFeeNote(feeStrk)}</p>
      </div>

      {started ? (
        <OperationPipeline
          stages={ONBOARDING_STAGES}
          reached={ladder.reached}
          failedAt={ladder.failedAt}
          startedAt={ladder.startedAt}
          notes={ONBOARDING_STAGE_NOTES}
        />
      ) : null}

      {ladder.problem ? (
        <Alert variant="destructive">
          <AlertDescription>{ladder.problem}</AlertDescription>
        </Alert>
      ) : null}
      {ladder.failedAt === 'drip' && rung === 'unfunded' ? <AddressQr address={address} hint={FUND_ADDRESS_HINT} /> : null}

      {!backedUp ? <p className="text-body4 text-muted-foreground">{CREATE_BLOCKED}</p> : null}

      <Button
        size="lg"
        className="self-start"
        aria-disabled={running || !backedUp}
        onClick={() => backedUp && void run()}
      >
        {running ? <Spinner data-icon="inline-start" /> : ladder.failedAt ? <RotateCcw data-icon="inline-start" /> : null}
        {running ? 'Working…' : ladder.failedAt ? 'Try again' : REGISTER_CTA}
      </Button>
    </div>
  )
}
