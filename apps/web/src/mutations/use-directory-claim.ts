import { useMutation } from '@tanstack/react-query'
import { NET } from '@strk20/protocol/constants'
import type { DirectoryClaimRequest } from '@strk20/protocol/directory-name'

import { getSessionSnapshot } from '@/app/session'
import { queryClient } from '@/app/query-client'
import { RelayerError, relayerPost } from '@/lib/relayer'

export interface ClaimAsk {
  /** Already normalised: 3–20 of `[a-z0-9_-]`. */
  name: string
  /** A size-capped image data URI; absence is the identicon. */
  avatar?: string
}

export type ClaimOutcome = { ok: true } | { ok: false; because: string }

/**
 * Claim a public name. Signed with the viewing key; the relayer verifies it against
 * `get_public_key(address)`, so a name cannot be squatted onto a key the claimant does not hold.
 */
async function claim(ask: ClaimAsk): Promise<ClaimOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const { address, accountKey } = session
  try {
    const [{ signClaim }, { deriveViewingKey }] = await Promise.all([
      import('@strk20/protocol/directory'),
      import('@strk20/protocol/identity'),
    ])
    const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
    const request: DirectoryClaimRequest = {
      name: ask.name,
      address,
      signature: signClaim(ask.name, address, viewingKey),
      ...(ask.avatar ? { avatar: ask.avatar } : {}),
    }
    await relayerPost<{ ok?: boolean }>('/api/directory/claim', request)
    return { ok: true }
  } catch (error) {
    if (error instanceof RelayerError) {
      return {
        ok: false,
        because: error.message.startsWith('relayer answered') ? `The directory refused it (HTTP ${error.status}).` : error.message,
      }
    }
    return { ok: false, because: `The directory could not be reached: ${String(error)}` }
  }
}

export function useDirectoryClaim() {
  return useMutation({
    mutationKey: ['directory-claim'],
    mutationFn: claim,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['directory'] }),
  })
}
