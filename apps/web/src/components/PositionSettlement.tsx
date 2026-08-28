import { useCallback, useEffect, useMemo, useState } from 'react'

import type { OnChainLaunch, OnChainMarket } from '@strk20/protocol/app-reads'
import { LAUNCH_STATE, MARKET_STATE } from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { LAUNCH_OP, redeemPayload, refundPayload } from '@strk20/protocol/launch-calldata'
import { MARKET_OP, cashoutPayload, claimPayload } from '@strk20/protocol/market-calldata'
import {
  launchPositionAction,
  marketPositionAction,
  type LaunchPositionAction,
  type MarketPositionAction,
} from '@strk20/protocol/position-actions'
import {
  readLaunchPosition,
  readMarketPosition,
  type LaunchPositionRead,
  type MarketPositionRead,
} from '@strk20/protocol/position-reads'
import { SEND_STAGES, type SendStage } from '@strk20/protocol/pipeline-stage'
import { stepsFor } from '@strk20/protocol/progress'
import type { StoredPosition } from '@strk20/protocol/session-position-store'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { APP_CONTRACTS } from '../shell/app-contracts'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { shortenFelt, useSession } from '../shell/session'
import { stageLabel } from '../shell/stage-labels'
import { toast } from '../shell/toast-store'
import { useBalance } from '../shell/use-balance'
import { removePosition } from '../shell/use-positions'
import { useSend, type SendState } from '../shell/use-send'
import { BlockedButton } from './BlockedButton'
import { ProgressMachine } from './ProgressMachine'
import { Button } from './LegacyButton'
import { Text } from './Text'


type MarketReview = {
  position: StoredPosition
  read: MarketPositionRead
  action: Extract<MarketPositionAction, { kind: 'cashout' | 'claim' }>
}

type LaunchReview = {
  position: StoredPosition
  read: LaunchPositionRead
  action: Extract<LaunchPositionAction, { kind: 'redeem' | 'refund' }>
}

function progressFor(stage: SendStage) {
  const index = SEND_STAGES.indexOf(stage)
  return stepsFor({ stages: SEND_STAGES, reached: SEND_STAGES.slice(0, index + 1) })
}

function PositionIdentity({ position }: { position: StoredPosition }) {
  const href = position.txHash ? voyagerTxUrl(position.txHash) : null
  return (
    <div className="flex min-w-0 flex-col">
      <Text variant="body4" className="text-neutral1">
        {position.label ?? `${position.venue} ${position.id}`}
      </Text>
      <span className="flex min-w-0 items-baseline gap-s8">
        <Text variant="mono" className="truncate text-neutral3">
          {shortenFelt(position.commitment, 10, 8)}
        </Text>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="focus-ring shrink-0 font-mono text-mono text-accent1"
          >
            opened ↗
          </a>
        ) : null}
      </span>
    </div>
  )
}

export function MarketPositionSettlements({
  positions,
  market,
  symbol,
  decimals,
}: {
  positions: readonly StoredPosition[]
  market: OnChainMarket
  symbol: string
  decimals: number
}) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const balance = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(balance.read, ready)
  const [review, setReview] = useState<MarketReview | null>(null)

  const settle = useCallback(async () => {
    if (!review || !APP_CONTRACTS.markets) return
    const payload =
      review.action.kind === 'cashout'
        ? cashoutPayload({ secret: review.position.secret, minOut: (review.action.amount * 99n) / 100n })
        : claimPayload([review.position.secret])
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'Settlement refused', detail: payload.because })
      return
    }
    const outcome = await sending.send({
      kind: review.action.kind === 'cashout' ? 'market-cashout' : 'market-claim',
      recipient: APP_CONTRACTS.markets,
      token: market.token,
      symbol,
      amount: 0n,
      label: review.action.kind === 'cashout' ? `Cash out market ${market.id}` : `Claim market ${market.id}`,
      app: {
        contract: APP_CONTRACTS.markets,
        op: review.action.kind === 'cashout' ? MARKET_OP.cashout : MARKET_OP.claim,
        calldata: payload.calldata,
        noteIdSlots: payload.noteIdSlots,
        openNoteCount: 1,
        payoutToken: market.token,
      },
    })
    if (!outcome.ok) return
    removePosition(review.position.commitment)
    balance.refresh()
    toast({
      kind: 'success',
      title: review.action.kind === 'cashout' ? 'Position cashed out' : 'Payout claimed',
      detail: `${toPlainText(review.action.amount, decimals)} ${symbol} matured into your shielded balance.`,
    })
    setReview(null)
  }, [review, sending, market.id, market.token, symbol, decimals, balance])

  return (
    <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions here</Text>
      {positions.map((position) => (
        <MarketPositionRow
          key={position.commitment}
          position={position}
          market={market}
          symbol={symbol}
          decimals={decimals}
          onReview={(read, action) => setReview({ position, read, action })}
        />
      ))}
      <Text variant="body4" className="text-neutral3">
        The commitment and position size are public. The bearer secret stays in this browser and is
        revealed only inside the settlement proof.
      </Text>

      <SettlementDialog
        open={review !== null}
        onClose={() => {
          setReview(null)
          sending.reset()
        }}
        sending={sending}
        title={review?.action.kind === 'cashout' ? 'Review cash-out' : 'Review claim'}
        action={review ? `${review.action.kind === 'cashout' ? 'Cash out' : 'Claim'} ${toPlainText(review.action.amount, decimals)} ${symbol}` : ''}
        amount={review ? `${toPlainText(review.action.amount, decimals)} ${symbol}` : '—'}
        venue={`Market #${market.id}`}
        disclosure="The transaction submitter is visible on Starknet. The Markets contract settles the bearer commitment; it does not store your Passbook address as the bettor."
        onConfirm={() => void settle()}
      />
    </section>
  )
}

