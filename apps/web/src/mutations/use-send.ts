import { useMutation } from '@tanstack/react-query'
import type { AppInvokeLeg, BridgeLeg, EarnLeg, MailLeg, SendFailure, SendKind, SendResult, SwapLeg } from '@strk20/protocol/send'
import { SEND_STAGES, type SendStage } from '@strk20/protocol/pipeline-stage'
import type { ActivitySurface } from '@strk20/protocol/transaction'

import { STRK_TOKEN } from '@strk20/protocol/constants'
import { feeFloor } from '@strk20/protocol/fee-ceiling'
import { notEnoughPublicStrk } from '@strk20/protocol/pipeline'

import { getSessionSnapshot } from '@/app/session'
import { queryClient } from '@/app/query-client'
import { explorerTx, formatWei } from '@/lib/format'
import { governanceWrites } from '@/queries/app'
import { poolConstantsQuery } from '@/queries/pool'
import { publicBalancesQuery } from '@/queries/public-balances'
import { shieldedQuery } from '@/queries/shielded'
import { describeSendFailure, failureTransactionHash, labelFor } from './describe'
import { invalidateMoney, invalidateVenues } from './invalidate'
import {
  clearSettledPipeline,
  failPipeline,
  finishPipeline,
  getPipeline,
  reachStage,
  setPipelineSubmission,
  startPipeline,
} from './pipeline-store'
import { acquireSubmitLock, currentRoute, embeddedAccount, makeSelfSubmit, operationId } from './self-submit'

export interface SendAsk {
  kind: SendKind
  recipient: string
  token: string
  symbol: string
  amount: bigint
  swap?: SwapLeg
  earn?: EarnLeg
  bridge?: BridgeLeg
  app?: AppInvokeLeg
  mail?: MailLeg
  surface?: ActivitySurface
  label?: string
  /**
   * Spend one of this account's covered transactions on this send.
   *
   * The REVIEW SHEET decides this, not the caller: it reads the live allowance and hands back
   * `true` only when the user left the toggle on AND a unit was actually there. Absent is `false`,
   * which is self-submission — the behaviour every venue had before the toggle existed.
   */
  sponsored?: boolean
  /** Optional narrator beside the pipeline store, for a button's own stage label. */
  onStage?: (stage: SendStage) => void
}

const refused = (failure: SendFailure): SendResult => ({ ok: false, stages: [], failure })

/**
 * The one call into `sendShielded` for every surface that moves shielded value. Refuse-don't-throw:
 * the result is always a `SendResult`, and every refusal below is a resolved `{ ok: false }`.
 */
