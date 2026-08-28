//
// The live half of `/markets` — the list, the ticket, the create form, the positions.
//
// ── EVERYTHING HERE IS A READ OR A REAL SUBMISSION ───────────────────────────────────────
//
// The rows come off `useMarkets` (raw `starknet_call`s against the deployed contract), the quote
// in the ticket is `quote_bet` — the number the contract will actually honour — and Confirm goes
// through the same `useSend` pipeline every other surface submits with, as the `market-bet` /
// `market-create` kinds Wave 3 built. Nothing on this panel renders a number nobody computed.
//
// ── A BET IS BEARER, AND THE UI SAYS SO BY WHAT IT DOES ──────────────────────────────────
//
// Confirm mints a fresh secret (inside the lazy graph — Poseidon is banned from eager chunks),
// sends its COMMITMENT with the payload, and stores the pair in the position store beside the
// account key. The secret is never rendered; the positions panel shows the commitment, which is
// already public on chain. Losing the store loses the claim — which is why it rides the backup
// ceremony with the note material.
//
// ── YES IS UP, AND THE MAPPING IS STATED ONCE ────────────────────────────────────────────
//
// Every question this surface renders is "PAIR above $X", so YES is `SIDE_UP` and NO is
// `SIDE_DOWN`, here and nowhere else. The bar under each question is the POT split — a fact —
// not a probability claim; the ticket's "pays if right" is the quote.
//
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  MARKET_STATE,
  marketQuestion,
  potShare,
  quoteBet,
  strikeDisplay,
  timeLeft,
  type OnChainMarket,
} from '@strk20/protocol/app-reads'
import { MARKET_OP, SIDE_DOWN, SIDE_UP, betPayload, createPayload } from '@strk20/protocol/market-calldata'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { PRAGMA_PAIR_LIST, type PragmaPair } from '@strk20/protocol/pragma-pairs'
import { MARKETS_BET_VISIBLE } from '@strk20/protocol/disclosure-copy'
import { MARKETS_NONE_OPEN } from '@strk20/protocol/markets-copy'

import { cn } from '../lib/cn'
import { APP_CONTRACTS } from '../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { toast } from '../shell/toast-store'
import { useBalance } from '../shell/use-balance'
import { useMarkets } from '../shell/use-app-reads'
import { addPosition, usePositions } from '../shell/use-positions'
import { useSend } from '../shell/use-send'
import { useSession, shortenFelt } from '../shell/session'
import { findToken, useTokenList } from '../shell/use-token-list'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { BlockedButton } from './BlockedButton'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

/** The pipeline's stage words, exactly as the other surfaces speak them. */
const STAGE_LABEL: Record<string, string> = {
  build: 'Building the bet…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming on chain…',
}

/** A market someone can still bet into: active, and its clock still running. */
function isOpen(market: OnChainMarket, nowMs: number): boolean {
  return market.state === MARKET_STATE.active && market.deadline * 1000 > nowMs
}

