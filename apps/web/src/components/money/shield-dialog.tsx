import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import type { Disclosure } from '@strk20/protocol/disclosure'
import { AUDITOR_ESCROW, NOTES_STAY, SELF_SUBMIT_NO_RELAYER } from '@strk20/protocol/disclosure-copy'
import { expectedGasWei, gasBoundWei, resourceBoundsFor } from '@strk20/protocol/fee-ceiling'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { usePipeline } from '@/mutations/pipeline-store'
// Type-only: nothing from mutations loads into this component.
import type { ShieldAsk } from '@/mutations/use-shield'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatWei } from '@/lib/format'
import { measuredGasQuery, poolConstantsQuery } from '@/queries'

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

const SHIELD_BODY = 'Your strk20.run account deposits its own public funds into the pool as one encrypted note back to itself.'
const SHIELD_WARNING =
  'This deposit is public: the strk20.run address, token and amount are visible on Starknet. Privacy begins with the encrypted note created inside the pool.'
const COST_NOTE =
  'The pool fee is charged by the privacy pool contract on every transaction — read from the contract now, not set by strk20.run. Gas is Starknet’s network fee, priced from the latest block; the held amount is a ceiling and only what is used is charged.'

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
  // Measured units where the relayer has them; `undefined` falls back to the constant in
  // `fee-ceiling.ts`, so an unreachable relayer costs accuracy and never a blocked shield.
  const measured = useQuery(measuredGasQuery()).data ?? undefined
  const feeWei = pool.data?.feeWei ?? (pool.isError ? null : undefined)
  // `gasPrices` is checked, not assumed: a cached read from before this field existed must render `—`, not throw.
  const prices = pool.data?.gasPrices
  const gasWei = prices ? gasBoundWei(resourceBoundsFor(prices, measured)) : pool.isError ? null : undefined
  // TWO GAS NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. `gasWei` is the bound — what must be
  // HELD for the mempool to take the transaction. `expectedWei` is what it will actually be
  // charged. The floor uses the bound; the "what will this leave me" arithmetic uses the expected,
  // because a user is left with what they spent, not with what they had to prove they could spend.
  const expectedWei = prices ? expectedGasWei(prices, measured) : null
  const floorWei = feeWei && gasWei ? feeWei + gasWei : null

  // Fee + gas come out of public STRK, so an STRK shield can only spend what is left above them.
  //
  // ── ONE FLOOR, NOT TWO, AND WHY THAT REVERSES AN EARLIER FIX ──────────────────────────────
  //
  // This reserved TWO floors, and the incident behind that was real: on mainnet 2026-08-29, with
  // one floor reserved, 20.22 public offered a max of 8.28, the shield's own fee and gas then spent
  // the reserved floor, 2.92 was left, and every following bet was refused. Shielded value is
  // unspendable without public STRK to pay for spending it. The conclusion drawn was "one floor for
  // this transaction, one for the next".
  //
  // THE PREMISE OF THAT SECOND FLOOR WAS THAT THE NEXT TRANSACTION IS SELF-PAID. It is not any
  // more: the next three go through the relayer, which pays their pool fee and needs nothing public
  // from the holder at all. Reserving for them charges a user twice for a bill nobody sends — and
  // it charges them hard, because two floors is ~23.5 STRK, so an account holding 20 was offered
  // nothing and the door simply did not open.
  //
  // So the reserve is one floor and the shortfall is a SENTENCE rather than a locked door: below
  // it, `leaves` says what will be left and what that means. Abu's ruling, and the general rule
  // this file was the worst offender against — warn, name the numbers, let them decide.
  const tokenIsStrk = BigInt(token) === BigInt(STRK_TOKEN)
  const reserveWei = floorWei
  const shieldable =
    tokenIsStrk && publicWei !== null && reserveWei !== null ? (publicWei > reserveWei ? publicWei - reserveWei : 0n) : publicWei
  const starved = tokenIsStrk && shieldable === 0n
  const short = starved || insufficient(parsed.wei, shieldable)
  const strkShort = !tokenIsStrk && publicStrkWei !== null && reserveWei !== null && publicStrkWei < reserveWei

  // What this shield leaves behind, and whether that is enough to self-pay the NEXT one. Not a
  // blocker — the sponsored transactions cover what comes next, and a user who wants to shield
  // deep and lean on them is making a reasonable choice we should not overrule.
  const spentByShield = feeWei !== null && feeWei !== undefined && expectedWei ? feeWei + expectedWei : null
  const leftAfterWei =
    tokenIsStrk && publicWei !== null && parsed.wei !== null && spentByShield !== null
      ? publicWei - parsed.wei - spentByShield
      : null
  const leavesThin = leftAfterWei !== null && floorWei !== null && leftAfterWei < floorWei && !short

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
  // Every sentence quotes the RESERVE, and the reserve is now one floor — this shield's own fee
  // and gas. The number shown has to be the number enforced.
  //
  // `leavesThin` is the one that is NOT a refusal: the amount is affordable, it just spends down to
  // where the next SELF-PAID transaction could not be afforded. Sponsored ones are unaffected, so
  // it names what is left and what it does not cover, and the button stays live.
  const explain =
    reserveWei === null
      ? null
      : starved
        ? `This shield needs ${formatWei(reserveWei, 18, 2)} STRK for its fee and gas; this address holds ${formatWei(publicWei ?? 0n, 18, 4)}. Receive STRK here first.`
        : strkShort
          ? `This shield needs ${formatWei(reserveWei, 18, 2)} public STRK here for its fee and gas; it holds ${formatWei(publicStrkWei ?? 0n, 18, 4)}.`
          : short && tokenIsStrk
            ? `Keep ${formatWei(reserveWei, 18, 2)} STRK back for this shield's own fee and gas. Up to ${formatWei(shieldable ?? 0n, 18, 4)} STRK can be shielded.`
            : leavesThin
              ? `This leaves about ${formatWei(leftAfterWei ?? 0n, 18, 2)} public STRK — under the ${formatWei(floorWei ?? 0n, 18, 2)} a transaction you pay for yourself has to hold. The transactions we cover are unaffected; past those, top this address up.`
              : null

  const confirm = () => {
    if (parsed.wei === null || publicWei === null || publicStrkWei === null) return
    onShield({ token, symbol, amount: parsed.wei, publicTokenWei: publicWei, publicStrkWei, ...(measured ? { measuredGas: measured } : {}) })
  }

  // TWO NUMBERS, BECAUSE THEY ARE DIFFERENT KINDS OF NUMBER. The pool fee above is exact — read
  // from `get_fee_amount` at render. Gas is an estimate with a padded ceiling behind it, and only
  // what is used gets charged. Showing one blended figure and calling it gas was wrong twice over:
  // most of it is not gas, and the part that is gas is not the ceiling.
  const gasLabel =
    expectedWei && gasWei
      ? `~${formatWei(expectedWei, 18, 2)} expected, ${formatWei(gasWei, 18, 2)} held`
      : '—'

  // Only the CTA's stage word is read here now — `ReviewSheet` draws the ladder itself for every venue.
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
              <span>Gas {gasLabel}</span>
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
            {/* Tone follows consequence: a refusal is irreversible-red, a caution is exposed-yellow.
                Painting the caution red would make "this leaves you thin" look like "this is not
                allowed", which is the confusion the whole change exists to remove. */}
            {explain ? (
              <p
                role="alert"
                className={
                  leavesThin
                    ? 'rounded-lg border border-exposed/40 bg-exposedTint px-3 py-2 text-body4 text-exposed'
                    : 'rounded-lg border border-irreversible/40 bg-irreversibleTint px-3 py-2 text-body4 text-irreversible'
                }
              >
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
          // The last screen before signing says which number is exact and which is not.
          { label: 'Pool fee (exact)', value: <Amount wei={feeWei} decimals={18} symbol="STRK" /> },
          { label: 'Gas (estimated)', value: gasLabel },
          { label: 'Submitted by', value: 'Embedded strk20.run account' },
        ]}
        disclosure={SHIELD_DISCLOSURE}
        confirmLabel={`Shield ${symbol}`}
        onConfirm={confirm}
        busy={busy}
        blocker={busy ? (stage ? STAGE_TITLES[stage] : null) : blocker}
        problem={problem}
      >
      </ReviewSheet>
    </>
  )
}
