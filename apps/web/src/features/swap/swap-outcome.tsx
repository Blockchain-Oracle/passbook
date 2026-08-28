import { ExternalLink } from 'lucide-react'

import { OperationPipeline } from '@/components/money/operation-pipeline'
import { Receipt, shortenHash } from '@/components/money/receipt'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { clearPipeline, clearSettledPipeline, usePipeline } from '@/mutations'

export interface SwapReceiptData {
  transactionHash: string
  sold: string
  quoted: string
  minimum: string
  route: string
}

export interface SwapOutcomeProps {
  receipt: SwapReceiptData | null
  /** The confirm's failure sentence; for `confirmation-unknown` it is the protocol's own. */
  problem: string | null
  onDismissReceipt: () => void
}

/** The swap's pipeline while it runs, then its receipt — or the honest sentence when it did not land. */
export function SwapOutcome({ receipt, problem, onDismissReceipt }: SwapOutcomeProps) {
  const pipeline = usePipeline()
  const mine = pipeline && pipeline.operation === 'swap' ? pipeline : null

  if (receipt) {
    return (
      <div className="flex flex-col gap-2">
        <Receipt
          title="Swap confirmed"
          transactionHash={receipt.transactionHash}
          boundary="shieldedRound"
          explorerUrl={mine?.explorerUrl ?? null}
          rows={[
            { label: 'Sold', value: receipt.sold },
            { label: 'Bought, as quoted', value: receipt.quoted },
            { label: 'Minimum accepted', value: receipt.minimum },
            { label: 'Route', value: receipt.route },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          className="self-end"
          onClick={() => {
            clearSettledPipeline()
            onDismissReceipt()
          }}
        >
          Done
        </Button>
      </div>
    )
  }

  if (!mine) return null

  if (mine.terminal === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-display4 uppercase">{mine.label}</CardTitle>
          <CardDescription>This keeps running if you leave the page. One transaction at a time.</CardDescription>
        </CardHeader>
        <CardContent>
          <OperationPipeline stages={mine.stages} reached={mine.reached} failedAt={mine.failedAt} replaced={mine.replaced} startedAt={mine.startedAt} />
        </CardContent>
      </Card>
    )
  }

  const unknown = mine.terminal === 'confirmation-unknown'
  return (
    <Alert variant={unknown ? 'default' : 'destructive'}>
      <AlertTitle>{unknown ? 'Confirmation unknown' : 'The swap stopped'}</AlertTitle>
      <AlertDescription>
        {problem ?? (unknown ? 'The transaction was submitted but its confirmation could not be read. It may still land.' : `Stopped at ${mine.failedAt ?? 'an unknown stage'}.`)}
        {mine.transactionHash ? (
          <span className="mt-1 block font-mono text-mono">
            {mine.explorerUrl ? (
              <a href={mine.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                {shortenHash(mine.transactionHash)}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              shortenHash(mine.transactionHash)
            )}
          </span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={() => clearPipeline()}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  )
}