function MarketPositionRow({
  position,
  market,
  symbol,
  decimals,
  onReview,
}: {
  position: StoredPosition
  market: OnChainMarket
  symbol: string
  decimals: number
  onReview: (
    read: MarketPositionRead,
    action: Extract<MarketPositionAction, { kind: 'cashout' | 'claim' }>,
  ) => void
}) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ read: MarketPositionRead; action: MarketPositionAction } | 'loading' | 'error'>('loading')

  useEffect(() => {
    if (!APP_CONTRACTS.markets) {
      setState('error')
      return
    }
    let live = true
    setState('loading')
    void readMarketPosition(APP_CONTRACTS.markets, position.commitment).then(
      (read) => {
        if (!live) return
        if (read.marketId !== market.id) {
          setState('error')
          return
        }
        const marketState =
          market.state === MARKET_STATE.active
            ? 'active'
            : market.state === MARKET_STATE.resolved
              ? 'resolved'
              : 'voided'
        setState({
          read,
          action: marketPositionAction({
            positionOpen: read.state === 1,
            marketState,
            beforeDeadline: Date.now() < market.deadline * 1000,
            cashoutQuote: read.cashoutQuote,
            claimPreview: read.claimPreview,
          }),
        })
      },
      () => live && setState('error'),
    )
    return () => {
      live = false
    }
  }, [position.commitment, market.id, market.state, market.deadline, nonce])

  return (
    <div className="flex flex-col gap-s6 border-b border-solid border-surface3 pb-s8 last:border-b-0 last:pb-s0">
      <PositionIdentity position={position} />
      {state === 'loading' ? (
        <Text variant="body4" className="text-neutral3">Reading position and payout…</Text>
      ) : state === 'error' ? (
        <span className="flex items-center justify-between gap-s8">
          <Text variant="body4" className="text-irreversible">Position state could not be read.</Text>
          <Button variant="tertiary" size="sm" onClick={() => setNonce((value) => value + 1)}>Retry</Button>
        </span>
      ) : state.action.kind === 'cashout' || state.action.kind === 'claim' ? (
        <span className="flex flex-wrap items-center justify-between gap-s8">
          <Text variant="body4" className="text-neutral2">
            {state.action.kind === 'cashout' ? 'Current cash-out' : 'Available payout'} ·{' '}
            <strong className="font-mono text-neutral1">{toPlainText(state.action.amount, decimals)} {symbol}</strong>
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const action = state.action
              if (action.kind === 'cashout' || action.kind === 'claim') onReview(state.read, action)
            }}
          >
            {state.action.kind === 'cashout' ? 'Review cash-out' : 'Review claim'}
          </Button>
        </span>
      ) : (
        <Text variant="body4" className={state.action.kind === 'lost' ? 'text-irreversible' : 'text-neutral3'}>
          {marketActionSentence(state.action)}
        </Text>
      )}
    </div>
  )
}

