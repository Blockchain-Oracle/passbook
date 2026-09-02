// A shared market position in the thread. A claim with its evidence beside it: the card names the
// transactions, this client checks them, and the badge says what the chain said — verified, a
// mismatch, or unreachable. Even `verified` proves the bet, not the sender; the card says so.
import { useQuery } from '@tanstack/react-query'
import { ChartCandlestick, ExternalLink } from 'lucide-react'
import { SHARE_OUTCOME, SHARE_SIDE, shareQuestion, shareUnits, type PositionShare } from '@strk20/protocol/position-share'

import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { shareVerifyQuery, type ShareVerdict } from '@/queries/position-verify'

const VERDICT: Record<ShareVerdict | 'verifying', { word: string; tone: string }> = {
  verifying: { word: 'Checking the chain…', tone: 'text-muted-foreground' },
  verified: { word: 'Matches the chain', tone: 'border-settled/40 text-settled' },
  mismatch: { word: 'Does not match the chain', tone: 'border-irreversible/40 text-irreversible' },
  unavailable: { word: 'Chain unreachable — not checked', tone: 'text-muted-foreground' },
}

const CLAIM_NOT_PROOF = 'A match proves the bet happened on chain, not who placed it.'

function Tx({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-mono text-accent1">
      {label} {shortAddress(hash, 6, 4)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

export function MarketCard({ share, mine }: { share: PositionShare; mine: boolean }) {
  const check = useQuery(shareVerifyQuery(share))
  const verdict = check.isPending ? 'verifying' : (check.data ?? 'unavailable')
  const side = SHARE_SIDE[share.side] ?? `Side ${share.side}`
  const outcome = share.terminal ? SHARE_OUTCOME[share.terminal.kind] : 'Still open'
  const amount = share.terminal?.amount ? shareUnits(share.terminal.amount, share.decimals, share.symbol) : null
  return (
    <div className="flex min-w-[min(16rem,100%)] flex-col gap-2">
      <div className="flex items-center gap-2">
        <ChartCandlestick className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-kicker uppercase text-muted-foreground">{mine ? 'You shared a bet' : 'Their bet'}</span>
      </div>
      <p className="text-body2 font-medium">{shareQuestion(share)}</p>
      <p className="text-body4 text-muted-foreground">
        {side} · {shareUnits(share.cashIn, share.decimals, share.symbol)}
      </p>
      <p className="flex items-center gap-2">
        <span className={cn('font-display text-display4 uppercase', share.terminal && share.terminal.kind !== 'lost' ? 'text-accent1' : 'text-muted-foreground')}>{outcome}</span>
        {amount ? <span className="font-mono tabular-nums text-body3">{amount}</span> : null}
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-body4">
        <Tx hash={share.openingTxHash} label="opened" />
        {share.terminal?.txHash ? <Tx hash={share.terminal.txHash} label="closed" /> : null}
      </p>
      <Badge variant="outline" className={cn('w-fit', VERDICT[verdict].tone)}>
        {verdict === 'verifying' ? <Spinner className="size-3" /> : null}
        {VERDICT[verdict].word}
      </Badge>
      <p className="text-body4 text-muted-foreground">{CLAIM_NOT_PROOF}</p>
    </div>
  )
}
