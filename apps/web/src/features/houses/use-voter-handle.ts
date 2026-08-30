//
// Your voter handle on a House — derived here, confirmed by the contract.
//
// `voter-handle.ts` produces two readings of the pool's derivation, because the pool's circuit is
// not in this repo and its `user_private_key` could be either secret this browser holds. Guessing
// is not an option: delegating to a wrong handle puts weight in a pot nobody can revoke.
//
// So the chain decides. `is_member` is a free view, and a handle it does not recognise is simply
// not shown — the same fail-closed shape `governanceWriteSafety` uses. `unconfirmed` is therefore
// an ordinary state, not an error: it is also what a non-member correctly sees.
//
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { NET } from '@strk20/protocol/constants'

import { useSession } from '@/app/session'
import { appContracts } from '@/queries'

export type HandleState = 'idle' | 'pending' | 'verified' | 'unconfirmed'

export interface VoterHandle {
  state: HandleState
  /** Set only when `verified`. Never rendered in any other state. */
  handle: string | null
}

const IDLE: VoterHandle = { state: 'idle', handle: null }

/** The derivation, then the proof. Two reads at worst, usually one; deterministic, so cached hard. */
function handleQuery(contract: string | undefined, address: string | undefined, accountKey: string | undefined, houseId: number) {
  return {
    queryKey: ['voter-handle', contract ?? null, houseId, address ?? null],
    enabled: Boolean(contract && address && accountKey),
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const [{ handleCandidates }, { readIsMember }, { deriveViewingKey }] = await Promise.all([
        import('@strk20/protocol/voter-handle'),
        import('@strk20/protocol/governance-reads'),
        import('@strk20/protocol/identity'),
      ])
      const candidates = handleCandidates({
        address: address!,
        accountKey: accountKey!,
        viewingKey: deriveViewingKey(accountKey!, NET.chainId, NET.pool),
        contract: contract!,
      })
      for (const candidate of candidates) {
        if (await readIsMember(contract!, houseId, candidate.handle)) return candidate.handle
      }
      return null
    },
  }
}

/** Handles across several Houses, keyed by house id — the picker's read. */
export function useVoterHandles(houseIds: readonly number[]): Record<number, VoterHandle> {
  const session = useSession()
  const ready = session.status === 'ready'
  const address = ready ? session.address : undefined
  const accountKey = ready ? session.accountKey : undefined
  const contract = appContracts().governance
  const ids = useMemo(() => [...houseIds], [houseIds])

  return useQueries({
    queries: ids.map((id) => handleQuery(contract, address, accountKey, id)),
    combine: (results) => {
      const out: Record<number, VoterHandle> = {}
      results.forEach((result, i) => {
        const id = ids[i]!
        if (!contract || !address) out[id] = IDLE
        else if (result.isPending) out[id] = { state: 'pending', handle: null }
        else out[id] = result.data ? { state: 'verified', handle: result.data } : { state: 'unconfirmed', handle: null }
      })
      return out
    },
  })
}

/** One House's handle — the record page's read. */
export function useVoterHandle(houseId: number | undefined): VoterHandle {
  const ids = useMemo(() => (houseId === undefined ? [] : [houseId]), [houseId])
  const all = useVoterHandles(ids)
  return houseId === undefined ? IDLE : (all[houseId] ?? IDLE)
}
