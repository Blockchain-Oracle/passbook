import { useCallback, useState } from 'react'

import { recordLocal } from '@strk20/protocol/activity-store'
import type { SendStage } from '@strk20/protocol/pipeline-stage'
import type { ShieldFailure, ShieldResult } from '@strk20/protocol/shield'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import {
  clearPipeline,
  failPipeline,
  finishPipeline,
  getPipeline,
  reachStage,
  setPipelineSubmission,
  startPipeline,
} from './pipeline-store'
import type { SessionState } from './session'
import { makeSelfSubmit } from './submit'

export interface ShieldAsk {
  token: string
  symbol: string
  amount: bigint
  publicTokenWei: bigint
  publicStrkWei: bigint
}

export function useShield(
  session: Extract<SessionState, { status: 'ready' }> | null,
  onConfirmed: () => void,
) {
  const [stage, setStage] = useState<SendStage | null>(null)
  const [result, setResult] = useState<ShieldResult | null>(null)

  const shield = useCallback(
    async (ask: ShieldAsk): Promise<ShieldResult> => {
      const refused = (reason: string): ShieldResult => {
        const outcome: ShieldResult = {
          ok: false,
          stages: [],
          failure: { kind: 'bad-input', reason },
        }
        setResult(outcome)
        return outcome
      }
      if (!session) return refused('This browser has no unlocked Passbook account.')

      const existing = getPipeline()
      if (existing?.terminal) clearPipeline()
      if (getPipeline()) return refused('Another transaction is still running in this tab.')

      const id = globalThis.crypto?.randomUUID?.() ?? `shield:${Date.now()}`
      const startedAt = Date.now()
      const label = `Shield ${ask.symbol}`
      setStage('build')
      setResult(null)
      startPipeline({
        id,
        operation: 'shield',
        route: typeof location === 'undefined' ? '/wallet' : location.pathname,
        label,
        stages: ['build', 'prove', 'relay', 'mature', 'confirmed'],
        startedAt,
        cancel: null,
      })

      const recordStage = (next: SendStage, transactionHash: string | null = null) => {
        recordLocal({
          id,
          chain: { state: 'optimistic', submittedAt: startedAt, stage: next, transactionHash },
          surface: 'wallet',
          label,
        })
      }
      let lastStage: SendStage = 'build'
      const onStage = (next: SendStage) => {
        lastStage = next
        setStage(next)
        reachStage(next)
        recordStage(next)
      }

      try {
        const [{ shieldPublic }, { Account, RpcProvider }, { NET }] = await Promise.all([
          import('@strk20/protocol/shield'),
          import('starknet'),
          import('@strk20/protocol/constants'),
        ])
        const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
        const account = new Account({ provider, address: session.address, signer: session.accountKey })
        const outcome = await shieldPublic(
          {
            accountKey: session.accountKey,
            account: account as never,
            ...ask,
          },
          {
            selfSubmit: makeSelfSubmit(session.accountKey, session.address),
            onStage,
          },
        )
        setStage(null)
        setResult(outcome)

        if (outcome.ok) {
          setPipelineSubmission({
            transactionHash: outcome.transactionHash,
            explorerUrl: voyagerTxUrl(outcome.transactionHash),
            submittedBy: 'embedded',
          })
          finishPipeline('confirmed')
          recordStage('confirmed', outcome.transactionHash)
          onConfirmed()
          return outcome
        }

        const transactionHash = hashFromFailure(outcome.failure)
        if (transactionHash !== null) {
          setPipelineSubmission({
            transactionHash,
            explorerUrl: voyagerTxUrl(transactionHash),
            submittedBy: 'embedded',
          })
        }
        if (outcome.failure.kind === 'confirmation-unknown') finishPipeline('confirmation-unknown')
        else failPipeline(lastStage)
        recordLocal({
          id,
          chain: {
            state: 'failed',
            retryable: transactionHash === null,
            reason: describeShieldFailure(outcome.failure),
            transactionHash,
            submitted: transactionHash !== null,
          },
          surface: 'wallet',
          label,
        })
        return outcome
      } catch (error) {
        const outcome: ShieldResult = {
          ok: false,
          stages: [lastStage],
          failure: {
            kind: 'bad-input',
            reason: error instanceof Error ? error.message : 'Shielding could not be started.',
          },
        }
        setStage(null)
        setResult(outcome)
        failPipeline(lastStage)
        return outcome
      }
    },
    [onConfirmed, session],
  )

  return {
    stage,
    result,
    problem: result?.ok === false ? describeShieldFailure(result.failure) : null,
    shield,
    reset: () => setResult(null),
  }
}

export function describeShieldFailure(failure: ShieldFailure): string {
  switch (failure.kind) {
    case 'bad-input':
    case 'blocked-rpc-unknown':
    case 'prover-failed':
    case 'submit-failed':
    case 'confirmation-unknown':
      return failure.reason
    case 'pool-paused':
      return 'The shielded pool is paused, so nothing was submitted.'
    case 'pool-upgraded':
      return 'The pool class changed. This build will not prove against an unverified contract.'
    case 'insufficient-public-token':
      return `Not enough public ${failure.symbol} at the embedded Passbook address.`
    case 'insufficient-public-strk':
      return 'Not enough public STRK at the embedded Passbook address for the pool fee.'
    case 'proof-expired':
      return 'The proof expired before submission. Refresh the balances and try again.'
    case 'reverted':
      return `The shield transaction reverted: ${failure.message}`
  }
}

function hashFromFailure(failure: ShieldFailure): string | null {
  return failure.kind === 'confirmation-unknown' || failure.kind === 'reverted'
    ? failure.transactionHash || null
    : null
}
