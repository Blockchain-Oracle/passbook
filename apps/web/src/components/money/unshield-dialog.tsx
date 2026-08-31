import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { usePipeline } from '@/mutations/pipeline-store'
// Type-only: nothing from mutations loads into this component.
import type { SendAsk } from '@/mutations/use-send'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { shortAddress } from '@/lib/format'
import { poolConstantsQuery } from '@/queries'

export interface UnshieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  symbol: string
  decimals: number | null
  logoUri?: string | null
  /** Pool notes for this token. `null` = the walk did not land; the CTA explains rather than disables. */
  shieldedWei: bigint | null
  /** Where it lands: this account's own public address. Unshielding is a round trip, not a payment. */
  address: string | undefined
  /** The send mutation. The dialog only collects the ask. */
  onUnshield: (ask: SendAsk) => void
  busy?: boolean
  /** The mutation's last failure, in the caller's words. */
  problem?: string | null
}

const UNSHIELD_BODY =
  'Your shielded notes pay out to your own public Starknet address — the same door you shielded through, in the other direction.'
const UNSHIELD_WARNING =
  'This withdrawal is public: the receiving address, token and amount are written on Starknet. Which note paid for it is not.'
const COST_NOTE =
  'The pool fee is charged by the privacy pool contract on every transaction — read from the contract now, not set by strk20.run. It comes out of your shielded balance, so a withdrawal spends the amount plus the fee.'

/**
 * Shielded → public. The mirror of `ShieldDialog`, and deliberately the same shape: same dialog,
 * same amount field, same cost line, same review sheet. Shielding and unshielding are one round
 * trip, so they must not be two different kinds of screen — one a dialog and the other a page with
 * a destination toggle, which is what this replaces.
 *
 * The recipient is fixed to the account's own address. Paying SOMEONE ELSE out to a public address
 * is a send, and `/send` is where that lives; folding both into one form is what made unshielding
 * ask a question ("where does this land?") that unshielding does not have.
 */
export function UnshieldDialog({
  open,
  onOpenChange,
  token,
  symbol,
  decimals,
  logoUri,
  shieldedWei,
  address,
  onUnshield,
  busy = false,
  problem,
}: UnshieldDialogProps) {
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const parsed = parseAmountInput(raw, decimals)

  // The live pool fee, read the same way the shield dialog reads it.
  const pool = useQuery(poolConstantsQuery())
  const feeWei = pool.data?.feeWei ?? (pool.isError ? null : undefined)
  const short = insufficient(parsed.wei, shieldedWei)

  const blocker =
    address === undefined
      ? 'This browser has no account yet'
      : shieldedWei === null
        ? `Shielded ${symbol} unreadable`
        : decimals === null
          ? `${symbol} has an unverified scale`
          : parsed.problem
            ? parsed.problem
            : parsed.wei === null || parsed.wei === 0n
              ? 'Enter an amount'
              : short
                ? `Not enough shielded ${symbol}`
                : null

  const confirm = () => {
    if (parsed.wei === null || address === undefined) return
    onUnshield({
      kind: 'withdraw',
      recipient: address,
      token,
      symbol,
      amount: parsed.wei,
      label: `Unshield ${symbol}`,
    })
  }

  const pipeline = usePipeline()
  const running = busy && pipeline?.operation === 'withdraw' ? pipeline : null
  const stage = running?.reached.at(-1)

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="publicExit" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Unshield {symbol}</DialogTitle>
            <DialogDescription>{UNSHIELD_BODY}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <AssetIdentity symbol={symbol} logoUri={logoUri} boundary="shielded" />
            <MoneyField
              value={raw}
              onChange={setRaw}
              symbol={symbol}
              decimals={decimals}
              available={shieldedWei}
              boundary="shielded"
              onMax={shieldedWei !== null && decimals !== null ? () => setRaw(toPlainText(shieldedWei, decimals)) : undefined}
              problem={parsed.problem ?? (short ? `Not enough shielded ${symbol}` : null)}
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body4 text-muted-foreground">
              <span>
                Pool fee <Amount wei={feeWei} decimals={18} symbol="STRK" size="sm" />
              </span>
              <span>Lands at {address ? shortAddress(address, 6, 4) : '—'}</span>
              <Popover>
                <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label="What the pool fee is" />}>
                  <Info />
                </PopoverTrigger>
                <PopoverContent className="max-w-xs text-body4">{COST_NOTE}</PopoverContent>
              </Popover>
            </div>
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
              {blocker ?? 'Review and unshield'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false)
        }}
        title={`Unshield ${symbol}`}
        description={UNSHIELD_WARNING}
        boundary="publicExit"
        rows={[
          { label: 'Amount', value: <Amount wei={parsed.wei} decimals={decimals} symbol={symbol} /> },
          { label: 'From', value: `Shielded ${symbol}` },
          { label: 'Lands as', value: `Public ${symbol}` },
          { label: 'To', value: address ? shortAddress(address, 10, 6) : '—' },
          { label: 'Pool fee', value: <Amount wei={feeWei} decimals={18} symbol="STRK" /> },
        ]}
        disclosure={disclosureFor('unshield')}
        confirmLabel={`Unshield ${symbol}`}
        onConfirm={confirm}
        busy={busy}
        blocker={busy ? (stage ? STAGE_TITLES[stage] : null) : blocker}
        problem={problem}
      />
    </>
  )
}
