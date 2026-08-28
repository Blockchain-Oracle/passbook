import { useMutation } from '@tanstack/react-query'
import { RELAYER_PATHS } from '@strk20/protocol/relayer-wire'

import { getSessionSnapshot } from '@/app/session'
import { RelayerError, relayerPost } from '@/lib/relayer'
import { invalidateAccount } from './invalidate'

export type DripOutcome =
  | { ok: true; txHash: string; amountWei: bigint }
  | { ok: false; because: string; retryable: boolean }

/** One starter drip of public STRK. The faucet is opt-in on the relayer; 404 means it is off. */
async function drip(): Promise<DripOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address) {
    return { ok: false, because: 'This browser has no account yet.', retryable: false }
  }
  try {
    const body = await relayerPost<{ txHash?: unknown; amountWei?: unknown }>(
      RELAYER_PATHS.faucet,
      { address: session.address },
      AbortSignal.timeout(45_000),
    )
    if (typeof body.txHash !== 'string' || typeof body.amountWei !== 'string') {
      return { ok: false, because: 'The relayer reported success without a transaction.', retryable: true }
    }
    return { ok: true, txHash: body.txHash, amountWei: BigInt(body.amountWei) }
  } catch (error) {
    if (error instanceof RelayerError) {
      if (error.status === 404) {
        return {
          ok: false,
          because: 'This deployment does not hand out starter STRK. Fund this account from any Starknet wallet.',
          retryable: false,
        }
      }
      // 400/429 carry the relayer's own sentence (the caller's cap); 5xx is transient.
      return {
        ok: false,
        because: error.message.startsWith('relayer answered') ? `The relayer answered ${error.status}.` : error.message,
        retryable: error.status >= 500,
      }
    }
    return { ok: false, because: `Could not reach the relayer to send starter STRK: ${String(error)}`, retryable: true }
  }
}

export function useFaucet() {
  return useMutation({
    mutationKey: ['faucet'],
    mutationFn: drip,
    onSettled: () => void invalidateAccount(),
  })
}
