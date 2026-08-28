// `create_house`, `propose` and `create_launch` are DIRECT account calls that live outside
// `privacy_invoke` (the founder is a commitment, so sponsoring gives the relayer nothing to sweep):
// the relayer signs when its allowlist lets it, and this browser's key signs otherwise. The CALLER's
// address is on the transaction; the founder's CLAIM is the bearer secret the caller stores.
import type { SubmitResponseBody } from '@strk20/protocol/relayer-wire'

import { queryClient } from '@/app/query-client'
import { explorerTx } from '@/lib/format'
import { relayerPost } from '@/lib/relayer'
import { accountStatusQuery } from '@/queries/account'
import {
  clearSettledPipeline,
  failPipeline,
  finishPipeline,
  getPipeline,
  reachStage,
  setPipelineSubmission,
  startPipeline,
  type PipelineSubmitter,
} from './pipeline-store'
import { currentRoute, embeddedAccount, operationId, type SubmitCall } from './self-submit'

export type DirectOutcome =
  | { ok: true; transactionHash: string }
  /** Nothing was broadcast. Safe to retry. */
  | { ok: false; because: string; transactionHash?: undefined }
  /** Broadcast, confirmation unknown: it may have landed. Never retried blindly. */
  | { ok: false; because: string; transactionHash: string }

const DIRECT_STAGES = ['build', 'relay', 'confirmed'] as const

export const hex = (value: bigint | number): string => `0x${value.toString(16)}`

async function waitFor(hash: string): Promise<void> {
  const { withFallback } = await import('@strk20/protocol/rpc')
  await withFallback((p) => p.waitForTransaction(hash))
}

/** Once a hash exists the call is on the wire: a failed wait is "unknown", never "try again". */
async function confirm(hash: string, by: PipelineSubmitter): Promise<DirectOutcome> {
  setPipelineSubmission({ transactionHash: hash, explorerUrl: explorerTx(hash), submittedBy: by })
  try {
    await waitFor(hash)
    reachStage('confirmed')
    finishPipeline('confirmed')
    return { ok: true, transactionHash: hash }
  } catch {
    finishPipeline('confirmation-unknown')
    return {
      ok: false,
      transactionHash: hash,
      because: `Confirmation is unknown: the transaction ${hash} was broadcast and it may have landed. Check the explorer before trying again.`,
    }
  }
}

/** Relayer first (sponsored), the embedded key when it refuses — only if that key can actually pay. */
export async function invokeSponsoredOrDirect(
  accountKey: string,
  address: string,
  call: SubmitCall,
  label: string,
): Promise<DirectOutcome> {
  // One pipeline at a time, like every send: a second signer racing a live one double-spends gas.
  clearSettledPipeline()
  if (getPipeline() !== null) return { ok: false, because: 'Another transaction is still running in this tab.' }
  startPipeline({
    id: operationId('direct'),
    operation: call.entrypoint,
    route: currentRoute(),
    label,
    stages: DIRECT_STAGES,
    startedAt: Date.now(),
    cancel: null,
  })
  reachStage('build')

  let relayerBecause: string
  let body: SubmitResponseBody | null = null
  try {
    body = await relayerPost<SubmitResponseBody>('/api/submit', { calls: [call] })
    relayerBecause = body.notice ?? body.error ?? 'the relayer answered without a transaction'
  } catch (error) {
    relayerBecause = error instanceof Error ? error.message : 'the relayer could not be reached'
  }
  if (body?.transactionHash) {
    reachStage('relay')
    return confirm(body.transactionHash, 'relayer')
  }

  const status = await queryClient.fetchQuery(accountStatusQuery(address))
  if (status.rung === 'unfunded' || status.rung === 'undeployed' || status.rung === 'unknown') {
    const fix =
      status.rung === 'unfunded'
        ? 'this address holds no STRK for gas — fund it from the wallet screen, or try again when the relayer is back'
        : status.rung === 'undeployed'
          ? 'this account is not deployed yet — the wallet screen has the deploy step'
          : (status.because ?? 'the account could not be read')
    failPipeline('build')
    return { ok: false, because: `The sponsored path failed (${relayerBecause}), and signing it yourself is not possible yet: ${fix}.` }
  }

  let hash: string
  try {
    const { account } = await embeddedAccount(accountKey, address)
    hash = (await account.execute([call] as never)).transaction_hash
  } catch (error) {
    // Refused before any hash came back: the sequencer never accepted it.
    failPipeline('relay')
    const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
    return { ok: false, because: `The transaction was not accepted${detail}` }
  }
  reachStage('relay')
  return confirm(hash, 'embedded')
}
