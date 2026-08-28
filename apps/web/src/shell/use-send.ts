//
// The one call into `sendShielded`, for every surface that moves value.
//
// ── WHY ONE HOOK AND NOT ONE PER SURFACE ─────────────────────────────────────────────────
//
// A transfer, a withdraw, a swap and a crossing differ by a `kind` and, for the last two, one
// extra leg. Everything else — the account, the wallet data, the self-submit executor, the stage
// reporting, the optimistic row — is identical, and it is the part that is easy to get subtly
// wrong. Four copies of it would be four chances for one surface to forget the executor and
// report a send nobody made.
//
// ── `selfSubmit` DEFAULTS TO REFUSING, AND THAT IS WHY THIS FILE HAS TO EXIST ─────────────
//
// `send.ts` ships this default:
//
//     'no self-submit executor was supplied, so nothing can sign from this wallet'
//
// The protocol package holds no key. Supplying `makeSelfSubmit` is the whole job of the shell,
// and until this hook there was no caller of `sendShielded` in the browser at all.
//
// ── THE WALLET DATA COMES OFF THE WALK, NOT A SECOND READ ────────────────────────────────
//
// `DiscoveryResult`'s `walked` arm carries `wallet`, described in `discovery.ts` as "the 1.16
// seam: exactly what `planSend` takes as caller-supplied wallet data". So the balance the user is
// looking at and the notes this send spends are the same reading — a send planned against a
// fresher or staler walk than the screen is a send whose numbers do not match what was agreed to.
//
import { useCallback, useState } from 'react'
import type { DiscoveryResult } from '@strk20/protocol/discovery'
import type { AppInvokeLeg, BridgeLeg, SendFailure, SendResult, SwapLeg } from '@strk20/protocol/send'
import type { SendStage } from '@strk20/protocol/pipeline-stage'

import { makeSelfSubmit } from './submit'

export interface SendAsk {
  kind:
    | 'transfer'
    | 'withdraw'
    | 'swap'
    | 'bridge'
    // The app-contract kinds (Wave 3's pipeline, finally with surfaces on it). Funding kinds
    // spend into our contracts; settling kinds mint the payout notes back.
    | 'market-create'
    | 'market-bet'
    | 'market-claim'
    | 'market-cashout'
    | 'launch-buy'
    | 'launch-redeem'
    | 'launch-refund'
    // The governance kinds (docs/governance.md §11.1): two ride ComputeAndInvoke, and the
    // planner enforces each kind's shape — value-less join, zero-legal ballot, settling reclaims.
    | 'gov-ballot'
    | 'gov-join'
    | 'gov-delegate'
    | 'gov-fund'
    | 'gov-reclaim'
    | 'gov-revoke'
  recipient: string
  token: string
  symbol: string
  amount: bigint
  /** Required when `kind` is `'swap'`. `planSend` refuses a swap without one. */
  swap?: SwapLeg
  /** Required when `kind` is `'bridge'`. `planSend` refuses a crossing without one. */
  bridge?: BridgeLeg
  /** Required on every app kind, refused on every other — `planSend` enforces both directions. */
  app?: AppInvokeLeg
}

export interface SendState {
  /** Which stage is running, or `null` when nothing is in flight. */
  stage: SendStage | null
  /** The last outcome, success or failure. Kept until the next attempt starts. */
  result: SendResult | null
  /** One sentence for the last failure, ready to render. `null` when there was none. */
  problem: string | null
  send: (ask: SendAsk) => Promise<SendResult>
  /** Clear the last outcome — for a surface reopening a form after a failure. */
  reset: () => void
}

