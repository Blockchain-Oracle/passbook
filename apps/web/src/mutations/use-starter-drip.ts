import { useMutation } from '@tanstack/react-query'
import type { StarterFailure } from '@strk20/protocol/starter'
import { REGISTRATION_STAGES, type RegistrationStage } from '@strk20/protocol/pipeline-stage'

import { getSessionSnapshot } from '@/app/session'
import { queryClient } from '@/app/query-client'
import { explorerTx } from '@/lib/format'
import { faucetOfferQuery } from '@/queries/pool'
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
import { acquireSubmitLock, currentRoute, embeddedAccount, operationId } from './self-submit'

export interface StarterDripAsk {
  onStage?: (stage: RegistrationStage) => void
}

export type StarterDripOutcome =
  | { ok: true; transactionHash: string; amountWei: bigint }
  | { ok: false; because: string }

/**
 * Every failure in a sentence. EXHAUSTIVE WITH NO DEFAULT ARM, like `describeRegisterFailure`: a
 * new `StarterFailure` kind should be a build error here rather than a raw token on a screen.
 */
export function describeStarterFailure(failure: StarterFailure): string {
  switch (failure.kind) {
    case 'not-registered':
      return 'Register this account first — a shielded note has to belong to a registered key.'
    case 'already-claimed':
      return failure.notice || 'This account already has its starting balance.'
    case 'unavailable':
      return failure.notice || 'Starting balances are not being handed out right now.'
    case 'pool-paused':
      return 'The pool is paused by its operator. This can be claimed once it resumes.'
    case 'proof-expired':
      return `The proof was built at block ${failure.provedAtBlock} and the chain is at ${failure.currentBlock}, past its ${failure.validityBlocks}-block window. Nothing was spent — try again.`
    case 'prover-failed':
      return `The proof could not be built: ${failure.reason}`
    case 'lock-unavailable':
      return failure.reason
    case 'bad-input':
      return failure.reason
    case 'blocked-rpc-unknown':
      return `The chain could not be read: ${failure.reason}`
    case 'relay-refused':
      return `The relayer refused this: ${failure.reason}`
    case 'reverted':
      return `The pool refused this deposit: ${failure.message}`
    case 'confirmation-unknown':
      // The claim is NOT released here — the relayer watches its own hash and gives it back only
      // on a receipt that says REVERTED. Telling someone to retry could mint a second note.
      return 'This may have landed. Check your balance in a minute rather than trying again.'
  }
}

/**
 * Claims this account's starting balance: the relayer's public STRK becomes the account's first
 * shielded note.
 *
 * ── IT IS A GIFT, SO IT NEVER FALLS BACK TO SELF-PAY ──────────────────────────────────────
 *
 * `useRegister` picks between the relayer and the user's own key depending on what they hold. This
 * one has no such branch: an account paying for its own starting balance is just a shield, and the
 * shield door already exists. If the relayer will not pay, there is nothing to offer — the failure
 * says so and the screen stops asking.
 */
async function claimStarter(ask: StarterDripAsk): Promise<StarterDripOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const { address, accountKey } = session

  clearSettledPipeline()
  if (getPipeline() !== null) return { ok: false, because: 'Another transaction is still running in this tab.' }

  // The amount is the RELAYER'S to state — it is paying — so it is read, never assumed here.
  const offer = await queryClient.fetchQuery(faucetOfferQuery(address))
  if (!offer?.starter) return { ok: false, because: 'Starting balances are not being handed out right now.' }
  if (offer.starter.claimed) return { ok: false, because: 'This account already has its starting balance.' }
  const amountWei = offer.starter.wei

  startPipeline({
    id: operationId('starter'),
    operation: 'starter',
    route: currentRoute(),
    label: 'Starting balance',
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
    const [{ runStarterDrip }, { account }] = await Promise.all([
      import('@strk20/protocol/starter'),
      embeddedAccount(accountKey, address),
    ])
    const result = await runStarterDrip(
      { accountKey, account: account as never, amountWei },
      { acquireSubmitLock, onStage },
    )
    if (result.ok) {
      setPipelineSubmission({
        transactionHash: result.transactionHash,
        explorerUrl: explorerTx(result.transactionHash),
        submittedBy: 'relayer',
      })
      finishPipeline('confirmed')
      return { ok: true, transactionHash: result.transactionHash, amountWei: result.amountWei }
    }
    if (result.failure.kind === 'confirmation-unknown') {
      if (result.failure.transactionHash) {
        setPipelineSubmission({
          transactionHash: result.failure.transactionHash,
          explorerUrl: explorerTx(result.failure.transactionHash),
          submittedBy: 'relayer',
        })
      }
      finishPipeline('confirmation-unknown')
    } else {
      failPipeline(lastStage)
    }
    return { ok: false, because: describeStarterFailure(result.failure) }
  } catch (error) {
    failPipeline(lastStage)
    return { ok: false, because: error instanceof Error ? error.message : 'The starting balance could not be claimed.' }
  }
}

export function useStarterDrip() {
  return useMutation({
    mutationKey: ['starter-drip'],
    mutationFn: claimStarter,
    onSettled: async () => {
      // The claim state moved whichever way this went, so the offer must be re-read before any
      // screen decides to show it again.
      await queryClient.invalidateQueries({ queryKey: ['relayer', 'faucet-claim'] })
      await invalidateMoney()
      void invalidateAccount()
    },
  })
}
