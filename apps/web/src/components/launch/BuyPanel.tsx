//
// The buy: units in, the contract's own cost out, and a bearer position stored on success.
//
// ONE FORM, TWO MOUNTS. `BuyForm` is the whole mechanism; `BuyTicket` wraps it in the dialog the
// card grid opens, and the launch detail page mounts it directly in its right rail — Uniswap's
// TDP rule, kept: the action panel is always mounted beside the thing it acts on, never behind a
// second click. The mechanism cannot drift between the two because there is only one of it.
//
// The quote is `quote_buy` and nothing else prices a batch: sixteen units per epoch, a batch can
// cross an epoch boundary mid-buy, and the contract is the only party that prices that correctly.
// Confirm mints a bearer secret, sends its commitment with the buy, and stores the pair; the
// buyer's address appears nowhere, which is the launch's whole claim.
//
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  UNITS_PER_EPOCH,
  currentEpoch,
  quoteBuy,
  type OnChainLaunch,
} from '@strk20/protocol/app-reads'
import { LAUNCH_OP, buyPayload } from '@strk20/protocol/launch-calldata'
import { toPlainText } from '@strk20/protocol/amount'
import { LAUNCH_IDENTITY } from '@strk20/protocol/disclosure-copy'

import { APP_CONTRACTS } from '../../shell/app-contracts'
import { currentBlocker, getHealth, subscribeHealth } from '../../shell/pool-health'
import { toast } from '../../shell/toast-store'
import { useBalance } from '../../shell/use-balance'
import { addPosition } from '../../shell/use-positions'
import { useSend } from '../../shell/use-send'
import { useSession, shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'
import { STAGE_LABEL } from './phase'

export function BuyForm({ launch, onDone }: { launch: OnChainLaunch; onDone?: () => void }) {
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
    onDone?.()
  }, [units, quoted, launch, symbol, decimals, sending, onDone])

  return (
    <div className="flex min-h-0 flex-col gap-s12">
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
  )
}

/** The dialog mount, for the card grid. The detail rail mounts `BuyForm` directly instead. */
export function BuyTicket({
  launch,
  open,
  onClose,
}: {
  launch: OnChainLaunch
  open: boolean
  onClose: () => void
}) {
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
        <BuyForm launch={launch} onDone={onClose} />
      </div>
    </ResponsiveDialog>
  )
}