export function useSend(read: DiscoveryResult | null, session: {
  address: string
  accountKey: string
} | null): SendState {
  const [stage, setStage] = useState<SendStage | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)

  const reset = useCallback(() => setResult(null), [])

  const send = useCallback(
    async (ask: SendAsk): Promise<SendResult> => {
      const refuse = (failure: SendFailure): SendResult => {
        const outcome: SendResult = { ok: false, stages: [], failure }
        setResult(outcome)
        setStage(null)
        return outcome
      }

      if (!session) {
        return refuse({ kind: 'bad-input', reason: 'This browser has no account yet.' })
      }
      // A send needs the notes, and the notes come from a walk that COMPLETED. Planning against a
      // failed walk would spend whatever subset happened to arrive, which is a different send from
      // the one on screen.
      if (read === null || read.state !== 'walked') {
        return refuse({
          kind: 'blocked-rpc-unknown',
          reason: 'Your balance could not be read, so nothing was sent. Try again in a moment.',
        })
      }

      setResult(null)
      setStage('build')

      try {
        const [{ sendShielded }, { Account, RpcProvider }, { NET }] = await Promise.all([
          import('@strk20/protocol/send'),
          import('starknet'),
          import('@strk20/protocol/constants'),
        ])

        const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
        const account = new Account({ provider, address: session.address, signer: session.accountKey })

        const outcome = await sendShielded(
          {
            accountKey: session.accountKey,
            // The SDK's user shape. `sendShielded` reads `.address` off it and the signer is what
            // the prover's pre-flight probe answers with.
            account: account as never,
            kind: ask.kind,
            recipient: ask.recipient,
            token: ask.token,
            symbol: ask.symbol,
            amount: ask.amount,
            // SELF, ALWAYS, for now. Relayer mode needs a hosted relayer holding twice the live
            // pool fee, and `fundingFloor` refuses below it — so offering it here would be an
            // option that cannot work. The account pays its own fee instead, which it can.
            mode: 'self',
            ...(ask.swap ? { swap: ask.swap } : {}),
            ...(ask.bridge ? { bridge: ask.bridge } : {}),
            ...(ask.app ? { app: ask.app } : {}),
            wallet: read.wallet,
          },
          {
            selfSubmit: makeSelfSubmit(session.accountKey, session.address),
            onStage: setStage,
          },
        )

        setResult(outcome)
        setStage(null)
        return outcome
      } catch (error) {
        // Everything `sendShielded` models arrives as a typed failure; this catches what it
        // cannot — a chunk that would not load, an account constructor that threw. Reported as a
        // refusal rather than swallowed, because a send that vanished silently is one the user
        // will retry into a double-spend.
        return refuse({
          kind: 'bad-input',
          reason: error instanceof Error ? error.message : 'The send could not be started.',
        })
      }
    },
    [read, session?.address, session?.accountKey],
  )

  return { stage, result, problem: result && !result.ok ? describe(result.failure) : null, send, reset }
}

/**
 * One sentence per failure kind.
 *
 * Several arms of the union already carry authored copy — `notice` on the balance failures, and
 * `door.message` on an unregistered recipient — and those are used verbatim rather than
 * paraphrased. A second sentence for the same fact is a second sentence to keep in step.
 */
function describe(failure: SendFailure): string {
  switch (failure.kind) {
    case 'unregistered-recipient':
      return failure.door.message
    case 'insufficient-balance':
    case 'insufficient-fee-balance':
      return failure.notice
    case 'bad-input':
      return failure.reason
    case 'blocked-rpc-unknown':
      return `The chain could not be read, so nothing was sent: ${failure.reason}`
    case 'lock-unavailable':
      return 'Another tab is in the middle of a send. Finish or close it, then try again.'
    case 'pool-paused':
      return 'The pool is paused, so nothing can move right now. Nothing was spent.'
    case 'pool-upgraded':
      return 'The pool contract changed since this app was built, so nothing was submitted.'
    default:
      // Every remaining arm carries a `reason`; the union is exhaustive above for the ones that
      // do not. A kind with neither is a kind nobody can render, which is worth saying out loud.
      return (failure as { reason?: string }).reason ?? `The send stopped at \`${failure.kind}\`.`
  }
}
