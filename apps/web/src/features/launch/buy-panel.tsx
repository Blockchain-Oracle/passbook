// The buy: units in, the contract's own cost out, a bearer position stored the moment the send
// lands. The buyer's address goes nowhere near the Launch record — only the commitment does.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { useRefusal } from '@/components/money/refusal'
import { Minus, Plus } from 'lucide-react'
import { UNITS_PER_EPOCH, currentEpoch, type OnChainLaunch } from '@strk20/protocol/app-reads'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { LAUNCH_IDENTITY } from '@strk20/protocol/disclosure-copy'
import { toPlainText } from '@strk20/protocol/amount'
import { LAUNCH_OP, buyPayload } from '@strk20/protocol/launch-calldata'

import { useSession } from '@/app/session'
import { Amount } from '@/components/money/amount'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { formatWei } from '@/lib/format'
import { sendProblem, sendTransactionHash, usePipeline, useSend } from '@/mutations'
import { appContracts, shieldedBalanceQuery } from '@/queries'
import { addStoredPosition } from '@/queries/positions'
import { quoteBuyQuery, useStakeToken } from './queries'

function sameToken(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

export function BuyPanel({ launch, onDone }: { launch: OnChainLaunch; onDone?: () => void }) {
  const session = useSession()
  const ready = session.status === 'ready' && session.address && session.accountKey ? session : null
  const stake = useStakeToken(launch.stakeToken)
  const balance = useQuery(shieldedBalanceQuery(ready?.address, ready?.accountKey))
  // Tri-state: not read / walk unreachable → null (em dash, no blocker); walked → the sum, 0n with no note.
  const held =
    balance.data === undefined || balance.data.presence === 'unknown'
      ? null
      : (balance.data.tokens.find((t) => sameToken(t.token, launch.stakeToken))?.wei ?? 0n)
  // An unlisted stake token has no verified scale: text falls back to raw units, never a guessed 18.
  const plain = (wei: bigint) => (stake.decimals === null ? formatWei(wei, null) : toPlainText(wei, stake.decimals))
  const pipeline = usePipeline()
  const send = useSend()

  const [unitsRaw, setUnitsRaw] = useState('1')
  const [review, setReview] = useState(false)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
  const units = /^\d+$/.test(unitsRaw.trim()) ? Number(unitsRaw.trim()) : null
  const remaining = launch.epochs * UNITS_PER_EPOCH - launch.sold
  const quote = useQuery(quoteBuyQuery(launch.id, units))
  const cost = quote.data !== undefined ? BigInt(quote.data) : null
  const contract = appContracts().launch

  const blocker =
    (!contract ? 'The Launch deployment is missing from this build' : null) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (units === null || units <= 0 ? 'Enter a whole number of units — units do not divide' : null) ??
    (units !== null && units > remaining ? `Only ${remaining} units remain on this curve` : null) ??
    (quote.isPending ? 'Getting the price' : null) ??
    (cost === null ? 'The price could not be read' : null) ??
    (held !== null && cost !== null && cost > held ? `Not enough shielded ${stake.symbol}` : null) ??
    (pipeline && pipeline.terminal === null ? 'Another transaction is still running' : null)

  const step = (delta: number) => setUnitsRaw(String(Math.max(1, (units ?? 0) + delta)))

  const confirm = async (sponsored: boolean) => {
    if (!contract || units === null || cost === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    const payload = buyPayload([{ launchId: launch.id, units, commitment: minted.commitment }])
    if (payload.state === 'refused') {
      refuse(payload.because)
      return
    }
    // The secret IS the claim on these units: stored before the send so a landed-but-unreported
    // transaction never leaves a position with no way back out.
    await addStoredPosition({
      venue: 'launch',
      kind: 'launch-buy',
      id: launch.id,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `${units} unit${units === 1 ? '' : 's'} of ${launch.symbol || launch.name} · ${plain(cost)} ${stake.symbol}`,
    })
    const outcome = await send.mutateAsync({
      kind: 'launch-buy',
      sponsored,
      recipient: contract,
      token: launch.stakeToken,
      symbol: stake.symbol,
      amount: cost,
      app: { contract, op: LAUNCH_OP.buy, calldata: payload.calldata, noteIdSlots: [], openNoteCount: 0 },
    })
    if (!outcome.ok) {
      refuse(sendProblem(outcome) ?? 'The buy did not go through.', sendTransactionHash(outcome))
      return
    }
    notify.settled('Bought', {
      description: 'If the raise misses, you reclaim in full. The claim secret is stored in this browser.',
      hash: sendTransactionHash(outcome),
    })
    setReview(false)
    onDone?.()
  }

  const unitsLabel = units !== null && units > 0 ? `${units} unit${units === 1 ? '' : 's'}` : 'units'

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <div className="flex items-baseline justify-between">
          <FieldLabel htmlFor="launch-units">Units</FieldLabel>
          <span className="font-mono text-mono text-muted-foreground">{remaining} remaining on the curve</span>
        </div>
        <InputGroup className="h-12">
          <InputGroupAddon align="inline-start">
            <InputGroupButton onClick={() => step(-1)} aria-label="One unit fewer">
              <Minus />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput
            id="launch-units"
            value={unitsRaw}
            onChange={(e) => setUnitsRaw(e.target.value)}
            inputMode="numeric"
            className="h-full text-center font-mono text-display4 tabular-nums"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={() => step(1)} aria-label="One unit more">
              <Plus />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      <MoneyField
        label="You pay"
        value={cost !== null ? plain(cost) : ''}
        onChange={() => undefined}
        symbol={stake.symbol}
        decimals={stake.decimals}
        available={held}
        boundary="shielded"
        problem={held !== null && cost !== null && cost > held ? `Not enough shielded ${stake.symbol}` : null}
      />

      <dl className="flex flex-col gap-1 text-body4">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">You receive at graduation</dt>
          <dd className="font-mono text-settled">
            {units !== null && units > 0 ? <Amount wei={launch.unitTokens * BigInt(units)} decimals={18} symbol={launch.symbol || 'tokens'} size="sm" /> : '—'}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">If the raise misses</dt>
          <dd>full refund, reclaimed by you</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">Epoch</dt>
          <dd className="font-mono">
            {currentEpoch(launch) + 1} of {launch.epochs}
          </dd>
        </div>
      </dl>
      <p className="text-body4 text-muted-foreground">{LAUNCH_IDENTITY}</p>

      <Button
        size="lg"
        aria-disabled={Boolean(blocker) || undefined}
        onClick={() => {
          if (blocker) notify.noted(blocker)
          else {
            clearRefusal()
            setReview(true)
          }
        }}
      >
        {blocker ?? `Buy ${unitsLabel}`}
      </Button>

      <ReviewSheet
        open={review}
        onOpenChange={setReview}
        title="Review buy"
        description={`${launch.name || launch.symbol} · epoch ${currentEpoch(launch) + 1} of ${launch.epochs} — same price for everyone inside it.`}
        boundary="bearer"
        rows={[
          { label: 'Units', value: unitsLabel },
          { label: 'You pay (shielded)', value: cost !== null ? `${formatWei(cost, stake.decimals)} ${stake.symbol}` : '—' },
          { label: 'At graduation', value: units ? `${formatWei(launch.unitTokens * BigInt(units), 18)} ${launch.symbol}` : '—' },
        ]}
        disclosure={disclosureFor('launch-buy')}
        confirmLabel={`Buy ${unitsLabel}`}
        sponsor={{ kind: 'eligible' }}
        onConfirm={(sponsored) => void confirm(sponsored)}
        busy={send.isPending}
        blocker={send.isPending ? null : blocker}
        problem={send.isPending ? null : refusal}
      />
    </div>
  )
}
