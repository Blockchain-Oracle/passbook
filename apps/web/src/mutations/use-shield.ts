import { useMutation } from '@tanstack/react-query'
import { SEND_STAGES, type SendStage } from '@strk20/protocol/pipeline-stage'
import type { ShieldResult } from '@strk20/protocol/shield'

import { getSessionSnapshot } from '@/app/session'
import { explorerTx } from '@/lib/format'
import { describeShieldFailure } from './describe'
import { invalidateMoney } from './invalidate'
import {
  clearSettledPipeline,
  failPipeline,
  finishPipeline,
  getPipeline,
  reachStage,
  setPipelineSubmission,
  startPipeline,
} from './pipeline-store'
import { currentRoute, embeddedAccount, makeSelfSubmit, operationId } from './self-submit'

export interface ShieldAsk {
  token: string
  symbol: string
  amount: bigint
  /** Public balances the caller already read. `shield.ts` does not read them itself. */
  publicTokenWei: bigint
  publicStrkWei: bigint
  onStage?: (stage: SendStage) => void
}

const refused = (reason: string): ShieldResult => ({ ok: false, stages: [], failure: { kind: 'bad-input', reason } })

/** Public → shielded. Always self-submitted: the embedded account deposits its own public funds. */
async function shield(ask: ShieldAsk): Promise<ShieldResult> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return refused('This browser has no unlocked strk20.run account.')
  }
  const { address, accountKey } = session

  clearSettledPipeline()
  if (getPipeline() !== null) return refused('Another transaction is still running in this tab.')

  startPipeline({
    id: operationId('shield'),
    operation: 'shield',
    route: currentRoute(),
    label: `Shield ${ask.symbol}`,
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
    const [{ shieldPublic }, { account }] = await Promise.all([
      import('@strk20/protocol/shield'),
      embeddedAccount(accountKey, address),
    ])
    const outcome = await shieldPublic(
      {
        accountKey,
        account: account as never,
        token: ask.token,
        symbol: ask.symbol,
        amount: ask.amount,
        publicTokenWei: ask.publicTokenWei,
        publicStrkWei: ask.publicStrkWei,
      },
      { selfSubmit: makeSelfSubmit(accountKey, address), onStage },
    )

    if (outcome.ok) {
      setPipelineSubmission({
        transactionHash: outcome.transactionHash,
        explorerUrl: explorerTx(outcome.transactionHash),
        submittedBy: 'embedded',
      })
      finishPipeline('confirmed')
      return outcome
    }

    const hash =
      outcome.failure.kind === 'confirmation-unknown' || outcome.failure.kind === 'reverted'
        ? outcome.failure.transactionHash || null
        : null
    if (hash) setPipelineSubmission({ transactionHash: hash, explorerUrl: explorerTx(hash), submittedBy: 'embedded' })
    if (outcome.failure.kind === 'confirmation-unknown') finishPipeline('confirmation-unknown')
    else failPipeline(lastStage)
    return outcome
  } catch (error) {
    failPipeline(lastStage)
    return {
      ok: false,
      stages: [lastStage],
      failure: { kind: 'bad-input', reason: error instanceof Error ? error.message : 'Shielding could not be started.' },
    }
  }
}

export function useShield() {
  return useMutation({
    mutationKey: ['shield'],
    mutationFn: shield,
    onSettled: () => void invalidateMoney(),
  })
}

export function shieldProblem(result: ShieldResult | undefined): string | null {
  return result && !result.ok ? describeShieldFailure(result.failure) : null
}
