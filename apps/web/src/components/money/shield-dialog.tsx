import { useState } from 'react'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import type { Disclosure } from '@strk20/protocol/disclosure'
import { AUDITOR_ESCROW, NOTES_STAY, SELF_SUBMIT_NO_RELAYER } from '@strk20/protocol/disclosure-copy'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
// Type-only: nothing from mutations loads into this component.
import type { ShieldAsk } from '@/mutations/use-shield'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  /** Live pool fee from `readPoolConstants` — never a constant. `null` while reading. */
  feeWei?: bigint | null
  /** The shield mutation. The dialog only collects the ask. */
  onShield: (ask: ShieldAsk) => void
  busy?: boolean
  /** The mutation's last failure, in the caller's words. */
  problem?: string | null
}

const SHIELD_BODY =
  'The embedded Passbook account deposits its own public funds and creates one encrypted note back to itself. A connected wallet cannot shield on its behalf.'
const SHIELD_WARNING =
  'This deposit is public: the Passbook address, token and amount are visible on Starknet. Privacy begins with the encrypted note created inside the pool.'

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
export function ShieldDialog({
  open,
  onOpenChange,
  token,
  symbol,
  decimals,
  logoUri,
  publicWei,
  publicStrkWei,
  feeWei,
  onShield,
  busy = false,
  problem,
}: ShieldDialogProps) {
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const parsed = parseAmountInput(raw, decimals)
  const short = insufficient(parsed.wei, publicWei)

  const blocker =
    publicWei === null
      ? `Public ${symbol} could not be read`
      : publicStrkWei === null
        ? 'Public STRK could not be read'
        : parsed.problem
          ? parsed.problem
          : parsed.wei === null || parsed.wei === 0n
            ? 'Enter an amount'
            : short
              ? `Not enough public ${symbol}`
              : feeWei === null || feeWei === undefined
                ? 'Reading the pool fee'
                : null

  const confirm = () => {
    if (parsed.wei === null || publicWei === null || publicStrkWei === null) return
    onShield({ token, symbol, amount: parsed.wei, publicTokenWei: publicWei, publicStrkWei })
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="publicEntry" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Shield {symbol}</DialogTitle>
            <DialogDescription>{SHIELD_BODY}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <AssetIdentity symbol={symbol} logoUri={logoUri} boundary="public" />
            <MoneyField
              value={raw}
              onChange={setRaw}
              symbol={symbol}
              decimals={decimals}
              available={publicWei}
              boundary="public"
              onMax={publicWei !== null && decimals !== null ? () => setRaw(toPlainText(publicWei, decimals)) : undefined}
              problem={parsed.problem ?? (short ? `Not enough public ${symbol}` : null)}
              autoFocus
            />
            <p className="rounded-lg border border-dashed border-public bg-publicTint px-3 py-2 text-body4">{SHIELD_WARNING}</p>
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
          { label: 'Submitted by', value: 'Embedded Passbook account' },
        ]}
        disclosure={SHIELD_DISCLOSURE}
        confirmLabel={`Shield ${symbol}`}
        onConfirm={confirm}
        busy={busy}
        blocker={busy ? null : blocker}
      />
    </>
  )
}
