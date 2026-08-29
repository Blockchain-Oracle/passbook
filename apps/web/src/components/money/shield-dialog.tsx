import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import type { Disclosure } from '@strk20/protocol/disclosure'
import { AUDITOR_ESCROW, NOTES_STAY, SELF_SUBMIT_NO_RELAYER } from '@strk20/protocol/disclosure-copy'
import { gasBoundWei, resourceBoundsFor } from '@strk20/protocol/fee-ceiling'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { ReviewSheet } from '@/components/money/review-sheet'
import { usePipeline } from '@/mutations/pipeline-store'
// Type-only: nothing from mutations loads into this component.
import type { ShieldAsk } from '@/mutations/use-shield'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatWei } from '@/lib/format'
import { poolConstantsQuery } from '@/queries'

// The mutation's own ask, so `onShield={shield.mutate}` needs no adapter.
export type { ShieldAsk }

export interface ShieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  symbol: string
  decimals: number | null
  logoUri?: string | null
  /** Public balances read by the caller. `null` = unreadable; the CTA explains rather than disables. */
  publicWei: bigint | null
  publicStrkWei: bigint | null
  /** The shield mutation. The dialog only collects the ask. */
  onShield: (ask: ShieldAsk) => void
  busy?: boolean
  /** The mutation's last failure, in the caller's words. */
  problem?: string | null
}

const SHIELD_BODY = 'Your Passbook account deposits its own public funds into the pool as one encrypted note back to itself.'
const SHIELD_WARNING =
  'This deposit is public: the Passbook address, token and amount are visible on Starknet. Privacy begins with the encrypted note created inside the pool.'
const COST_NOTE =
  'The pool fee is charged by the privacy pool contract on every transaction — read from the contract now, not set by Passbook. Gas is Starknet’s network fee, priced from the latest block; the held amount is a ceiling and only what is used is charged.'

/**
 * The shield review's disclosure. The protocol has no `shield` VisibilityContext yet, so this is
 * authored from its recurring sentences under the nearest honest context: a shield IS a
 * self-submitted pool action (no relayer, the depositor's own address on the transaction).
 */
const SHIELD_DISCLOSURE: Disclosure = {
  authored: true,
  context: 'self-submit',
  lines: [
    { text: SHIELD_WARNING, marker: 'leaves', severity: 'medium' },
    { text: NOTES_STAY, marker: 'stays', severity: 'low' },
    { text: SELF_SUBMIT_NO_RELAYER, marker: 'leaves', severity: 'low' },
    { text: AUDITOR_ESCROW, marker: 'leaves', severity: 'low' },
  ],
  wayOut: null,
}

