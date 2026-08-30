import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Droplets } from 'lucide-react'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import {
  DEADLOCK_TITLE,
  DRIP_RECEIPT_SUB,
  FUND_ADDRESS_HINT,
  FUND_CTA,
  FUND_PENDING,
  deadlockBody,
  deadlockFeeRow,
  fundArrived,
  fundRefused,
  fundsArrived,
} from '@strk20/protocol/onboarding-copy'
import { POOL_SEES } from '@strk20/protocol/disclosure-copy'

import { Amount } from '@/components/money/amount'
import { Receipt } from '@/components/money/receipt'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { explorerTx, formatWei } from '@/lib/format'
import { useFaucet } from '@/mutations'
import { accountStatusQuery, poolConstantsQuery } from '@/queries'
import { AddressQr } from './address-qr'
import { ConnectFundingWallet } from './connect-funding-wallet'

const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? 18

interface FundStepProps {
  address: string
  onNext: () => void
}

/** The deadlock, named — and its three doors: the faucet, a wallet, or any exchange to the address. */
export function FundStep({ address, onNext }: FundStepProps) {
  const fee = useQuery(poolConstantsQuery())
  const status = useQuery({ ...accountStatusQuery(address), refetchInterval: 10_000 })
  const faucet = useFaucet()
  const feeStrk = fee.data ? formatWei(fee.data.feeWei, STRK_DECIMALS, 2) : null
  const strkWei = status.data?.strkWei ?? null
  const drip = faucet.data

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-display3 uppercase">{DEADLOCK_TITLE}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{deadlockBody(feeStrk)}</p>
      </div>

      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-body4">
        <p className="font-medium">{deadlockFeeRow('strk20.run', feeStrk)}</p>
        <p className="text-muted-foreground">{POOL_SEES}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="font-display text-display4 uppercase">Starter STRK</p>
            <p className="text-body4 text-muted-foreground">One drip, enough to put this account on chain.</p>
          </div>
          <Button aria-disabled={faucet.isPending || drip?.ok === true} onClick={() => !faucet.isPending && !drip?.ok && faucet.mutate()}>
            {faucet.isPending ? <Spinner data-icon="inline-start" /> : <Droplets data-icon="inline-start" />}
            {faucet.isPending ? 'Sending…' : drip?.ok ? 'Dripped' : 'Drip STRK here'}
          </Button>
        </div>
        {faucet.isPending ? <p className="text-body4 text-muted-foreground">{FUND_PENDING}</p> : null}
        {drip?.ok ? (
          <>
            <p className="text-body4">{fundArrived(formatWei(drip.amountWei, STRK_DECIMALS))}</p>
            <Receipt
              title="Drip receipt"
              transactionHash={drip.txHash}
              boundary="bothPublic"
              explorerUrl={explorerTx(drip.txHash)}
              rows={[
                { label: 'Amount', value: <Amount wei={drip.amountWei} decimals={STRK_DECIMALS} symbol="STRK" /> },
                { label: 'From', value: DRIP_RECEIPT_SUB },
              ]}
            />
          </>
        ) : null}
        {drip && !drip.ok ? (
          <Alert variant="destructive">
            <AlertDescription>{fundRefused(drip.because)}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <AddressQr address={address} hint={FUND_ADDRESS_HINT} />

      <ConnectFundingWallet embeddedAddress={address} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <span className="text-body4 text-muted-foreground">Public STRK at this address</span>
        {strkWei !== null && strkWei > 0n ? (
          <span className="text-body4 text-settled">{fundsArrived(formatWei(strkWei, STRK_DECIMALS))}</span>
        ) : (
          <Amount wei={strkWei === null && status.isPending ? undefined : strkWei} decimals={STRK_DECIMALS} symbol="STRK" />
        )}
      </div>

      <Button size="lg" className="self-start" onClick={onNext}>
        {FUND_CTA}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  )
}
