//
// The live half of `/launch` — the cards, the buy, the create.
//
// ── EVERY CARD IS A CHAIN READ, EVERY STATE IS THE CONTRACT'S ────────────────────────────
//
// The grid renders `useLaunches` — `launch_count`, `get_launch`, the names — and each card wears
// the launch's REAL state: selling, sold out, graduated, failed-and-refunding. A deadline that
// passed with the raise short renders the refund sentence, because that is what the contract will
// do about it; nothing here rounds a failed launch up to an optimistic one.
//
// ── BUYING IS UNITS, AND THE QUOTE IS `quote_buy` ────────────────────────────────────────
//
// The curve is priced in units (sixteen per epoch, `UNITS_PER_EPOCH`), so the modal asks for a
// count of units and shows the contract's own cost for them — which may cross an epoch boundary
// mid-batch, and the quote is the only party that prices that correctly. Confirm mints a bearer
// secret, sends its commitment with the buy, and stores the pair; the buyer's address appears
// nowhere, which is the launch's whole claim.
//
// ── CREATING IS A DIRECT CALL, AND THE SURFACE SAYS WHOSE ADDRESS SHOWS ──────────────────
//
// `create_launch` lives outside `privacy_invoke` (the contract's own comment: a relayer can
// sponsor a creation because the creator is a commitment). From this browser it is an ordinary
// account call: the CALLER's address is on the transaction, the creator's CLAIM is the bearer
// secret this stores. The form states that plainly instead of implying a private create.
//
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  LAUNCH_STATE,
  UNITS_PER_EPOCH,
  currentEpoch,
  encodeByteArray,
  quoteBuy,
  raiseTarget,
  soldPct,
  timeLeft,
  unitPriceAt,
  type OnChainLaunch,
} from '@strk20/protocol/app-reads'
import { LAUNCH_OP, buyPayload } from '@strk20/protocol/launch-calldata'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { LAUNCH_IDENTITY } from '@strk20/protocol/disclosure-copy'

import { cn } from '../lib/cn'
import { APP_CONTRACTS } from '../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { invokeDirect } from '../shell/submit'
import { toast } from '../shell/toast-store'
import { useBalance } from '../shell/use-balance'
import { useLaunches } from '../shell/use-app-reads'
import { addPosition, usePositions } from '../shell/use-positions'
import { useSend } from '../shell/use-send'
import { useSession, shortenFelt } from '../shell/session'
import { findToken, useTokenList } from '../shell/use-token-list'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { BlockedButton } from './BlockedButton'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

const STAGE_LABEL: Record<string, string> = {
  build: 'Building the buy…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming on chain…',
}

type Phase = 'selling' | 'sold-out' | 'graduated' | 'failed' | 'missed'

/** What is TRUE of a launch right now, as one word the card renders its whole shape from. */
function phaseOf(launch: OnChainLaunch, nowMs: number): Phase {
  if (launch.state === LAUNCH_STATE.graduated) return 'graduated'
  if (launch.state === LAUNCH_STATE.failed) return 'failed'
  const offered = launch.epochs * UNITS_PER_EPOCH
  if (launch.sold >= offered) return 'sold-out'
  if (launch.deadline * 1000 <= nowMs) return 'missed'
  return 'selling'
}

