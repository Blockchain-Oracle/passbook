import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { toPlainText } from '@strk20/protocol/amount'
import { BRIDGE_USDC_DECIMALS, BRIDGE_USDC_SYMBOL } from '@strk20/protocol/bridge'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'

import { Amount } from '@/components/money/amount'
import { MoneyField } from '@/components/money/money-field'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { Receipt } from '@/components/money/receipt'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { explorerTx } from '@/lib/format'
import { describeSendFailure, usePipeline, useSend } from '@/mutations'
import { BridgeReview } from './bridge-review'
import { ChainMark } from './chain-marks'
import { DestinationField } from './destination-field'
import { DestinationPicker } from './destination-picker'
import { LinkabilityMeter } from './linkability-meter'
import { useBridgeForm } from './use-bridge-form'

interface Landed {
  hash: string
  deliveredWei: bigint
  chainName: string
  chainKey: string
  destination: string
}

/** The private-pool exit: shielded USDC → a public address on another chain, one way. */
export function BridgeSurface({ initialChain }: { initialChain?: string }) {
  const form = useBridgeForm(initialChain)
  const send = useSend()
  const pipeline = usePipeline()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [landed, setLanded] = useState<Landed | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const ours = pipeline?.operation === 'bridge' ? pipeline : null
  const running = ours !== null && ours.terminal === null && ours.failedAt === null
  const lastStage = ours?.reached.at(-1)
  const stageLabel = running && lastStage ? STAGE_TITLES[lastStage] : null

  const openReview = () => {
    if (form.formBlocker) {
      toast(form.formBlocker)
      return
    }
    setProblem(null)
    setReviewOpen(true)
  }

  const confirm = async () => {
    const ask = form.ask
    if (!ask || send.isPending || form.deliveredWei === null) return
    // Frozen at send time: a form edited afterwards must not rewrite a receipt.
    const frozen = {
      chainName: form.chain.name,
      chainKey: form.chain.key,
      destination: form.destination.trim(),
      deliveredWei: form.deliveredWei,
    }
    const result = await send.mutateAsync(ask)
    if (result.ok) {
      setLanded({ hash: result.transactionHash, ...frozen })
      setReviewOpen(false)
      form.reset()
      return
    }
    setProblem(describeSendFailure(result.failure))
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-display4 uppercase">Crossing</CardTitle>
          <CardDescription>
            Send shielded {BRIDGE_USDC_SYMBOL} out to another chain. Outbound only — bringing value back is not built.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <DestinationPicker value={form.chain} onChange={form.setChain} />
          <MoneyField
            value={form.amount}
            onChange={form.setAmount}
            symbol={BRIDGE_USDC_SYMBOL}
            decimals={BRIDGE_USDC_DECIMALS}
            available={form.heldWei ?? null}
            boundary="shielded"
            onMax={
              typeof form.heldWei === 'bigint'
                ? () => form.setAmount(toPlainText(form.heldWei as bigint, BRIDGE_USDC_DECIMALS))
                : undefined
            }
            problem={
              form.amountProblem ??
              (typeof form.heldWei === 'bigint' && form.amountWei !== null && form.amountWei > form.heldWei
                ? `Not enough shielded ${BRIDGE_USDC_SYMBOL}`
                : null)
            }
          />
          <DestinationField
            value={form.destination}
            onChange={form.setDestination}
            chain={form.chain}
            problem={form.destinationProblem}
            selfLink={form.selfLink}
          />
          {form.fee ? <FeeSummary form={form} /> : null}
          <LinkabilityMeter meter={form.meter} pending={form.crowdPending} variant="row" />
          <Button size="lg" aria-disabled={form.formBlocker !== null || undefined} onClick={openReview}>
            {form.formBlocker ?? 'Review crossing'}
            {form.formBlocker ? null : <ArrowUpRight data-icon="inline-end" />}
          </Button>
        </CardContent>
      </Card>

      <aside className="flex flex-col gap-4">
        {ours ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-display4 uppercase">{ours.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <OperationPipeline
                stages={ours.stages}
                reached={ours.reached}
                failedAt={ours.failedAt}
                replaced={ours.replaced}
                startedAt={ours.startedAt}
                notes={{ mature: 'A crossing mints no note to wait for; the pool only has to accept the burn.' }}
              />
              {ours.terminal === 'confirmation-unknown' ? (
                <p className="mt-3 text-body4 text-exposed">
                  Confirmation is unknown. The burn may have landed — check the transaction before sending again.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {landed ? <LandedReceipt landed={landed} /> : null}
        <Card>
          <CardContent>
            <LinkabilityMeter meter={form.meter} pending={form.crowdPending} />
          </CardContent>
        </Card>
      </aside>

      <BridgeReview
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        chain={form.chain}
        destination={form.destination.trim()}
        amountWei={form.amountWei}
        deliveredWei={form.deliveredWei}
        fee={form.fee}
        meter={form.meter}
        crowdPending={form.crowdPending}
        selfLink={form.selfLink}
        blocker={stageLabel ?? form.reviewBlocker}
        busy={send.isPending}
        problem={problem}
        onConfirm={confirm}
      />
    </div>
  )
}

function FeeSummary({ form }: { form: ReturnType<typeof useBridgeForm> }) {
  const usdc = (wei: bigint | null) => <Amount wei={wei} decimals={BRIDGE_USDC_DECIMALS} symbol={BRIDGE_USDC_SYMBOL} size="sm" />
  return (
    <ItemGroup className="rounded-lg border" aria-busy={form.feeStale || undefined}>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Arrives on {form.chain.name}</ItemTitle>
          <ItemDescription>Circle pays the gas at the far end</ItemDescription>
        </ItemContent>
        <span className="inline-flex items-center gap-2">
          {usdc(form.deliveredWei)}
          <ChainMark chainKey={form.chain.key} size={16} />
        </span>
      </Item>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>Fee{form.feeStale ? ' · re-reading' : ''}</ItemTitle>
        </ItemContent>
        {usdc(form.fee?.maxFeeWei ?? null)}
      </Item>
    </ItemGroup>
  )
}

/** "On its way", not "arrived": this browser saw the Starknet burn, not the far-end mint. */
function LandedReceipt({ landed }: { landed: Landed }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <Receipt
        title={`On its way to ${landed.chainName}`}
        transactionHash={landed.hash}
        boundary="publicExit"
        explorerUrl={explorerTx(landed.hash)}
        rows={[
          { label: 'Delivered', value: <Amount wei={landed.deliveredWei} decimals={BRIDGE_USDC_DECIMALS} symbol={BRIDGE_USDC_SYMBOL} /> },
          {
            label: 'Chain',
            value: (
              <span className="inline-flex items-center gap-2">
                <ChainMark chainKey={landed.chainKey} size={16} />
                {landed.chainName}
              </span>
            ),
          },
          { label: 'Destination', value: <span className="break-all text-mono">{landed.destination}</span> },
        ]}
      />
      <p className="px-1 text-body4 text-muted-foreground">
        The burn is on Starknet. Circle submits the transfer at the far end — usually within seconds, and this browser
        does not watch it happen.
      </p>
    </div>
  )
}
