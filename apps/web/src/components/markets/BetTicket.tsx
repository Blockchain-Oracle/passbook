//
// The ticket. Side, stake, the live quote, and the confirm that is the bet.
//
// The quote is `quote_bet` — the number the contract will actually honour — debounced a beat so a
// typist is not racing the RPC, and keyed to (side, amount) so a stale answer for the other side
// cannot land late and label this one. Confirm mints a fresh secret inside the lazy graph, sends
// its COMMITMENT with the payload, and stores the pair before anything dismissible: the secret IS
// the money, and a bet whose secret was not written is a bet nobody can ever claim.
//
// `initialSide` is the card's doors carrying their meaning through: pressing YES opens a ticket
// already on YES, which is the difference between a door and a corridor.
//
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  marketQuestion,
  potShare,
  quoteBet,
  timeLeft,
  type OnChainMarket,
} from '@strk20/protocol/app-reads'
import { MARKET_OP, SIDE_DOWN, SIDE_UP, betPayload } from '@strk20/protocol/market-calldata'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { MARKETS_BET_VISIBLE } from '@strk20/protocol/disclosure-copy'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../../shell/pool-health'
import { toast } from '../../shell/toast-store'
import { useBalance } from '../../shell/use-balance'
import { addPosition } from '../../shell/use-positions'
import { stageLabel } from '../../shell/stage-labels'
import { useSend } from '../../shell/use-send'
import { useSession, shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'


export function BetTicket({
  market,
  now,
  open,
  initialSide = SIDE_UP,
  onClose,
}: {
  market: OnChainMarket
  now: number
  open: boolean
  initialSide?: number
  onClose: () => void
}) {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const stakeToken = findToken(tokens, market.token)
  const symbol = stakeToken?.symbol ?? shortenFelt(market.token, 4, 3)
  const decimals = stakeToken?.decimals ?? 18

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const [side, setSide] = useState<number>(initialSide)
  const [stake, setStake] = useState('')
  const parsed = useMemo(() => parseAmountInput(stake, decimals), [stake, decimals])

  const held = useMemo(() => {
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(market.token)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance, market.token])

  const [quote, setQuote] = useState<{ key: string; tickets: bigint } | 'loading' | null>(null)
  useEffect(() => {
    const contract = APP_CONTRACTS.markets
    if (!contract || parsed.wei === null || parsed.wei === 0n) {
      setQuote(null)
      return
    }
    const key = `${side}:${parsed.wei}`
    setQuote('loading')
    const timer = window.setTimeout(() => {
      quoteBet(contract, market.id, side, parsed.wei!).then(
        (tickets) => setQuote((q) => (q === 'loading' || (q && q.key !== key) ? { key, tickets } : q)),
        () => setQuote(null),
      )
    }, 350)
    return () => window.clearTimeout(timer)
  }, [side, parsed.wei, market.id])

  const quoted = quote !== null && quote !== 'loading' ? quote.tickets : null
  const impliedPct =
    quoted !== null && quoted > 0n && parsed.wei
      ? Math.min(100, Math.round(Number((parsed.wei * 100n) / quoted)))
      : null

  const share = potShare(market)

  const blocker =
    currentBlocker(health) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (parsed.problem ?? null) ??
    (parsed.wei === null || parsed.wei === 0n ? 'Enter a stake' : null) ??
    (held !== null && parsed.wei !== null && parsed.wei > held ? `Not enough shielded ${symbol}` : null) ??
    (quote === 'loading' ? 'Getting the quote' : null) ??
    (quoted === null ? 'The quote could not be read' : null)

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.markets
    if (!contract || parsed.wei === null || parsed.wei === 0n) return
    // The secret is minted in the LAZY graph — Poseidon is banned from the eager chunks.
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    const payload = betPayload([
      { marketId: market.id, side, amount: parsed.wei, commitment: minted.commitment },
    ])
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'The bet was refused', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: 'market-bet',
      recipient: contract,
      token: market.token,
      symbol,
      amount: parsed.wei,
      app: {
        contract,
        op: MARKET_OP.bet,
        calldata: payload.calldata,
        noteIdSlots: [],
        openNoteCount: 0,
      },
    })
    if (!outcome.ok) return
    //
    // THE POSITION IS STORED THE MOMENT THE SEND SUCCEEDS — before the toast, before anything
    // that can be dismissed.
    //
    addPosition({
      venue: 'market',
      kind: 'market-bet',
      id: market.id,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `${side === SIDE_UP ? 'YES' : 'NO'} · ${marketQuestion(market)} · ${toPlainText(parsed.wei, decimals)} ${symbol}`,
      txHash: outcome.transactionHash,
    })
    toast({
      kind: 'success',
      title: 'Position open',
      detail:
        'The size and transaction submitter are public. The bearer claim secret stays in this browser.',
    })
    onClose()
  }, [parsed.wei, market, side, symbol, decimals, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Bet" modal dismissible={sending.stage === null}>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <div className="flex items-baseline justify-between gap-s8">
          <Text variant="subheading2" as="h2" className="text-neutral1">
            {marketQuestion(market)}
          </Text>
          <Text variant="mono" className="shrink-0 text-neutral3">
            settles in {timeLeft(market.deadline, now)}
          </Text>
        </div>

        <div className="flex gap-s6">
          <button
            type="button"
            onClick={() => setSide(SIDE_UP)}
            aria-pressed={side === SIDE_UP}
            className={cn(
              'focus-ring flex-1 cursor-pointer rounded-control border border-solid py-s12 text-buttonLabel3 text-settled',
              side === SIDE_UP ? 'border-settled bg-settledTint' : 'border-surface3 bg-transparent',
            )}
          >
            Yes · {share.upPct}%
          </button>
          <button
            type="button"
            onClick={() => setSide(SIDE_DOWN)}
            aria-pressed={side === SIDE_DOWN}
            className={cn(
              'focus-ring flex-1 cursor-pointer rounded-control border border-solid py-s12 text-buttonLabel3 text-irreversible',
              side === SIDE_DOWN ? 'border-irreversible bg-irreversibleTint' : 'border-surface3 bg-transparent',
            )}
          >
            No · {share.downPct}%
          </button>
        </div>

        <div className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 bg-raised p-s12">
          <div className="flex items-center justify-between">
            <Text variant="body4" className="uppercase text-neutral3">
              Stake
            </Text>
            <Text variant="mono" className="text-neutral3">
              {held !== null ? `Balance: ${toPlainText(held, decimals)} ${symbol}` : ''}
            </Text>
          </div>
          <div className="flex items-center gap-s8">
            <input
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              aria-label="Stake"
              className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-heading3 text-neutral1 placeholder:text-neutral3"
            />
            <span className="shrink-0 rounded-pill border border-solid border-surface3Hovered bg-insetHovered px-s12 py-s6 text-buttonLabel4 text-neutral1">
              {symbol}
            </span>
          </div>
        </div>

        <dl className="flex flex-col gap-s6">
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">Pays if right</dt>
            <dd className="numeric m-s0 font-mono text-body3 text-settled">
              {quote === 'loading' ? '…' : quoted !== null ? `${toPlainText(quoted, decimals)} ${symbol}` : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">Implied chance</dt>
            <dd className="numeric m-s0 font-mono text-body4 text-neutral1">
              {impliedPct !== null ? `${impliedPct}%` : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">Settles</dt>
            <dd className="m-s0 text-body4 text-neutral2">Pragma median at expiry — the feed on the chart</dd>
          </div>
        </dl>

        <Text variant="body4" className="text-neutral3">
          {MARKETS_BET_VISIBLE}
        </Text>

        <BlockedButton
          blocker={
            sending.stage
              ? stageLabel(sending.stage)
              : (blocker ?? sending.problem)
          }
          action={
            parsed.wei && parsed.wei > 0n
              ? `Back ${side === SIDE_UP ? 'YES' : 'NO'} · ${toPlainText(parsed.wei, decimals)} ${symbol}`
              : 'Back this side'
          }
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}
