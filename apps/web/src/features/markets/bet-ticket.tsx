import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { MARKET_STATE, marketQuestion, type OnChainMarket } from '@strk20/protocol/app-reads'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { MARKET_OP, SIDE_DOWN, SIDE_UP, betPayload } from '@strk20/protocol/market-calldata'
import {
  BET_PRICE_LOCKS,
  BET_SIDE_DOWN,
  BET_SIDE_UP,
  DENOMINATION_CROWD,
  WINDOW_OPENS_ON_FIRST_BET,
  houseVigLine,
  openingStakeLine,
} from '@strk20/protocol/markets-copy'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { sendProblem, useSend } from '@/mutations'
import { appContracts } from '@/queries'
import { cn } from '@/lib/utils'
import { formatWei } from '@/lib/format'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'
import { betQuoteQuery } from './queries'
import { useStake } from './use-stake'

export interface BetTicketProps {
  market: OnChainMarket
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSide: number
}

const POSITION_OPEN_DETAIL = 'The size and transaction submitter are public. The bearer claim secret stays in this browser.'

/** Side, stake, quote, review, then one `market-bet` send. The secret is stored before submitting. */
export function BetTicket({ market, open, onOpenChange, initialSide }: BetTicketProps) {
  const [side, setSide] = useState(initialSide)
  const [raw, setRaw] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const stake = useStake(market.token)
  const send = useSend()
  const contract = appContracts().markets

  const parsed = parseAmountInput(raw, stake.decimals)
  const short = insufficient(parsed.wei, stake.available)
  const quote = useQuery(betQuoteQuery(market.id, side, parsed.wei))
  const tickets = quote.data ?? null
  const impliedPct = tickets && parsed.wei && tickets > 0n ? Number((parsed.wei * 10_000n) / tickets) / 100 : null

  // A first bet opens the window, and the contract refuses to open one for dust (seed / 100).
  const opening = market.state === MARKET_STATE.none && market.house
  const floorWei = opening ? market.seed / 100n : 0n
  const floorText = `${formatWei(floorWei, stake.decimals)} ${stake.symbol}`
  const vigPct = market.vigBps > 0 ? (market.vigBps / 100).toFixed(market.vigBps % 100 === 0 ? 0 : 2) : null

  const blocker = !contract
    ? 'The Markets deployment is missing from this build'
    : !stake.sessionReady
      ? 'This browser has no account yet'
      : parsed.problem
        ? parsed.problem
        : parsed.wei === null || parsed.wei === 0n
          ? 'Enter a stake'
          : short
            ? `Not enough shielded ${stake.symbol}`
            : parsed.wei < floorWei
              ? `At least ${floorText} to open`
              : quote.isPending
                ? 'Getting the quote'
                : quote.isError || tickets === null
                  ? 'The quote could not be read'
                  : tickets === 0n
                    ? 'This window is not taking bets'
                    : null

  const sideWord = side === SIDE_UP ? BET_SIDE_UP : BET_SIDE_DOWN
  const stakeText = parsed.wei !== null && stake.decimals !== null ? toPlainText(parsed.wei, stake.decimals) : raw

  const confirm = async () => {
    if (!contract || parsed.wei === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    const payload = betPayload([{ marketId: market.id, side, amount: parsed.wei, commitment: minted.commitment }])
    if (payload.state === 'refused') {
      toast.error(payload.because)
      return
    }
    // The secret IS the position. Written first, so a landed bet can never outrun its record.
    await addStoredPosition({
      venue: 'market',
      kind: 'market-bet',
      id: market.id,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `${sideWord} · ${marketQuestion(market)} · ${stakeText} ${stake.symbol}`,
    })
    const result = await send.mutateAsync({
      kind: 'market-bet',
      recipient: contract,
      token: market.token,
      symbol: stake.symbol,
      amount: parsed.wei,
      surface: 'markets',
      app: { contract, op: MARKET_OP.bet, calldata: [...payload.calldata], noteIdSlots: [...payload.noteIdSlots], openNoteCount: 0 },
    })
    if (result.ok) {
      await relabelStoredPosition(minted.commitment, { txHash: result.transactionHash })
      toast.success('Position open', { description: POSITION_OPEN_DETAIL })
      setReviewing(false)
      onOpenChange(false)
      setRaw('')
      return
    }
    // Nothing reached the chain → the record names a position that never existed. A hash or an
    // unknown confirmation means it may have landed, so the secret stays.
    const mayHaveLanded = result.failure.kind === 'confirmation-unknown' || 'transactionHash' in result.failure
    if (!mayHaveLanded) await removeStoredPosition(minted.commitment)
    toast.error(sendProblem(result) ?? 'The bet could not be placed.')
  }

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="bearer" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">{marketQuestion(market)}</DialogTitle>
            <DialogDescription>{BET_PRICE_LOCKS}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <ToggleGroup
              value={[String(side)]}
              onValueChange={(value) => {
                const next = value[0]
                if (next === String(SIDE_UP)) setSide(SIDE_UP)
                if (next === String(SIDE_DOWN)) setSide(SIDE_DOWN)
              }}
              variant="outline"
              className="grid grid-cols-2"
            >
              <ToggleGroupItem value={String(SIDE_UP)} className={cn('h-11', side === SIDE_UP && 'border-settled text-settled')}>
                {BET_SIDE_UP}
              </ToggleGroupItem>
              <ToggleGroupItem value={String(SIDE_DOWN)} className={cn('h-11', side === SIDE_DOWN && 'border-irreversible text-irreversible')}>
                {BET_SIDE_DOWN}
              </ToggleGroupItem>
            </ToggleGroup>
            <AssetIdentity symbol={stake.symbol} logoUri={stake.logoUri} boundary="shielded" />
            <MoneyField
              label="Stake"
              value={raw}
              onChange={setRaw}
              symbol={stake.symbol}
              decimals={stake.decimals}
              available={stake.available}
              boundary="shielded"
              onMax={stake.available !== null && stake.decimals !== null ? () => setRaw(toPlainText(stake.available!, stake.decimals!)) : undefined}
              problem={parsed.problem ?? (short ? `Not enough shielded ${stake.symbol}` : null)}
              autoFocus
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body4">
              <dt className="text-muted-foreground">Pays if right</dt>
              <dd className="text-right">
                <Amount wei={quote.isError ? null : tickets ?? undefined} decimals={stake.decimals} symbol={stake.symbol} size="sm" />
              </dd>
              <dt className="text-muted-foreground">Implied odds</dt>
              <dd className="text-right font-mono tabular-nums">{impliedPct !== null ? `${impliedPct.toFixed(1)}%` : '—'}</dd>
            </dl>
            {opening ? (
              <p className="text-body4 text-muted-foreground">
                {WINDOW_OPENS_ON_FIRST_BET} {openingStakeLine(floorText)}
              </p>
            ) : null}
            {vigPct !== null ? <p className="text-body4 text-muted-foreground">{houseVigLine(vigPct)}</p> : null}
            <p className="text-body4 text-muted-foreground">{DENOMINATION_CROWD}</p>
          </div>
          <DialogFooter>
            <Button
              size="lg"
              aria-disabled={blocker !== null || undefined}
              onClick={() => {
                if (blocker === null) setReviewing(true)
              }}
            >
              {blocker ?? `Review ${sideWord} · ${stakeText} ${stake.symbol}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false)
        }}
        title={`Back ${sideWord}`}
        description={marketQuestion(market)}
        boundary="bearer"
        rows={[
          { label: 'Side', value: sideWord },
          { label: 'Stake', value: <Amount wei={parsed.wei} decimals={stake.decimals} symbol={stake.symbol} size="sm" /> },
          { label: 'Pays if right', value: <Amount wei={tickets} decimals={stake.decimals} symbol={stake.symbol} size="sm" /> },
          { label: 'Implied odds', value: impliedPct !== null ? `${impliedPct.toFixed(1)}%` : '—' },
        ]}
        disclosure={disclosureFor('markets-bet')}
        confirmLabel={`Back ${sideWord} · ${stakeText} ${stake.symbol}`}
        onConfirm={() => void confirm()}
        busy={send.isPending}
        blocker={blocker}
      />
    </>
  )
}