export function LaunchPositionSettlements({
  positions,
  launch,
  stakeSymbol,
  stakeDecimals,
}: {
  positions: readonly StoredPosition[]
  launch: OnChainLaunch
  stakeSymbol: string
  stakeDecimals: number
}) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const balance = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(balance.read, ready)
  const [review, setReview] = useState<LaunchReview | null>(null)
  const payoutSymbol = review?.action.kind === 'redeem' ? launch.symbol : stakeSymbol
  const payoutDecimals = review?.action.kind === 'redeem' ? 18 : stakeDecimals

  const settle = useCallback(async () => {
    if (!review || !APP_CONTRACTS.launch) return
    const redeeming = review.action.kind === 'redeem'
    const payload = redeeming
      ? redeemPayload([review.position.secret])
      : refundPayload([review.position.secret])
    if (payload.state === 'refused') {
      toast({ kind: 'error', title: 'Settlement refused', detail: payload.because })
      return
    }
    const token = redeeming ? launch.token : launch.stakeToken
    const outcome = await sending.send({
      kind: redeeming ? 'launch-redeem' : 'launch-refund',
      recipient: APP_CONTRACTS.launch,
      token,
      symbol: redeeming ? launch.symbol : stakeSymbol,
      amount: 0n,
      label: redeeming ? `Redeem ${launch.symbol}` : `Refund launch ${launch.id}`,
      app: {
        contract: APP_CONTRACTS.launch,
        op: redeeming ? LAUNCH_OP.redeem : LAUNCH_OP.refund,
        calldata: payload.calldata,
        noteIdSlots: payload.noteIdSlots,
        openNoteCount: 1,
        payoutToken: token,
      },
    })
    if (!outcome.ok) return
    removePosition(review.position.commitment)
    balance.refresh()
    const decimals = redeeming ? 18 : stakeDecimals
    const symbol = redeeming ? launch.symbol : stakeSymbol
    toast({
      kind: 'success',
      title: redeeming ? 'Launch tokens redeemed' : 'Purchase refunded',
      detail: `${toPlainText(review.action.amount, decimals)} ${symbol} matured into your shielded balance.`,
    })
    setReview(null)
  }, [review, sending, launch, stakeSymbol, stakeDecimals, balance])

  return (
    <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions</Text>
      {positions.map((position) => (
        <LaunchPositionRow
          key={position.commitment}
          position={position}
          launch={launch}
          stakeSymbol={stakeSymbol}
          stakeDecimals={stakeDecimals}
          onReview={(read, action) => setReview({ position, read, action })}
        />
      ))}
      <Text variant="body4" className="text-neutral3">
        Launch records store commitments, not buyer addresses. The account that submits a buy or
        settlement is still visible on Starknet.
      </Text>
      <SettlementDialog
        open={review !== null}
        onClose={() => {
          setReview(null)
          sending.reset()
        }}
        sending={sending}
        title={review?.action.kind === 'redeem' ? 'Review redemption' : 'Review refund'}
        action={review ? `${review.action.kind === 'redeem' ? 'Redeem' : 'Refund'} ${toPlainText(review.action.amount, payoutDecimals)} ${payoutSymbol}` : ''}
        amount={review ? `${toPlainText(review.action.amount, payoutDecimals)} ${payoutSymbol}` : '—'}
        venue={`Launch #${launch.id}`}
        disclosure="The transaction submitter is visible on Starknet. The Launch contract records the bearer commitment instead of a buyer address."
        onConfirm={() => void settle()}
      />
    </section>
  )
}