export function MarketsPanel() {
  const read = useMarkets()
  const positions = usePositions()
  const [ticket, setTicket] = useState<OnChainMarket | null>(null)
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const open = read.markets.filter((m) => isOpen(m, now))
  const settled = read.markets.filter((m) => !isOpen(m, now))
  const marketPositions = positions.filter((p) => p.venue === 'market')

  return (
    <>
      <div className="flex flex-col gap-s8">
        {read.problem ? (
          <Text variant="body4" className="text-exposed" role="status">
            {read.problem}
          </Text>
        ) : null}

        {open.length === 0 ? (
          <Text variant="body3" className="text-neutral2">
            {read.loading ? 'Reading the markets contract…' : MARKETS_NONE_OPEN}
          </Text>
        ) : (
          open.map((market) => (
            <MarketRow key={market.id} market={market} now={now} onBet={() => setTicket(market)} />
          ))
        )}

        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          Create a market
        </Button>

        {settled.length > 0 ? (
          <div className="flex flex-col gap-s4 border-t border-solid border-surface3 pt-s8">
            <Text variant="kicker">Settled</Text>
            {settled.map((market) => (
              <div key={market.id} className="flex items-baseline justify-between gap-s8">
                <Text variant="body4" className="min-w-0 truncate text-neutral2">
                  {marketQuestion(market)}
                </Text>
                <Text variant="mono" className="shrink-0 text-neutral3">
                  {market.state === MARKET_STATE.voided
                    ? 'voided'
                    : market.state === MARKET_STATE.resolved
                      ? market.winner === SIDE_UP
                        ? 'YES won'
                        : 'NO won'
                      : 'closing'}
                </Text>
              </div>
            ))}
          </div>
        ) : null}

        {marketPositions.length > 0 ? (
          <div className="flex flex-col gap-s6 border-t border-solid border-surface3 pt-s8">
            <Text variant="kicker">Your positions</Text>
            {marketPositions.map((p) => (
              <div key={p.commitment} className="flex flex-col">
                <Text variant="body4" className="text-neutral1">
                  {p.label ?? `Market ${p.id}`}
                </Text>
                <Text variant="mono" className="truncate text-neutral3">
                  {shortenFelt(p.commitment, 10, 8)}
                </Text>
              </div>
            ))}
            <Text variant="body4" className="text-neutral3">
              The bet size is public. The bettor is not.
            </Text>
          </div>
        ) : null}
      </div>

      {ticket ? (
        <BetTicket market={ticket} now={now} open={ticket !== null} onClose={() => setTicket(null)} />
      ) : null}
      <CreateMarket open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

/** One open market: the question, the clock, the pot bar, and the two doors in. */
function MarketRow({
  market,
  now,
  onBet,
}: {
  market: OnChainMarket
  now: number
  onBet: () => void
}) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, market.token)
  const share = potShare(market)
  const pot =
    stake?.decimals != null ? `${toPlainText(market.up + market.down, stake.decimals)} ${stake.symbol}` : null

  return (
    <div className="flex flex-col gap-s8 rounded-card p-s8 transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide hover:bg-inset">
      <div className="flex items-baseline justify-between gap-s8">
        <Text variant="body3" className="min-w-0 font-medium text-neutral1">
          {marketQuestion(market)}
        </Text>
        <Text variant="mono" className="shrink-0 text-neutral3">
          {timeLeft(market.deadline, now)}
        </Text>
      </div>

      {/* The POT, drawn. Gold is the YES share; the remainder is NO's. */}
      <div className="h-s4 overflow-hidden rounded-pill bg-insetHovered">
        <span
          aria-hidden="true"
          className="block h-full rounded-pill bg-accent1"
          style={{ width: `${share.upPct}%` }}
        />
      </div>

      <div className="flex items-center gap-s8">
        <Text variant="mono" className="text-accent1">
          YES {share.upPct}%
        </Text>
        <Text variant="mono" className="text-neutral3">
          NO {share.downPct}%
        </Text>
        {pot ? (
          <Text variant="mono" className="flex-1 text-right text-neutral3">
            {pot} pot
          </Text>
        ) : null}
      </div>

      <div className="flex gap-s6">
        <button
          type="button"
          onClick={onBet}
          className="focus-ring flex-1 cursor-pointer rounded-control bg-settledTint py-s8 text-buttonLabel4 text-settled hover:border-settled"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={onBet}
          className="focus-ring flex-1 cursor-pointer rounded-control bg-irreversibleTint py-s8 text-buttonLabel4 text-irreversible"
        >
          No
        </button>
      </div>
      {market.experimental ? (
        <Text variant="body4" className="text-neutral3">
          Short-window market — a coin flip against the oracle&rsquo;s update cadence, and labelled as
          one.
        </Text>
      ) : null}
    </div>
  )
}

/**
 * The ticket. Side, stake, the live quote, and the confirm that is the bet.
 */