/** Public → shielded. Amount in a Dialog, then the ReviewSheet; the caller owns the mutation. */
export function ShieldDialog({ open, onOpenChange, token, symbol, decimals, logoUri, publicWei, publicStrkWei, onShield, busy = false, problem }: ShieldDialogProps) {
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const parsed = parseAmountInput(raw, decimals)

  // Fee and gas from one live read, the same numbers `planShield` will enforce.
  const pool = useQuery(poolConstantsQuery())
  const feeWei = pool.data?.feeWei ?? (pool.isError ? null : undefined)
  // `gasPrices` is checked, not assumed: a cached read from before this field existed must render `—`, not throw.
  const prices = pool.data?.gasPrices
  const gasWei = prices ? gasBoundWei(resourceBoundsFor(prices)) : pool.isError ? null : undefined
  const floorWei = feeWei && gasWei ? feeWei + gasWei : null

  // Fee + gas come out of public STRK, so an STRK shield can only spend what is left above them.
  const tokenIsStrk = BigInt(token) === BigInt(STRK_TOKEN)
  const shieldable =
    tokenIsStrk && publicWei !== null && floorWei !== null ? (publicWei > floorWei ? publicWei - floorWei : 0n) : publicWei
  const starved = tokenIsStrk && shieldable === 0n
  const short = starved || insufficient(parsed.wei, shieldable)
  const strkShort = !tokenIsStrk && publicStrkWei !== null && floorWei !== null && publicStrkWei < floorWei

  // The CTA carries a few words; the sentence goes in the alert under the field.
  const blocker =
    publicWei === null
      ? `Public ${symbol} unreadable`
      : publicStrkWei === null
        ? 'Public STRK unreadable'
        : parsed.problem
          ? parsed.problem
          : floorWei === null
            ? 'Reading fee and gas'
            : starved || strkShort
              ? 'Not enough STRK'
              : parsed.wei === null || parsed.wei === 0n
                ? 'Enter an amount'
                : short
                  ? `Not enough ${symbol}`
                  : null
  const explain =
    floorWei === null
      ? null
      : starved
        ? `Fee and gas need ${formatWei(floorWei, 18, 2)} STRK on top of the amount; this address holds ${formatWei(publicWei ?? 0n, 18, 4)}. Receive STRK here first.`
        : strkShort
          ? `Fee and gas need ${formatWei(floorWei, 18, 2)} public STRK here; it holds ${formatWei(publicStrkWei ?? 0n, 18, 4)}.`
          : short && tokenIsStrk
            ? `Keep ${formatWei(floorWei, 18, 2)} STRK for fee and gas — up to ${formatWei(shieldable ?? 0n, 18, 4)} STRK can be shielded.`
            : null

  const confirm = () => {
    if (parsed.wei === null || publicWei === null || publicStrkWei === null) return
    onShield({ token, symbol, amount: parsed.wei, publicTokenWei: publicWei, publicStrkWei })
  }

  const gasLabel = gasWei ? `up to ${formatWei(gasWei, 18, 2)} STRK` : '—'

  // The running shield's ladder, so the sheet narrates prove / sign / accept instead of spinning.
  const pipeline = usePipeline()
  const running = busy && pipeline?.operation === 'shield' ? pipeline : null
  const stage = running?.reached.at(-1)

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="publicEntry" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Shield {symbol}</DialogTitle>
            <DialogDescription>{SHIELD_BODY}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <AssetIdentity symbol={symbol} logoUri={logoUri} boundary="public" />
            <MoneyField
              value={raw}
              onChange={setRaw}
              symbol={symbol}
              decimals={decimals}
              available={publicWei}
              boundary="public"
              onMax={shieldable !== null && decimals !== null ? () => setRaw(toPlainText(shieldable, decimals)) : undefined}
              problem={parsed.problem ?? (short ? `Not enough ${symbol}` : null)}
              autoFocus
            />
            {/* One line of cost; the explanation is a tap away, not a paragraph in the way. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body4 text-muted-foreground">
              <span>
                Pool fee <Amount wei={feeWei} decimals={18} symbol="STRK" size="sm" />
              </span>
              <span>Gas held {gasLabel}</span>
              {tokenIsStrk ? (
                <span>
                  Shieldable <Amount wei={shieldable} decimals={decimals} symbol="STRK" size="sm" />
                </span>
              ) : null}
              <Popover>
                <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="What the fee and gas are" />}>
                  <Info />
                </PopoverTrigger>
                <PopoverContent className="max-w-xs text-body4">{COST_NOTE}</PopoverContent>
              </Popover>
            </div>
            {explain ? (
              <p role="alert" className="rounded-lg border border-irreversible/40 bg-irreversibleTint px-3 py-2 text-body4 text-irreversible">
                {explain}
              </p>
            ) : null}
            {problem ? (
              <p role="alert" className="text-body4 text-irreversible">
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              size="lg"
              aria-disabled={blocker !== null || undefined}
              onClick={() => {
                if (blocker === null) setReviewing(true)
              }}
            >
              {blocker ?? 'Review and shield'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false)
        }}
        title={`Shield ${symbol}`}
        description={SHIELD_WARNING}
        boundary="publicEntry"
        rows={[
          { label: 'Amount', value: <Amount wei={parsed.wei} decimals={decimals} symbol={symbol} /> },
          { label: 'From', value: `Public ${symbol}` },
          { label: 'To', value: 'One shielded note to yourself' },
          { label: 'Pool fee', value: <Amount wei={feeWei} decimals={18} symbol="STRK" /> },
          { label: 'Gas held', value: gasLabel },
          { label: 'Submitted by', value: 'Embedded Passbook account' },
        ]}
        disclosure={SHIELD_DISCLOSURE}
        confirmLabel={`Shield ${symbol}`}
        onConfirm={confirm}
        busy={busy}
        blocker={busy ? (stage ? STAGE_TITLES[stage] : null) : blocker}
        problem={problem}
      >
        {running ? (
          <OperationPipeline
            stages={running.stages}
            reached={running.reached}
            failedAt={running.failedAt}
            replaced={running.replaced}
            startedAt={running.startedAt}
          />
        ) : null}
      </ReviewSheet>
    </>
  )
}