function LaunchPositionRow({
  position,
  launch,
  stakeSymbol,
  stakeDecimals,
  onReview,
}: {
  position: StoredPosition
  launch: OnChainLaunch
  stakeSymbol: string
  stakeDecimals: number
  onReview: (
    read: LaunchPositionRead,
    action: Extract<LaunchPositionAction, { kind: 'redeem' | 'refund' }>,
  ) => void
}) {
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ read: LaunchPositionRead; action: LaunchPositionAction } | 'loading' | 'error'>('loading')

  useEffect(() => {
    if (!APP_CONTRACTS.launch) {
      setState('error')
      return
    }
    let live = true
    setState('loading')
    void readLaunchPosition(APP_CONTRACTS.launch, position.commitment).then(
      (read) => {
        if (!live) return
        if (read.launchId !== launch.id) {
          setState('error')
          return
        }
        const launchState =
          launch.state === LAUNCH_STATE.active
            ? 'active'
            : launch.state === LAUNCH_STATE.graduated
              ? 'graduated'
              : 'failed'
        setState({
          read,
          action: launchPositionAction({
            positionOpen: read.state === 1,
            launchState,
            deadlinePassed: Date.now() >= launch.deadline * 1000,
            redeemPreview: read.redeemPreview,
            refundPreview: read.refundPreview,
          }),
        })
      },
      () => live && setState('error'),
    )
    return () => {
      live = false
    }
  }, [position.commitment, launch.id, launch.state, launch.deadline, nonce])

  return (
    <div className="flex flex-col gap-s6 border-b border-solid border-surface3 pb-s8 last:border-b-0 last:pb-s0">
      <PositionIdentity position={position} />
      {state === 'loading' ? (
        <Text variant="body4" className="text-neutral3">Reading position and payout…</Text>
      ) : state === 'error' ? (
        <span className="flex items-center justify-between gap-s8">
          <Text variant="body4" className="text-irreversible">Position state could not be read.</Text>
          <Button variant="tertiary" size="sm" onClick={() => setNonce((value) => value + 1)}>Retry</Button>
        </span>
      ) : state.action.kind === 'redeem' || state.action.kind === 'refund' ? (
        <span className="flex flex-wrap items-center justify-between gap-s8">
          <Text variant="body4" className="text-neutral2">
            {state.action.kind === 'redeem' ? 'Token payout' : 'Refund'} ·{' '}
            <strong className="font-mono text-neutral1">
              {toPlainText(state.action.amount, state.action.kind === 'redeem' ? 18 : stakeDecimals)}{' '}
              {state.action.kind === 'redeem' ? launch.symbol : stakeSymbol}
            </strong>
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const action = state.action
              if (action.kind === 'redeem' || action.kind === 'refund') onReview(state.read, action)
            }}
          >
            {state.action.kind === 'redeem' ? 'Review redeem' : 'Review refund'}
          </Button>
        </span>
      ) : (
        <Text variant="body4" className="text-neutral3">{launchActionSentence(state.action)}</Text>
      )}
    </div>
  )
}

function SettlementDialog({
  open,
  onClose,
  sending,
  title,
  action,
  amount,
  venue,
  disclosure,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  sending: SendState
  title: string
  action: string
  amount: string
  venue: string
  disclosure: string
  onConfirm: () => void
}) {
  const steps = useMemo(() => (sending.stage ? progressFor(sending.stage) : null), [sending.stage])
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      label={title}
      modal
      dismissible={sending.stage === null}
    >
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">{title}</Text>
        {steps ? (
          <ProgressMachine steps={steps} label="Settling position" />
        ) : (
          <>
            <dl className="flex flex-col gap-s6 rounded-card border border-solid border-surface3 bg-raised p-s12">
              <div className="flex justify-between gap-s12"><dt className="text-body4 text-neutral3">Record</dt><dd className="m-s0 text-body4 text-neutral1">{venue}</dd></div>
              <div className="flex justify-between gap-s12"><dt className="text-body4 text-neutral3">Receives shielded</dt><dd className="numeric m-s0 font-mono text-body3 text-neutral1">{amount}</dd></div>
              <div className="flex justify-between gap-s12"><dt className="text-body4 text-neutral3">Stages</dt><dd className="m-s0 text-right text-body4 text-neutral2">Prepare → Prove → Sign &amp; broadcast → Pool accepts → Confirm</dd></div>
            </dl>
            <Text variant="body4" className="text-neutral3">{disclosure}</Text>
            {sending.problem ? (
              <Text variant="body4" className="text-irreversible" role="alert">
                {sending.problem} Check Activity before retrying if a transaction hash was broadcast.
              </Text>
            ) : null}
          </>
        )}
        <BlockedButton
          blocker={sending.stage ? stageLabel(sending.stage) : null}
          action={action}
          onPress={onConfirm}
        />
        {sending.stage === null ? (
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        ) : null}
      </div>
    </ResponsiveDialog>
  )
}

function marketActionSentence(action: MarketPositionAction): string {
  if (action.kind === 'lost') return 'This ticket lost. There is no payout to claim.'
  if (action.kind === 'complete') return 'This position is already settled on chain.'
  return action.kind === 'waiting' ? action.because : ''
}

function launchActionSentence(action: LaunchPositionAction): string {
  if (action.kind === 'complete') return 'This position is already settled on chain.'
  return action.kind === 'waiting' ? action.because : ''
}
