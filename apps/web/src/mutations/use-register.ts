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
    // SPONSORED IS THE DEFAULT DOOR; self-pay is the exception for an account that arrived funded.
    //
    // This test used to enforce the one-subsidy rule — sponsorship was the fallback for accounts too
    // poor to pay. That is inverted now: the drip buys a deploy and nothing more, so a dripped
    // account holds ~2 STRK, falls under this floor, and takes the sponsored door by design. What
    // still self-pays is the case the check was always really about: someone who funded this
    // address from their own wallet or an exchange, who does not need our budget spent on them.
    //
    // The threshold stays deliberately UNDER `feeFloor` (fee + the full gas BOUND). The bound is
    // what a sender must hold; ~3 STRK is what registration is actually charged (measured live,
    // 2026-08-29). Testing against the bound would push funded accounts onto the sponsored door
    // over a margin they were never going to spend. An unreadable balance selects sponsored.
    const floor = pool.feeWei + GAS_HEADROOM_WEI
    const selfPays = status.strkWei !== null && status.strkWei >= floor

    const result = await registerSponsored(
      {
        accountKey,
        account: account as never,
        appName: 'strk20.run',
        // ── NO STARTER, ON EITHER DOOR ────────────────────────────────────────────────────
        //
        // A registration that also deposits is a deposit whose PAYER (the relayer) is not the
        // note's OWNER (the account being registered), inside the very transaction that registers
        // that owner. `evidence/tx-a-attempt-1-reverted.json` and the funding-model note both say
        // that shape was never verified on chain, and it does not work: the pool answers
        // `Result::unwrap failed.` and the transaction is thrown away before `collect_fee` runs.
        //
        // A bare zero-deposit registration IS proven — `evidence/sponsored-registration.json`,
        // block 13805277, this same relayer. So registration takes the path that lands, and the
        // starter is the separate deposit that note already named as the fallback: `useStarterDrip`,
        // the ladder's last rung. It does NOT spend one of the three — a drip is principal we give
        // away, not a transaction we cover, and the wire's `drip` flag is what keeps the two apart.
      },
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
    // AWAITED, so the mutation does not settle until `account-status` has been refetched. Without
    // it the gate closes on the old rung and the shell flashes a red "not registered" banner at
    // somebody who just registered — with a button sending them back into the gate they finished.
    onSettled: async () => {
      await invalidateAccount()
      void invalidateMoney()
    },
  })
}
