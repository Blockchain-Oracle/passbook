// Bearer positions held in this browser — markets, launches and Houses all keep theirs here.
// The store is localStorage (session-position-store, browser-safe). Read through one query so
// every panel, ticket and settlement door shares one snapshot and one invalidation.
import { queryOptions } from '@tanstack/react-query'
import type { PositionStore, StoredPosition } from '@strk20/protocol/session-position-store'

import { queryClient } from '@/app/query-client'

let store: PositionStore | null = null

async function positionStore(): Promise<PositionStore> {
  if (store) return store
  const [{ sessionPositionStore }, { browserSessionStore }] = await Promise.all([
    import('@strk20/protocol/session-position-store'),
    import('@strk20/protocol/session-store'),
  ])
  store = sessionPositionStore(browserSessionStore())
  return store
}

export type StoredPositionsRead =
  | { state: 'ok'; positions: StoredPosition[] }
  | { state: 'corrupt'; because: string }

const POSITIONS_KEY = ['positions', 'stored'] as const

/** Every bearer position this browser holds. `corrupt` renders its sentence, never an empty list. */
export function storedPositionsQuery() {
  return queryOptions({
    queryKey: POSITIONS_KEY,
    queryFn: async (): Promise<StoredPositionsRead> => {
      const read = (await positionStore()).read()
      if (read.state === 'corrupt') return { state: 'corrupt', because: read.because }
      return { state: 'ok', positions: read.state === 'ok' ? [...read.positions] : [] }
    },
    staleTime: Infinity,
  })
}

/** Stored BEFORE the send is submitted: a landed position whose secret was lost is money gone. */
export async function addStoredPosition(position: StoredPosition): Promise<void> {
  ;(await positionStore()).add(position)
  await queryClient.invalidateQueries({ queryKey: POSITIONS_KEY })
}

export async function removeStoredPosition(commitment: string): Promise<void> {
  ;(await positionStore()).remove(commitment)
  await queryClient.invalidateQueries({ queryKey: POSITIONS_KEY })
}

/**
 * Rewrites a create-time sentinel (`id: -1`) or attaches the hash once the chain answered. ONE
 * write, in place: the remove-then-add it replaced could lose the secret between its two writes.
 */
export async function patchStoredPosition(commitment: string, patch: Parameters<PositionStore['patch']>[1]): Promise<void> {
  ;(await positionStore()).patch(commitment, patch)
  await queryClient.invalidateQueries({ queryKey: POSITIONS_KEY })
}