async function send(ask: SendAsk): Promise<SendResult> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return refused({ kind: 'bad-input', reason: 'This browser has no account yet.' })
  }
  const { address, accountKey } = session

  if (ask.kind.startsWith('gov-')) {
    const safety = governanceWrites()
    if (!safety.enabled) return refused({ kind: 'bad-input', reason: safety.because })
  }

  // The notes come from a walk that COMPLETED. `fetchQuery` hands back the fresh cached walk (the
  // reading the user sees) and re-walks a stale or failed one — a minutes-old read never gates a spend.
  const read = await queryClient.fetchQuery(shieldedQuery(address, accountKey)).catch(() => undefined)
  if (!read || read.state !== 'walked') {
    return refused({
      kind: 'blocked-rpc-unknown',
      reason: 'Your balance could not be read, so nothing was sent. Try again in a moment.',
    })
  }

  // THE NOTE WALK ABOVE CANNOT SEE THIS. A SELF-SUBMITTED `sendShielded` pays the pool fee and the
  // gas the sequencer reserves out of PUBLIC STRK, while `shieldedShortfall` only weighs pool
  // notes. A spend that is affordable in notes and unaffordable in public STRK was therefore
  // proved, signed, and refused at `addInvokeTransaction` — the user paying attention in proving
  // time to learn it. Read both numbers and refuse here, before the proof.
  //
  // ── AND IT IS SKIPPED ENTIRELY FOR A COVERED SEND, WHICH IS THE POINT OF ONE ──────────────
  //
  // A sponsored send is submitted by the relayer, so the relayer's own approve pays `collect_fee`
  // and the relayer's wallet pays the gas. The holder needs no public STRK at all. Applying this
  // floor anyway would refuse exactly the person the covered transactions exist for — an account
  // that has just registered, holds a shielded starting balance and nothing public — and it would
  // refuse them with a sentence telling them to go and find STRK they were promised they would not
  // need.
  //
  // A read that fails does NOT refuse: the sequencer's own rejection is still the backstop, and a
  // flaky RPC must not block a spend the account can actually afford.
  const [pool, publicStrk] = await Promise.all([
    queryClient.fetchQuery(poolConstantsQuery()).catch(() => null),
    queryClient.fetchQuery(publicBalancesQuery(address, [STRK_TOKEN])).catch(() => null),
  ])
  const haveWei = publicStrk?.[STRK_TOKEN] ?? null
  if (!ask.sponsored && pool && haveWei !== null) {
    const floorWei = feeFloor(pool.feeWei, pool.gasPrices)
    if (haveWei < floorWei) {
      return refused({
        kind: 'insufficient-fee-balance',
        token: STRK_TOKEN,
        symbol: 'STRK',
        feeWei: pool.feeWei,
        haveWei,
        shortfallWei: floorWei - haveWei,
        notice: notEnoughPublicStrk(formatWei(haveWei, 18), formatWei(floorWei, 18)),
      })
    }
  }

  // One pipeline at a time. A settled row clears; a live one keeps its transaction.
  clearSettledPipeline()
  if (getPipeline() !== null) {
    return refused({ kind: 'lock-unavailable', reason: 'Another transaction is still running in this tab.' })
  }

  const label = ask.label ?? labelFor(ask.kind, ask.symbol)
  startPipeline({
    id: operationId(),
    operation: ask.kind,
    route: currentRoute(),
    label,
    stages: SEND_STAGES,
    startedAt: Date.now(),
    cancel: null,
  })
  let lastStage: SendStage = 'build'
  const onStage = (stage: SendStage) => {
    lastStage = stage
    reachStage(stage)
    ask.onStage?.(stage)
  }
  onStage('build')

  try {
    const [{ sendShielded }, { account }] = await Promise.all([
      import('@strk20/protocol/send'),
      embeddedAccount(accountKey, address),
    ])
    const outcome = await sendShielded(
      {
        accountKey,
        account: account as never,
        kind: ask.kind,
        recipient: ask.recipient,
        token: ask.token,
        symbol: ask.symbol,
        amount: ask.amount,
        // ── THE ONE LINE THAT MAKES THE COUNTER REAL ──────────────────────────────────────
        //
        // This was `'self'` unconditionally, and that single word orphaned the whole sponsorship
        // path: `preflightSend` only reads the allowance when the mode is `relayer`, so `covered`
        // could never be true, so nothing in the app could ever spend one of the three
        // transactions the shell counts down. Registration took the first; the other two were
        // unreachable by any button.
        //
        // `relayer` only on an explicit yes. The relayer refuses below twice the live fee and
        // `relayFailureFrom` offers self-submission when it does, so a broke or paused relayer
        // costs a retry rather than a dead end.
        mode: ask.sponsored ? 'relayer' : 'self',
        ...(ask.swap ? { swap: ask.swap } : {}),
        ...(ask.earn ? { earn: ask.earn } : {}),
        ...(ask.bridge ? { bridge: ask.bridge } : {}),
        ...(ask.app ? { app: ask.app } : {}),
        ...(ask.mail ? { mail: ask.mail } : {}),
        wallet: read.wallet,
      },
      { acquireSubmitLock, selfSubmit: makeSelfSubmit(accountKey, address), onStage },
    )

    if (outcome.ok) {
      setPipelineSubmission({
        transactionHash: outcome.transactionHash,
        explorerUrl: explorerTx(outcome.transactionHash),
        submittedBy: outcome.submittedBy === 'relayer' ? 'relayer' : 'embedded',
      })
      finishPipeline('confirmed')
      return outcome
    }

    const hash = failureTransactionHash(outcome.failure)
    if (hash) setPipelineSubmission({ transactionHash: hash, explorerUrl: explorerTx(hash), submittedBy: 'embedded' })
    // `confirmation-unknown` is not a failure: it may have landed.
    if (outcome.failure.kind === 'confirmation-unknown') finishPipeline('confirmation-unknown')
    else failPipeline(lastStage)
    return outcome
  } catch (error) {
    // What the pipeline does not model — a chunk that would not load. Reported, never swallowed:
    // a send that vanished silently is one the user retries into a double-spend.
    failPipeline(lastStage)
    return refused({ kind: 'bad-input', reason: error instanceof Error ? error.message : 'The send could not be started.' })
  }
}

export function useSend() {
  return useMutation({
    mutationKey: ['send'],
    mutationFn: send,
    onSettled: (result) => {
      void invalidateMoney()
      if (result?.ok && result && 'submittedBy' in result) void invalidateVenues()
    },
  })
}

/** One sentence for a failed result, or `null`. */
export function sendProblem(result: SendResult | undefined): string | null {
  return result && !result.ok ? describeSendFailure(result.failure) : null
}
