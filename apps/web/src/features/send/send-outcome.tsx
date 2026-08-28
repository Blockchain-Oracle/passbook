import { useQuery } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { blockCountdown } from '@strk20/protocol/progress'
// Type-only: `send.ts` drags the privacy SDK, and a receipt must not.
import type { SendResult, SelfSubmitOffer } from '@strk20/protocol/send'

import { Amount } from '@/components/money/amount'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { Receipt } from '@/components/money/receipt'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { explorerTx } from '@/lib/format'
import { usePipeline } from '@/mutations/pipeline-store'
import { describeSendFailure } from '@/mutations/describe'
import { poolHealthQuery } from '@/queries/pool'

export interface SentSummary {
  amount: bigint
  decimals: number | null
  symbol: string
  /** `@name · 0x…` or the bare address. */
  recipient: string
}

/** The running pipeline row for this tab's send, from the store that survives navigation. */
export function SendPipeline() {
  const pipeline = usePipeline()
  if (!pipeline || (pipeline.operation !== 'transfer' && pipeline.operation !== 'shield')) return null
  return (
    <section aria-label={pipeline.label} className="rounded-lg border bg-raised p-4">
      <p className="text-kicker uppercase text-muted-foreground">{pipeline.label}</p>
      <OperationPipeline
        className="mt-3"
        stages={pipeline.stages}
        reached={pipeline.reached}
        failedAt={pipeline.failedAt}
        replaced={pipeline.replaced}
        startedAt={pipeline.startedAt}
        notes={
          pipeline.terminal === 'confirmation-unknown'
            ? { confirmed: 'Confirmation is unknown: the transaction may have landed. Check the explorer before sending again.' }
            : undefined
        }
      />
    </section>
  )
}

/** The maturity line: blocks are COUNTED from a chain read, never guessed or shown as a percentage. */
function useMaturation(sendBlock: number | null): string | null {
  const health = useQuery(poolHealthQuery())
  if (sendBlock === null || health.data?.state !== 'ok') return null
  // The pool already holds the note (`confirmNoteMature` waited for it); what remains is the send
  // block itself being under the head. One block is that fact, not a hardcoded maturity depth.
  return blockCountdown(Math.max(0, health.data.blockNumber - sendBlock), 1)
}

export function SendReceipt({ result, summary }: { result: Extract<SendResult, { ok: true }>; summary: SentSummary }) {
  const maturation = useMaturation(result.sendBlock)
  const { feeRow } = result
  const fee = (
    <>
      <Amount wei={feeRow.feeWei} decimals={18} symbol="STRK" /> · {feeRow.paidByUs ? `paid by ${feeRow.submitter}` : 'paid by you'}
    </>
  )
  return (
    <Receipt
      title={`Sent ${summary.symbol}`}
      transactionHash={result.transactionHash}
      boundary="shieldedRound"
      explorerUrl={explorerTx(result.transactionHash)}
      rows={[
        { label: 'Amount', value: <Amount wei={summary.amount} decimals={summary.decimals} symbol={summary.symbol} /> },
        { label: 'To', value: summary.recipient },
        { label: 'Fee', value: fee },
        { label: 'Note', value: maturation ?? 'Held by the pool' },
      ]}
    />
  )
}

export interface SendFailedProps {
  result: Extract<SendResult, { ok: false }>
  /** Re-run the same ask on the self-submit path the failure offered. */
  onSelfSubmit: (offer: SelfSubmitOffer) => void
}

/** A failed send in the pipeline's own words; relayer refusals carry the self-submit door. */
export function SendFailed({ result, onSelfSubmit }: SendFailedProps) {
  const failure = result.failure
  const offer = 'selfSubmit' in failure ? failure.selfSubmit : null
  return (
    <Alert variant={failure.kind === 'confirmation-unknown' ? 'default' : 'destructive'}>
      <AlertTitle>{failure.kind === 'confirmation-unknown' ? 'Confirmation unknown' : 'The send stopped'}</AlertTitle>
      <AlertDescription>
        <p>{describeSendFailure(failure)}</p>
        {offer ? (
          <>
            <p className="mt-1">{offer.disclosure}</p>
            <p className="text-muted-foreground">{offer.gasNotice}</p>
          </>
        ) : null}
      </AlertDescription>
      {offer ? (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={() => onSelfSubmit(offer)}>
            <RotateCcw data-icon="inline-start" />
            Pay your own way
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}
