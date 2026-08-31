import { useMutation } from '@tanstack/react-query'
import { RELAYER_PATHS } from '@strk20/protocol/relayer-wire'

import { getSessionSnapshot } from '@/app/session'
import { queryClient } from '@/app/query-client'
import { RelayerError, relayerPost } from '@/lib/relayer'
import { invalidateAccount, invalidateMoney } from './invalidate'

export interface StarterDripAsk {
  /** Unused; kept so callers can pass `{}` the way every other mutation here is called. */
  readonly _?: never
}

export type StarterDripOutcome = { ok: true; transactionHash: string } | { ok: false; because: string }

/**
 * Claims this account's shielded starting balance.
 *
 * ── THE BROWSER DOES NOT BUILD THIS TRANSACTION, AND THAT IS THE WHOLE FIX ────────────────
 *
 * It used to. This file proved a deposit with the USER's key and asked the relayer to sign and pay
 * for it, and the pool refused it twice on mainnet — a deposit is paid by whoever PROVED it, and
 * the account being given 3 STRK held 1.94. The proof asserted it could pay; the pool checked.
 * (0x671add5d…, and 0x2ef58d17…42cb before it.)
 *
 * So the relayer proves it with its own key, out of its own balance, and creates the note in this
 * account's name. Nothing here signs anything: one POST, one hash back. All the deleted machinery —
 * the client pipeline, the `drip` wire flag, the meter it routed around — went with it.
 */
async function claimStarter(): Promise<StarterDripOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  try {
    const body = await relayerPost<{ transactionHash?: unknown }>(
      RELAYER_PATHS.starter,
      { address: session.address },
      // Proving happens on the relayer and is the slow part; a shield takes tens of seconds.
      AbortSignal.timeout(180_000),
    )
    if (typeof body.transactionHash !== 'string') {
      return { ok: false, because: 'The relayer reported success without a transaction.' }
    }
    return { ok: true, transactionHash: body.transactionHash }
  } catch (error) {
    if (error instanceof RelayerError) {
      if (error.status === 404) return { ok: false, because: 'This deployment does not hand out starting balances.' }
      // Every other status carries the relayer's own sentence. It is written for a person and is
      // never a chain payload — see `relayer/src/starter.ts`, where each refusal is authored.
      return {
        ok: false,
        because: error.message.startsWith('relayer answered')
          ? 'The starting balance could not be sent just now. Try again in a moment.'
          : error.message,
      }
    }
    return { ok: false, because: 'The relayer could not be reached. Try again in a moment.' }
  }
}

export function useStarterDrip() {
  return useMutation({
    mutationKey: ['starter-drip'],
    mutationFn: (_ask: StarterDripAsk = {}) => claimStarter(),
    onSettled: async () => {
      // The claim state moved whichever way this went, so the offer is re-read before any screen
      // decides to show it again.
      await queryClient.invalidateQueries({ queryKey: ['relayer', 'faucet-claim'] })
      await invalidateMoney()
      void invalidateAccount()
    },
  })
}