function BetTicket({
  market,
  now,
  open,
  onClose,
}: {
  market: OnChainMarket
  now: number
  open: boolean
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

  const [side, setSide] = useState<number>(SIDE_UP)
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

  //
  // THE QUOTE, from the contract's own `quote_bet`. Debounced a beat so a typist is not racing
  // the RPC, and keyed to (side, amount) so a stale answer for the other side cannot land late
  // and label this one.
  //
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
    // that can be dismissed. The secret IS the money; a bet whose secret was not written is a
    // bet nobody can ever claim.
    //
    addPosition({
      venue: 'market',
      id: market.id,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `${side === SIDE_UP ? 'YES' : 'NO'} · ${marketQuestion(market)} · ${toPlainText(parsed.wei, decimals)} ${symbol}`,
    })
    toast({
      kind: 'success',
      title: 'Position open',
      detail: 'The size is public, the bettor is not. The claim secret is stored in this browser.',
    })
    onClose()
  }, [parsed.wei, market, side, symbol, decimals, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Bet" modal>
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
              className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-heading3 text-neutral1 outline-none placeholder:text-neutral3"
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
              ? (STAGE_LABEL[sending.stage] ?? 'Working…')
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

/** How long a new market runs. The floor is the contract's own rule, and the short tier says so. */
const WINDOWS = [
  { label: '1 hour', seconds: 3_600, experimental: false },
  { label: '6 hours', seconds: 6 * 3_600, experimental: false },
  { label: '24 hours', seconds: 24 * 3_600, experimental: false },
  { label: '3 days', seconds: 3 * 24 * 3_600, experimental: false },
  { label: '15 minutes — experimental', seconds: 15 * 60, experimental: true },
] as const

/**
 * Creating a market: pair, strike, window, seed. The seed is a real stake — it becomes the pot's
 * opening liquidity, and the creator's claim on its residual is a bearer position like any bet.
 */
function CreateMarket({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const [pair, setPair] = useState<PragmaPair>('BTC/USD')
  const [strike, setStrike] = useState('')
  const [windowIdx, setWindowIdx] = useState(2)
  const [seed, setSeed] = useState('')

  //
  // THE SEED TOKEN IS STRK, THE ONE TOKEN EVERY REGISTERED ACCOUNT HOLDS — it paid the pool fee.
  // A picker here would be a decision with one honest answer; the market 0 evidence run staked
  // STRK for the same reason.
  //
  const strk = useMemo(
    () => tokens.find((t) => t.symbol === 'STRK') ?? null,
    [tokens],
  )
  const decimals = strk?.decimals ?? 18
  const parsedSeed = useMemo(() => parseAmountInput(seed, decimals), [seed, decimals])
  const strikeNumber = Number(strike)
  const strike8dp =
    strike.trim() !== '' && Number.isFinite(strikeNumber) && strikeNumber > 0
      ? BigInt(Math.round(strikeNumber * 1e8))
      : null

  const held = useMemo(() => {
    if (!strk) return null
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(strk.address)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance, strk])

  const chosen = WINDOWS[windowIdx]!

  const blocker =
    currentBlocker(health) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (!strk ? 'The token list has not loaded' : null) ??
    (strike8dp === null ? 'Enter a strike price' : null) ??
    (parsedSeed.problem ?? null) ??
    (parsedSeed.wei === null || parsedSeed.wei === 0n ? 'Enter a seed — a market opens with liquidity' : null) ??
    (held !== null && parsedSeed.wei !== null && parsedSeed.wei > held ? 'Not enough shielded STRK' : null)

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.markets
    if (!contract || !strk || strike8dp === null || parsedSeed.wei === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    // The pair id is its ASCII short string — the same encoding the chart's oracle read uses.
    let pairFelt = 0n
    for (const ch of pair) pairFelt = (pairFelt << 8n) | BigInt(ch.charCodeAt(0))
    const payload = createPayload({
      pairId: pairFelt,
      strike: strike8dp,
      deadline: Math.floor(Date.now() / 1000) + chosen.seconds,
      token: strk.address,
      seed: parsedSeed.wei,
      seederCommitment: minted.commitment,
      experimental: chosen.experimental,
    })
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'The market was refused', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: 'market-create',
      recipient: contract,
      token: strk.address,
      symbol: strk.symbol,
      amount: parsedSeed.wei,
      app: {
        contract,
        op: MARKET_OP.create,
        calldata: payload.calldata,
        noteIdSlots: [],
        openNoteCount: 0,
      },
    })
    if (!outcome.ok) return
    addPosition({
      venue: 'market',
      // The new market's id is `market_count` before this landed; the next poll renders it. The
      // position label carries the QUESTION, which is what the user will recognise it by.
      id: -1,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `Seeded ${pair} above $${strikeDisplay(strike8dp)} · ${toPlainText(parsedSeed.wei, decimals)} STRK`,
    })
    toast({
      kind: 'success',
      title: 'Market open',
      detail: 'The first bet sets the odds against your seed. The seed’s claim secret is stored in this browser.',
    })
    onClose()
  }, [strk, strike8dp, parsedSeed.wei, pair, chosen, sending, decimals, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Create a market" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Create a market
        </Text>
        <Text variant="body4" className="text-neutral2">
          A question the oracle can answer, a closing time, and a seed. Anyone can bet into it the
          moment it opens; the seed is the opening pot and its residual comes back to you after
          settlement.
        </Text>

        <label className="flex flex-col gap-s4">
          <Text variant="body4" className="uppercase text-neutral3" as="span">
            Pair
          </Text>
          <div className="flex gap-s6">
            {PRAGMA_PAIR_LIST.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPair(p)}
                aria-pressed={pair === p}
                className={cn(
                  'focus-ring flex-1 cursor-pointer rounded-control border border-solid py-s8 text-buttonLabel4',
                  pair === p
                    ? 'border-accent1 bg-accent2 text-accent1'
                    : 'border-surface3 bg-transparent text-neutral2',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </label>

        <label className="flex flex-col gap-s4">
          <Text variant="body4" className="uppercase text-neutral3" as="span">
            Above
          </Text>
          <div className="flex items-center gap-s8 rounded-card border border-solid border-surface3 bg-raised p-s12">
            <span aria-hidden="true" className="text-body3 text-neutral3">
              $
            </span>
            <input
              value={strike}
              onChange={(e) => setStrike(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              aria-label="Strike price in dollars"
              className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-heading3 text-neutral1 outline-none placeholder:text-neutral3"
            />
          </div>
          <Text variant="body4" className="text-neutral3" as="span">
            Settles YES strictly above this, NO at or below — Pragma&rsquo;s median at the close.
          </Text>
        </label>

        <label className="flex flex-col gap-s4">
          <Text variant="body4" className="uppercase text-neutral3" as="span">
            Closes in
          </Text>
          <div className="flex flex-wrap gap-s6">
            {WINDOWS.map((w, i) => (
              <button
                key={w.label}
                type="button"
                onClick={() => setWindowIdx(i)}
                aria-pressed={windowIdx === i}
                className={cn(
                  'focus-ring cursor-pointer rounded-control border border-solid px-s12 py-s8 text-buttonLabel4',
                  windowIdx === i
                    ? 'border-accent1 bg-accent2 text-accent1'
                    : 'border-surface3 bg-transparent text-neutral2',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </label>

        <div className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 bg-raised p-s12">
          <div className="flex items-center justify-between">
            <Text variant="body4" className="uppercase text-neutral3">
              Seed
            </Text>
            <Text variant="mono" className="text-neutral3">
              {held !== null ? `Balance: ${toPlainText(held, decimals)} STRK` : ''}
            </Text>
          </div>
          <div className="flex items-center gap-s8">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              aria-label="Seed amount"
              className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-heading3 text-neutral1 outline-none placeholder:text-neutral3"
            />
            <span className="shrink-0 rounded-pill border border-solid border-surface3Hovered bg-insetHovered px-s12 py-s6 text-buttonLabel4 text-neutral1">
              STRK
            </span>
          </div>
        </div>

        <Text variant="body4" className="text-neutral3">
          Creating is a pool transaction: the seed leaves your shielded balance, and the market
          records no creator address — the seed&rsquo;s claim is a bearer secret this browser keeps.
        </Text>

        <BlockedButton
          blocker={
            sending.stage
              ? (STAGE_LABEL[sending.stage] ?? 'Working…')
              : (blocker ?? sending.problem)
          }
          action="Open this market"
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}
