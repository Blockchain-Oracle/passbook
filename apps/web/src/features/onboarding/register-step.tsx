import { useQuery } from '@tanstack/react-query'
import { ArrowRight, RotateCcw } from 'lucide-react'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { ONBOARDING_STAGES } from '@strk20/protocol/pipeline-stage'
import {
  CREATE_BLOCKED,
  ENTER_CTA,
  FUND_ADDRESS_HINT,
  REGISTERED_BODY,
  REGISTERED_TITLE,
  REGISTER_CTA,
  REGISTER_TITLE,
  createFeeNote,
  doneSub,
  doneTitle,
} from '@strk20/protocol/onboarding-copy'

import { OperationPipeline } from '@/components/money/operation-pipeline'
import { Receipt } from '@/components/money/receipt'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { explorerTx, formatWei } from '@/lib/format'
import { poolConstantsQuery } from '@/queries'
import { AddressQr } from './address-qr'
import { useOnboardingLadder } from './use-onboarding-ladder'

const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? 18

interface RegisterStepProps {
  address: string
  name: string | null
  claimPublicly: boolean
  /** The ceremony reached `ready`, or the key came in through a recovery file. */
  backedUp: boolean
  onEnter: () => void
}

export function RegisterStep({ address, name, claimPublicly, backedUp, onEnter }: RegisterStepProps) {
  const fee = useQuery(poolConstantsQuery())
  const { ladder, start, running, notes, rung } = useOnboardingLadder({ address, name, claimPublicly, backedUp })
  const feeStrk = fee.data ? formatWei(fee.data.feeWei, STRK_DECIMALS, 2) : null
  const started = ladder.startedAt !== null

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

  const label = ladder.settling ? 'Waiting for the chain…' : running ? 'Working…' : ladder.failedAt ? 'Try again' : REGISTER_CTA

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
          notes={notes}
        />
      ) : null}

      {ladder.problem ? (
        <Alert variant="destructive">
          <AlertDescription>{ladder.problem}</AlertDescription>
        </Alert>
      ) : null}
      {ladder.failedAt === 'drip' && rung === 'unfunded' ? <AddressQr address={address} hint={FUND_ADDRESS_HINT} /> : null}

      {!backedUp ? <p className="text-body4 text-muted-foreground">{CREATE_BLOCKED}</p> : null}

      <Button size="lg" className="self-start" aria-disabled={running || !backedUp} onClick={() => backedUp && void start()}>
        {running ? <Spinner data-icon="inline-start" /> : ladder.failedAt ? <RotateCcw data-icon="inline-start" /> : null}
        {label}
      </Button>
    </div>
  )
}