export function LaunchPanel() {
  const read = useLaunches()
  const positions = usePositions()
  const [buying, setBuying] = useState<OnChainLaunch | null>(null)
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const launchPositions = positions.filter((p) => p.venue === 'launch')

  return (
    <div className="flex flex-col gap-s12">
      {read.problem ? (
        <Text variant="body4" className="text-exposed" role="status">
          {read.problem}
        </Text>
      ) : null}

      {read.launches.length === 0 ? (
        <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
          <Text variant="body3" className="text-neutral2">
            {read.loading
              ? 'Reading the launch contract…'
              : 'Nothing is selling right now. Anyone can launch a token — including you.'}
          </Text>
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            Create a launch
          </Button>
        </section>
      ) : (
        <>
          <div className="grid gap-s12 md:grid-cols-2">
            {read.launches.map((launch) => (
              <LaunchCard
                key={launch.id}
                launch={launch}
                now={now}
                onBuy={() => setBuying(launch)}
              />
            ))}
          </div>
          <Button variant="secondary" size="md" className="self-start" onClick={() => setCreating(true)}>
            Create a launch
          </Button>
        </>
      )}

      {launchPositions.length > 0 ? (
        <section className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16">
          <Text variant="kicker">Your positions</Text>
          {launchPositions.map((p) => (
            <div key={p.commitment} className="flex flex-col">
              <Text variant="body4" className="text-neutral1">
                {p.label ?? `Launch ${p.id}`}
              </Text>
              <Text variant="mono" className="truncate text-neutral3">
                {shortenFelt(p.commitment, 10, 8)}
              </Text>
            </div>
          ))}
          <Text variant="body4" className="text-neutral3">
            Each position is a bearer secret this browser keeps — it rides the recovery backup with
            your notes.
          </Text>
        </section>
      ) : null}

      {buying ? (
        <BuyTicket launch={buying} open={buying !== null} onClose={() => setBuying(null)} />
      ) : null}
      <CreateLaunch open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

/** One launch, as the Studio card: chip, epoch line, price, staircase, progress, its true state. */
function LaunchCard({
  launch,
  now,
  onBuy,
}: {
  launch: OnChainLaunch
  now: number
  onBuy: () => void
}) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, launch.stakeToken)
  const symbol = stake?.symbol ?? shortenFelt(launch.stakeToken, 4, 3)
  const decimals = stake?.decimals ?? 18
  const phase = phaseOf(launch, now)
  const epoch = currentEpoch(launch)
  const price = unitPriceAt(launch, epoch)
  const target = raiseTarget(launch)
  const pct = soldPct(launch)

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <div className="flex items-center gap-s12">
        <span
          aria-hidden="true"
          className="flex size-s40 shrink-0 items-center justify-center rounded-control bg-accent2 font-mono text-body3 font-bold text-accent1"
        >
          {launch.symbol.slice(0, 3).toUpperCase() || '?'}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Text variant="body2" className="truncate font-medium text-neutral1">
            {launch.name || `Launch ${launch.id}`}
          </Text>
          <Text variant="mono" className="text-neutral3">
            Epoch {epoch + 1} of {launch.epochs}
          </Text>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <Text variant="mono" className="text-neutral1">
            {toPlainText(price, decimals)} {symbol}
          </Text>
          <Text variant="body4" className="text-neutral3">
            per unit, this epoch
          </Text>
        </span>
      </div>

      <Staircase epochs={launch.epochs} at={epoch} />

      <div className="flex flex-col gap-s6">
        <div className="flex justify-between font-mono text-mono text-neutral3">
          <span>
            {launch.sold} of {launch.epochs * UNITS_PER_EPOCH} units · {pct}%
          </span>
          <span>
            {toPlainText(target, decimals)} {symbol} target
          </span>
        </div>
        <div className="h-s6 overflow-hidden rounded-pill bg-inset">
          <span
            aria-hidden="true"
            className="block h-full rounded-pill bg-accent1"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {phase === 'selling' ? (
        <>
          <Text variant="body4" className="text-neutral2">
            Graduates at {toPlainText(target, decimals)} {symbol} — or every buyer reclaims in full.
            There is no half-launched limbo. Closes in {timeLeft(launch.deadline, now)}.
          </Text>
          <Button variant="primary" size="md" fill onClick={onBuy}>
            Buy this epoch
          </Button>
        </>
      ) : (
        <Text
          variant="body4"
          className={phase === 'graduated' ? 'text-settled' : 'text-neutral2'}
        >
          {phase === 'graduated'
            ? 'Graduated — the token is deployed and buyers redeem their units for it.'
            : phase === 'sold-out'
              ? 'Sold out — every epoch filled. Graduation deploys the token.'
              : phase === 'failed'
                ? 'The raise failed. Every buyer reclaims in full.'
                : 'The deadline passed with the raise short. Every buyer reclaims in full — there is no half-launched limbo.'}
        </Text>
      )}
    </section>
  )
}

/**
 * The staircase, drawn from the REAL epoch count with the current tread lit. Flat treads, hard
 * risers: inside a step the price does not move at all, so there is nothing to win by racing in.
 */
