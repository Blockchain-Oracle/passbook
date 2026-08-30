import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { strikeDisplay } from '@strk20/protocol/app-reads'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { MARKET_OP, createPayload } from '@strk20/protocol/market-calldata'
import { PRAGMA_PAIRS, PRAGMA_PAIR_LIST, formatPrice, type PragmaPair } from '@strk20/protocol/pragma-pairs'
import type { WirePrice } from '@strk20/protocol/chain-feed-wire'

import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatWei } from '@/lib/format'
import { sendProblem, sendTransactionHash, useSend } from '@/mutations'
import { appContracts, poolConstantsQuery } from '@/queries'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'
import { useStrkStake } from './use-stake'

const WINDOWS = [
  { label: '1 hour', seconds: 3_600, experimental: false },
  { label: '6 hours', seconds: 6 * 3_600, experimental: false },
  { label: '24 hours', seconds: 24 * 3_600, experimental: false },
  { label: '3 days', seconds: 3 * 24 * 3_600, experimental: false },
  { label: '15 minutes — experimental', seconds: 15 * 60, experimental: true },
] as const

const SEED_NOTE = 'A market opens with liquidity: the seed is your own bearer position and comes back with the pot.'

export interface CreateMarketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prices: Readonly<Record<string, WirePrice>>
}

/** Pair, strike, window and a shielded STRK seed → one `market-create` send. */
export function CreateMarketDialog({ open, onOpenChange, prices }: CreateMarketDialogProps) {
  const [pair, setPair] = useState<PragmaPair>('BTC/USD')
  const [strike, setStrike] = useState('')
  const [windowIdx, setWindowIdx] = useState('2')
  const [seed, setSeed] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const stake = useStrkStake()
  const fee = useQuery(poolConstantsQuery())
  const send = useSend()
  const contract = appContracts().markets

  const chosen = WINDOWS[Number(windowIdx)] ?? WINDOWS[2]
  const parsedSeed = parseAmountInput(seed, stake.decimals)
  const short = insufficient(parsedSeed.wei, stake.available)
  const strikeNumber = Number(strike)
  const strike8dp = Number.isFinite(strikeNumber) && strikeNumber > 0 ? BigInt(Math.round(strikeNumber * 1e8)) : 0n
  const spot = prices[pair]

  const blocker = !contract
    ? 'The Markets deployment is missing from this build'
    : !stake.sessionReady
      ? 'This browser has no account yet'
      : strike8dp === 0n
        ? 'Enter a strike price'
        : parsedSeed.problem
          ? parsedSeed.problem
          : parsedSeed.wei === null || parsedSeed.wei === 0n
            ? 'Enter a seed — a market opens with liquidity'
            : short
              ? 'Not enough shielded STRK'
              : null

  const confirm = async () => {
    if (!contract || parsedSeed.wei === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    const payload = createPayload({
      pairId: PRAGMA_PAIRS[pair],
      strike: strike8dp,
      deadline: Math.floor(Date.now() / 1000) + chosen.seconds,
      token: stake.token,
      seed: parsedSeed.wei,
      seederCommitment: minted.commitment,
      experimental: chosen.experimental,
    })
    if (payload.state === 'refused') {
      notify.refused(payload.because)
      return
    }
    // `-1`: the chain assigns the id; the position read names the market afterwards.
    await addStoredPosition({
      venue: 'market',
      kind: 'market-seed',
      id: -1,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `Seeded ${pair} above $${strikeDisplay(strike8dp)} · ${toPlainText(parsedSeed.wei, stake.decimals ?? 18)} STRK`,
    })
    const result = await send.mutateAsync({
      kind: 'market-create',
      recipient: contract,
      token: stake.token,
      symbol: stake.symbol,
      amount: parsedSeed.wei,
      surface: 'markets',
      app: { contract, op: MARKET_OP.create, calldata: [...payload.calldata], noteIdSlots: [...payload.noteIdSlots], openNoteCount: 0 },
    })
    if (result.ok) {
      await relabelStoredPosition(minted.commitment, { txHash: result.transactionHash })
      notify.settled('Market open', { description: 'The first bet in it sets the odds.', hash: sendTransactionHash(result) })
      setReviewing(false)
      onOpenChange(false)
      setStrike('')
      setSeed('')
      return
    }
    const mayHaveLanded = result.failure.kind === 'confirmation-unknown' || 'transactionHash' in result.failure
    if (!mayHaveLanded) await removeStoredPosition(minted.commitment)
    notify.refused('The market could not be opened.', { description: sendProblem(result) ?? undefined, hash: sendTransactionHash(result) })
  }

  // Live from `readPoolConstants` — the fee is never a constant here.
  const feeText = fee.data ? `${formatWei(fee.data.feeWei, 18)} STRK` : null
  const feeLine = feeText ? `Pool fee ${feeText}, paid by the embedded account on top of the seed.` : 'Reading the pool fee…'

  return (
    <>
      <Dialog open={open && !reviewing} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <BoundaryBadge kind="bearer" className="w-fit" />
            <DialogTitle className="font-display text-display3 uppercase">Open a market</DialogTitle>
            <DialogDescription>{SEED_NOTE}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Pair</FieldLabel>
                <Select value={pair} onValueChange={(v) => v && setPair(v as PragmaPair)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRAGMA_PAIR_LIST.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Closes in</FieldLabel>
                <Select value={windowIdx} onValueChange={(v) => v && setWindowIdx(String(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOWS.map((w, i) => (
                      <SelectItem key={w.label} value={String(i)}>
                        {w.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <div className="flex items-baseline justify-between">
                <FieldLabel htmlFor="market-strike">Strike (USD)</FieldLabel>
                <span className="text-body4 text-muted-foreground">Now {spot ? `$${formatPrice(spot.price)}` : '—'}</span>
              </div>
              <Input id="market-strike" inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="0.00" className="font-mono" />
            </Field>
            <MoneyField
              label="Seed"
              value={seed}
              onChange={setSeed}
              symbol="STRK"
              decimals={stake.decimals}
              available={stake.available}
              boundary="shielded"
              onMax={stake.available !== null && stake.decimals !== null ? () => setSeed(toPlainText(stake.available!, stake.decimals!)) : undefined}
              problem={parsedSeed.problem ?? (short ? 'Not enough shielded STRK' : null)}
            />
            <p className="text-body4 text-muted-foreground">{feeLine}</p>
          </div>
          <DialogFooter>
            <Button
              size="lg"
              aria-disabled={blocker !== null || undefined}
              onClick={() => {
                if (blocker === null) setReviewing(true)
              }}
            >
              {blocker ?? 'Review the market'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewSheet
        open={open && reviewing}
        onOpenChange={(next) => {
          if (!next) setReviewing(false)
        }}
        title="Open a market"
        description={`${pair} above $${strikeDisplay(strike8dp)}`}
        boundary="bearer"
        rows={[
          { label: 'Pair', value: pair },
          { label: 'Strike', value: `$${strikeDisplay(strike8dp)}` },
          { label: 'Closes in', value: chosen.label },
          { label: 'Seed', value: <Amount wei={parsedSeed.wei} decimals={stake.decimals} symbol="STRK" size="sm" /> },
          { label: 'Pool fee', value: feeText ?? '—' },
        ]}
        disclosure={disclosureFor('markets-bet')}
        confirmLabel={`Seed ${pair} · ${parsedSeed.wei !== null && stake.decimals !== null ? toPlainText(parsedSeed.wei, stake.decimals) : seed} STRK`}
        onConfirm={() => void confirm()}
        busy={send.isPending}
        blocker={blocker}
      />
    </>
  )
}
