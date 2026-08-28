//
// Creating a market: pair, strike, window, seed. The seed is a real stake — it becomes the pot's
// opening liquidity, and the creator's claim on its residual is a bearer position like any bet.
// The pair chips wear their marks now, so the choice reads at a glance instead of as three
// substrings.
//
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { strikeDisplay } from '@strk20/protocol/app-reads'
import { MARKET_OP, createPayload } from '@strk20/protocol/market-calldata'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { PRAGMA_PAIR_LIST, type PragmaPair } from '@strk20/protocol/pragma-pairs'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../../shell/pool-health'
import { toast } from '../../shell/toast-store'
import { useBalance } from '../../shell/use-balance'
import { addPosition } from '../../shell/use-positions'
import { useSend } from '../../shell/use-send'
import { useSession } from '../../shell/session'
import { useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'
import { PairMark } from './PairMark'

const STAGE_LABEL: Record<string, string> = {
  build: 'Building the market…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming on chain…',
}

/** How long a new market runs. The floor is the contract's own rule, and the short tier says so. */
const WINDOWS = [
  { label: '1 hour', seconds: 3_600, experimental: false },
  { label: '6 hours', seconds: 6 * 3_600, experimental: false },
  { label: '24 hours', seconds: 24 * 3_600, experimental: false },
  { label: '3 days', seconds: 3 * 24 * 3_600, experimental: false },
  { label: '15 minutes — experimental', seconds: 15 * 60, experimental: true },
] as const

export function CreateMarket({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  const strk = useMemo(() => tokens.find((t) => t.symbol === 'STRK') ?? null, [tokens])
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
                  'focus-ring flex flex-1 cursor-pointer items-center justify-center gap-s6 rounded-control border border-solid py-s8 text-buttonLabel4',
                  pair === p
                    ? 'border-accent1 bg-accent2 text-accent1'
                    : 'border-surface3 bg-transparent text-neutral2',
                )}
              >
                <PairMark pair={p} size={18} />
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
