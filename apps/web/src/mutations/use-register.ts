import { useMutation } from '@tanstack/react-query'
import { REGISTRATION_STAGES, type RegistrationStage } from '@strk20/protocol/pipeline-stage'

import { getSessionSnapshot } from '@/app/session'
import { queryClient } from '@/app/query-client'
import { explorerTx } from '@/lib/format'
import { accountStatusQuery } from '@/queries/account'
import { poolConstantsQuery } from '@/queries/pool'
import { describeRegisterFailure } from './describe'
import { invalidateAccount, invalidateMoney } from './invalidate'
import {
  clearSettledPipeline,
  failPipeline,
  finishPipeline,
  getPipeline,
  reachStage,
  setPipelineSubmission,
  startPipeline,
} from './pipeline-store'
import { acquireSubmitLock, currentRoute, embeddedAccount, makeSelfSubmitRegistration, operationId } from './self-submit'

/** Gas on top of the LIVE pool fee (read at call time, never a constant) before self-pay is chosen. */
const GAS_HEADROOM_WEI = 2n * 10n ** 18n

export interface RegisterAsk {
  /** True once the backup ceremony reached `ready`. Nothing proceeds without it. */
  backedUp: boolean
  onStage?: (stage: RegistrationStage) => void
}

export type RegisterOutcome =
  | { ok: true; transactionHash: string; block: number | null }
  | { ok: false; because: string }

/** Register the viewing key with the pool. Write-once and irreversible, hence the backup gate. */
async function register(ask: RegisterAsk): Promise<RegisterOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const { address, accountKey } = session
  if (!ask.backedUp) {
    return {
      ok: false,
      because:
        'Save the recovery file first. The pool accepts a viewing key once and never replaces it, ' +
        'so registering without a way back in is the one mistake that cannot be undone.',
    }
  }

  clearSettledPipeline()
  if (getPipeline() !== null) return { ok: false, because: 'Another transaction is still running in this tab.' }

  startPipeline({
    id: operationId('register'),
    operation: 'registration',
    route: currentRoute(),
    label: 'Account registration',
    stages: REGISTRATION_STAGES,
    startedAt: Date.now(),
    cancel: null,
  })
  let lastStage: RegistrationStage = 'build'
  const onStage = (stage: RegistrationStage) => {
    lastStage = stage
    reachStage(stage)
    ask.onStage?.(stage)
  }

  try {
    const [{ registerSponsored }, { account }, status, pool] = await Promise.all([
      import('@strk20/protocol/register'),
      embeddedAccount(accountKey, address),
      queryClient.fetchQuery(accountStatusQuery(address)),
      queryClient.fetchQuery(poolConstantsQuery()),
    ])
    // The one-subsidy rule: an account that holds the live fee plus gas pays its own way; only one
    // that cannot falls back to the relayer's sponsored door. An unreadable balance selects sponsored.
    // Deliberately UNDER `feeFloor` (fee + the ~4.7 STRK gas reserve): a 10 STRK drip self-paid its
    // registration live on 2026-08-29 (~3 STRK gas charged), and the full floor would route every
    // drip account to the sponsored door — a second subsidy. Raising the drip is the fix, not this.
    const floor = pool.feeWei + GAS_HEADROOM_WEI
    const selfPays = status.strkWei !== null && status.strkWei >= floor

    const result = await registerSponsored(
      { accountKey, account: account as never, appName: 'strk20.run' },
      {
        canRegister: () => ask.backedUp,
        acquireSubmitLock,
        ...(selfPays ? { submit: makeSelfSubmitRegistration(accountKey, address) } : {}),
        onStage,
      },
    )

    if (result.ok) {
      setPipelineSubmission({
        transactionHash: result.transactionHash,
        explorerUrl: explorerTx(result.transactionHash),
        submittedBy: selfPays ? 'embedded' : 'relayer',
      })
      finishPipeline('confirmed')
      return { ok: true, transactionHash: result.transactionHash, block: result.registrationBlock ?? null }
    }
    if (result.failure.kind === 'confirmation-unknown') {
      if (result.failure.transactionHash) {
        setPipelineSubmission({
          transactionHash: result.failure.transactionHash,
          explorerUrl: explorerTx(result.failure.transactionHash),
          submittedBy: selfPays ? 'embedded' : 'relayer',
        })
      }
      finishPipeline('confirmation-unknown')
    } else {
      failPipeline(lastStage)
    }
    return { ok: false, because: describeRegisterFailure(result.failure) }
  } catch (error) {
    failPipeline(lastStage)
    return { ok: false, because: error instanceof Error ? error.message : 'The registration could not be started.' }
  }
}

export function useRegister() {
  return useMutation({
    mutationKey: ['register'],
    mutationFn: register,
    onSettled: () => {
      void invalidateAccount()
      void invalidateMoney()
    },
  })
}
