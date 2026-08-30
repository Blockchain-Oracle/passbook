// The list's fan-out read: one room query per remembered conversation, so a single stream can
// carry them all. Identities moved to `queries/identity.ts` — the sidebar needs the same two reads.
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useIdentities, useIdentity, type Identity } from '@/queries/identity'

import { peerRoomQuery, type RoomInputs } from './queries'
import { MAX_ROOMS_PER_STREAM, type OpenRoom } from './use-room-stream'

/** Rooms that derived, in the order given (most recent conversation first), capped for the stream. */
export function useOpenRooms(me: RoomInputs | null, peers: readonly string[]): readonly OpenRoom[] {
  const wanted = useMemo(() => peers.slice(0, MAX_ROOMS_PER_STREAM), [peers])
  return useQueries({
    queries: wanted.map((peer) => peerRoomQuery(me, peer)),
    combine: (results) => {
      const open: OpenRoom[] = []
      results.forEach((result, i) => {
        if (result.data?.kind === 'open') open.push({ peer: wanted[i]!, room: result.data.room })
      })
      return open
    },
  })
}

// Chat's spelling of the app-wide identity read, kept so its call-sites read in chat's own words.
export type PeerIdentity = Identity
export const usePeerIdentities = useIdentities
export const usePeerIdentity = useIdentity