function Staircase({ epochs, at }: { epochs: number; at: number }) {
  const steps = Math.max(1, Math.min(epochs, 8))
  const width = 120
  const tread = width / steps - 3
  return (
    <svg
      viewBox="0 0 120 40"
      className="h-[40px] w-full"
      fill="none"
      role="img"
      aria-label={`The staircase: price is flat within each of ${epochs} epochs and steps up between them`}
    >
      {Array.from({ length: steps }, (_, i) => {
        const x = 2 + i * (width / steps)
        const y = 34 - i * (28 / Math.max(1, steps - 1))
        return (
          <g key={i}>
            <path
              d={`M${x} ${y} h${tread}`}
              stroke="currentColor"
              className={i === at ? 'text-accent1' : 'text-neutral3'}
              strokeWidth={i === at ? 3 : 2}
              strokeLinecap="round"
            />
            {i < steps - 1 ? (
              <path
                d={`M${x + tread} ${y} V${y - 28 / Math.max(1, steps - 1)}`}
                stroke="currentColor"
                className="text-neutral3"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.5"
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/** The buy: units in, the contract's own cost out, and a bearer position stored on success. */
function BuyTicket({
  launch,
  open,
  onClose,
}: {
  launch: OnChainLaunch
  open: boolean
  onClose: () => void
}) {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const stake = findToken(tokens, launch.stakeToken)
  const symbol = stake?.symbol ?? shortenFelt(launch.stakeToken, 4, 3)
  const decimals = stake?.decimals ?? 18

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const [unitsRaw, setUnitsRaw] = useState('1')
  const units = /^\d+$/.test(unitsRaw.trim()) ? Number(unitsRaw.trim()) : null
  const remaining = launch.epochs * UNITS_PER_EPOCH - launch.sold

  const held = useMemo(() => {
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(launch.stakeToken)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance, launch.stakeToken])

  const [quote, setQuote] = useState<{ units: number; cost: bigint } | 'loading' | null>(null)
  useEffect(() => {
    const contract = APP_CONTRACTS.launch
    if (!contract || units === null || units <= 0) {
      setQuote(null)
      return
    }
    setQuote('loading')
    const timer = window.setTimeout(() => {
      quoteBuy(contract, launch.id, units).then(
        (cost) => setQuote({ units, cost }),
        () => setQuote(null),
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [units, launch.id])

  const quoted = quote !== null && quote !== 'loading' && quote.units === units ? quote.cost : null

  const blocker =
    currentBlocker(health) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (units === null || units <= 0 ? 'Enter a whole number of units — units do not divide' : null) ??
    (units !== null && units > remaining ? `Only ${remaining} units remain on this curve` : null) ??
    (quote === 'loading' ? 'Getting the price' : null) ??
    (quoted === null ? 'The price could not be read' : null) ??
    (held !== null && quoted !== null && quoted > held ? `Not enough shielded ${symbol}` : null)

  const onConfirm = useCallback(async () => {
    const contract = APP_CONTRACTS.launch
    if (!contract || units === null || quoted === null) return
    const { mintPositionSecret } = await import('@strk20/protocol/commitment')
    const minted = mintPositionSecret()
    const payload = buyPayload([{ launchId: launch.id, units, commitment: minted.commitment }])
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'The buy was refused', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: 'launch-buy',
      recipient: contract,
      token: launch.stakeToken,
      symbol,
      amount: quoted,
      app: {
        contract,
        op: LAUNCH_OP.buy,
        calldata: payload.calldata,
        noteIdSlots: [],
        openNoteCount: 0,
      },
    })
    if (!outcome.ok) return
    // Stored the moment the send succeeds — the secret IS the claim on these units.
    addPosition({
      venue: 'launch',
      id: launch.id,
      secret: minted.secret,
      commitment: minted.commitment,
      createdAt: Date.now(),
      label: `${units} unit${units === 1 ? '' : 's'} of ${launch.symbol || launch.name} · ${toPlainText(quoted, decimals)} ${symbol}`,
    })
    toast({
      kind: 'success',
      title: 'Bought',
      detail: 'If the raise misses, you reclaim in full. The claim secret is stored in this browser.',
    })
    onClose()
  }, [units, quoted, launch, symbol, decimals, sending, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Buy" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <div className="flex items-baseline justify-between gap-s8">
          <Text variant="subheading2" as="h2" className="text-neutral1">
            Buy {launch.name || launch.symbol}
          </Text>
          <Text variant="mono" className="shrink-0 text-neutral3">
            Epoch {currentEpoch(launch) + 1} of {launch.epochs} — same price for everyone inside it
          </Text>
        </div>

        <div className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 bg-raised p-s12">
          <div className="flex items-center justify-between">
            <Text variant="body4" className="uppercase text-neutral3">
              Units
            </Text>
            <Text variant="mono" className="text-neutral3">
              {remaining} remaining on the curve
            </Text>
          </div>
          <div className="flex items-center gap-s8">
            <input
              value={unitsRaw}
              onChange={(e) => setUnitsRaw(e.target.value)}
              placeholder="1"
              inputMode="numeric"
              aria-label="Units to buy"
              className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-heading3 text-neutral1 outline-none placeholder:text-neutral3"
            />
            <span className="shrink-0 rounded-pill border border-solid border-surface3Hovered bg-insetHovered px-s12 py-s6 text-buttonLabel4 text-neutral1">
              units
            </span>
          </div>
        </div>

        <dl className="flex flex-col gap-s6">
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">You pay</dt>
            <dd className="numeric m-s0 font-mono text-body3 text-neutral1">
              {quote === 'loading' ? '…' : quoted !== null ? `${toPlainText(quoted, decimals)} ${symbol}` : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">You receive</dt>
            <dd className="numeric m-s0 font-mono text-body3 text-settled">
              {units !== null && units > 0
                ? `${units} unit${units === 1 ? '' : 's'} — ${toPlainText(launch.unitTokens * BigInt(units), 18)} ${launch.symbol || 'tokens'} at graduation`
                : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-s12">
            <dt className="text-body4 text-neutral3">If the raise misses</dt>
            <dd className="m-s0 text-body4 text-neutral2">full refund, reclaimed by you</dd>
          </div>
        </dl>

        <Text variant="body4" className="text-neutral3">
          {LAUNCH_IDENTITY}
        </Text>

        <BlockedButton
          blocker={
            sending.stage ? (STAGE_LABEL[sending.stage] ?? 'Working…') : (blocker ?? sending.problem)
          }
          action={units !== null && units > 0 ? `Buy ${units} unit${units === 1 ? '' : 's'}` : 'Buy'}
          onPress={() => void onConfirm()}
        />
      </div>
    </ResponsiveDialog>
  )
}

/** How long a new launch has to hit its target. */
const LAUNCH_WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
] as const

/**
 * The create form. Everything the contract's signature needs, in the user's units, with the
 * arithmetic stated beside each field rather than hidden inside one.
 */
function CreateLaunch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTokenList()
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [stepRaw, setStepRaw] = useState('')
  const [epochsRaw, setEpochsRaw] = useState('4')
  const [tokensPerEpochRaw, setTokensPerEpochRaw] = useState('16000')
  const [windowIdx, setWindowIdx] = useState(1)
  const [busy, setBusy] = useState(false)

  const strk = useMemo(() => tokens.find((t) => t.symbol === 'STRK') ?? null, [tokens])
  const decimals = strk?.decimals ?? 18

  const price = useMemo(() => parseAmountInput(priceRaw, decimals), [priceRaw, decimals])
  const step = useMemo(
    () => (stepRaw.trim() === '' ? { wei: 0n, problem: null } : parseAmountInput(stepRaw, decimals)),
    [stepRaw, decimals],
  )
  const epochs = /^\d+$/.test(epochsRaw.trim()) ? Number(epochsRaw.trim()) : null
  const tokensPerEpoch = /^\d+$/.test(tokensPerEpochRaw.trim()) ? Number(tokensPerEpochRaw.trim()) : null
  const symbolClean = symbol.trim().toUpperCase()

  const blocker =
    (!ready ? 'This browser has no account yet' : null) ??
    (!strk ? 'The token list has not loaded' : null) ??
    (name.trim() === '' ? 'Name the token' : null) ??
    (symbolClean === '' || symbolClean.length > 8 ? 'Give it a symbol, eight characters or fewer' : null) ??
    (price.problem ?? null) ??
    (price.wei === null || price.wei === 0n ? 'Price the first epoch' : null) ??
    ('problem' in step && step.problem ? step.problem : null) ??
    (epochs === null || epochs < 1 || epochs > 32 ? 'Between 1 and 32 epochs' : null) ??
    (tokensPerEpoch === null || tokensPerEpoch <= 0 ? 'How many tokens each epoch sells' : null) ??
    (busy ? 'Creating…' : null)

  const onConfirm = useCallback(async () => {
    if (!ready || !strk || price.wei === null || epochs === null || tokensPerEpoch === null) return
    setBusy(true)
    try {
      const { mintPositionSecret } = await import('@strk20/protocol/commitment')
      const minted = mintPositionSecret()
      const tranche = BigInt(tokensPerEpoch) * 10n ** 18n
      const deadline = Math.floor(Date.now() / 1000) + LAUNCH_WINDOWS[windowIdx]!.seconds
      const calldata = [
        ...encodeByteArray(name.trim()),
        ...encodeByteArray(symbolClean),
        ...encodeByteArray(''), // logo_uri — nothing to point at is stated as nothing
        strk.address,
        `0x${price.wei.toString(16)}`,
        `0x${(step.wei ?? 0n).toString(16)}`,
        `0x${tranche.toString(16)}`,
        `0x${epochs.toString(16)}`,
        `0x${deadline.toString(16)}`,
        minted.commitment,
      ]
      const outcome = await invokeDirect(ready.accountKey, ready.address, {
        contractAddress: APP_CONTRACTS.launch!,
        entrypoint: 'create_launch',
        calldata,
      })
      if (!outcome.ok) {
        toast({ kind: 'error', title: 'The launch was not created', detail: outcome.because })
        return
      }
      // The creator's sweep claim — held like every other bearer position.
      addPosition({
        venue: 'launch',
        id: -1,
        secret: minted.secret,
        commitment: minted.commitment,
        createdAt: Date.now(),
        label: `Creator of ${symbolClean} — sweeps the raise on graduation`,
      })
      toast({
        kind: 'success',
        title: `${symbolClean} is live`,
        detail: 'The sale is open. Your creator claim is a bearer secret stored in this browser.',
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }, [ready, strk, price.wei, step.wei, epochs, tokensPerEpoch, windowIdx, name, symbolClean, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Create a launch" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Launch a token
        </Text>
        <Text variant="body4" className="text-neutral2">
          Epoch-priced: everyone inside an epoch pays the same price, and the price steps up when
          the epoch does. It graduates at the target or refunds everyone — no half-launched limbo.
        </Text>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-[2] flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Name
            </Text>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Night Owl"
              aria-label="Token name"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 text-body3 text-neutral1 outline-none placeholder:text-neutral3"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Symbol
            </Text>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="OWL"
              aria-label="Token symbol"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 uppercase outline-none placeholder:text-neutral3"
            />
          </label>
        </div>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Price / unit, epoch 1
            </Text>
            <div className="flex items-center gap-s6 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8">
              <input
                value={priceRaw}
                onChange={(e) => setPriceRaw(e.target.value)}
                placeholder="0.05"
                inputMode="decimal"
                aria-label="Unit price in the first epoch"
                className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
              />
              <span className="text-body4 text-neutral3">STRK</span>
            </div>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Step per epoch
            </Text>
            <div className="flex items-center gap-s6 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8">
              <input
                value={stepRaw}
                onChange={(e) => setStepRaw(e.target.value)}
                placeholder="0.01"
                inputMode="decimal"
                aria-label="Price step per epoch"
                className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
              />
              <span className="text-body4 text-neutral3">STRK</span>
            </div>
          </label>
        </div>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Epochs
            </Text>
            <input
              value={epochsRaw}
              onChange={(e) => setEpochsRaw(e.target.value)}
              inputMode="numeric"
              aria-label="Number of epochs"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Tokens / epoch
            </Text>
            <input
              value={tokensPerEpochRaw}
              onChange={(e) => setTokensPerEpochRaw(e.target.value)}
              inputMode="numeric"
              aria-label="Tokens sold per epoch"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Runs for
            </Text>
            <div className="flex gap-s4">
              {LAUNCH_WINDOWS.map((w, i) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setWindowIdx(i)}
                  aria-pressed={windowIdx === i}
                  className={cn(
                    'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s6 py-s8 text-buttonLabel4',
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
        </div>

        <Text variant="body4" className="text-neutral3">
          Creating is an ordinary transaction from this account — your ADDRESS is on it, the way any
          deploy is public. Your claim on the raise is not: it is a bearer secret this browser
          stores, and sweeping the raise later names whatever address you choose then. Sixteen
          units per epoch; each unit is a sixteenth of an epoch&rsquo;s tokens.
        </Text>

        <BlockedButton blocker={blocker} action="Launch it" onPress={() => void onConfirm()} />
      </div>
    </ResponsiveDialog>
  )
}
