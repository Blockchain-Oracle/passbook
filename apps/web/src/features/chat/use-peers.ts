// The list's fan-out reads: one room query per remembered conversation (so a single stream can
// carry them all) and one avatar query per peer the directory says has one.
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'

import { avatarQuery, directoryQuery, nameFor } from '@/queries'

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

export interface PeerIdentity {
  /** `@name` from the directory, or `null`. */
  name: string | null
  /** A `data:` URI, or `null`. Anything else the directory hands back is refused. */
  avatar: string | null
}

function entryFor(entries: readonly DirectoryEntry[] | undefined, peer: string): DirectoryEntry | null {
  const name = nameFor(entries, peer)
  return name ? (entries?.find((e) => e.name === name) ?? null) : null
}

function asDataUri(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null
}

/** Names and avatars for a set of peers, keyed by the peer string given. */
export function usePeerIdentities(peers: readonly string[]): Record<string, PeerIdentity> {
  const directory = useQuery(directoryQuery())
  const entries = directory.data
  const withAvatar = useMemo(
    () => peers.map((peer) => ({ peer, entry: entryFor(entries, peer) })).filter((p) => p.entry?.hasAvatar),
    [entries, peers],
  )
  const avatars = useQueries({
    queries: withAvatar.map((p) => avatarQuery(p.entry!.address)),
    combine: (results) => {
      const out: Record<string, string | null> = {}
      results.forEach((r, i) => {
        out[withAvatar[i]!.peer] = asDataUri(r.data)
      })
      return out
    },
  })
  return useMemo(() => {
    const out: Record<string, PeerIdentity> = {}
    for (const peer of peers) out[peer] = { name: nameFor(entries, peer), avatar: avatars[peer] ?? null }
    return out
  }, [peers, entries, avatars])
}

/** One peer's identity — the thread header's read. */
export function usePeerIdentity(peer: string): PeerIdentity {
  const peers = useMemo(() => [peer], [peer])
  return usePeerIdentities(peers)[peer] ?? { name: null, avatar: null }
}
