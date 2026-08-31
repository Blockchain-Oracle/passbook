// `create_house`, `propose` and `create_launch` are DIRECT account calls that live outside
// `privacy_invoke` (the founder is a commitment, so there is nothing for the relayer to sweep).
//
// ── THIS ACCOUNT SIGNS AND PAYS, UNLESS THE USER SPENDS ONE OF THEIR THREE ────────────────
//
// It used to be the other way round: the browser POSTed the call to the relayer with no flags at
// all, the relayer signed it and paid the gas, and nothing anywhere counted it against the user or
// told them it had happened. Creating a House, opening a proposal and launching a token were free
// to the person doing them and billed to us, forever, for everybody. That was never agreed — and
// it was not keeper infrastructure either, whatever the allowlist constant was called: the market
// keeper and the Teller sign through the signer queue directly and never touch `/submit`.
//
// So the default is the ordinary one, the same as every other venue: you sign, you pay. The
// sponsored path is a choice the review screen offers while units remain, and taking it spends one
// and shows up in the counter like any other.
import type { SubmitResponseBody } from '@strk20/protocol/relayer-wire'

import { queryClient } from '@/app/query-client'
import { explorerTx } from '@/lib/format'
import { RelayerError, relayerPost } from '@/lib/relayer'
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

/**
 * Asks the relayer to submit this call as one of the account's covered transactions.
 *
 * `account` + `covered` are what make it METERED. Without them `/submit` signs it against the
 * IP-keyed send budget and charges the user nothing — which is exactly the free ride this file no
 * longer takes. A refusal is REPORTED rather than quietly self-signed: the user chose not to pay
 * for this one, and spending their gas anyway because our end said no is not our call to make.
 */
async function relayCovered(address: string, call: SubmitCall): Promise<DirectOutcome> {
  let body: SubmitResponseBody | null = null
  let because: string
  try {
    body = await relayerPost<SubmitResponseBody>('/api/submit', {
      calls: [call],
      account: address,
      covered: true,
    })
    because = body.notice ?? body.error ?? 'the relayer answered without a transaction'
  } catch (error) {
    // The relayer's own sentence when it wrote one — `allowance-spent` and `relayer-down` both do.
    because =
      error instanceof RelayerError
        ? (error.notice ?? error.message)
        : error instanceof Error
          ? error.message
          : 'the relayer could not be reached'
  }
  if (body?.transactionHash) {
    reachStage('relay')
    return confirm(body.transactionHash, 'relayer')
  }
  failPipeline('build')
  return { ok: false, because: `${because} Turn off the sponsored option to sign this yourself.` }
}

/** Signs with this browser's key, once the account is in a state that can actually pay. */
async function selfSign(accountKey: string, address: string, call: SubmitCall): Promise<DirectOutcome> {
  const status = await queryClient.fetchQuery(accountStatusQuery(address))
  if (status.rung === 'unfunded' || status.rung === 'undeployed' || status.rung === 'unknown') {
    const fix =
      status.rung === 'unfunded'
        ? 'this address holds no STRK for gas — fund it from the wallet screen'
        : status.rung === 'undeployed'
          ? 'this account is not deployed yet — the wallet screen has the deploy step'
          : (status.because ?? 'the account could not be read')
    failPipeline('build')
    return { ok: false, because: `This transaction is sent by your own account, and it cannot pay for it yet: ${fix}.` }
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

/** This browser's key signs and pays — unless `sponsored`, which spends one covered transaction. */
export async function invokeSponsoredOrDirect(
  accountKey: string,
  address: string,
  call: SubmitCall,
  label: string,
  sponsored = false,
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

  return sponsored ? relayCovered(address, call) : selfSign(accountKey, address, call)
}
