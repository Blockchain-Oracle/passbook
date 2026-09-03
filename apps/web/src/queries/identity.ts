//
// Who an address is, as far as the directory knows: a handle and maybe a picture.
//
// This started inside mail, which is where a face was first needed. It is app-wide now because the
// sidebar has to show YOUR handle, and a search result has to show the face of a name you just
// typed — the same two reads, and they must not be answered twice from two places.
//
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'

import { avatarQuery, directoryQuery, nameFor } from './directory'

export interface Identity {
  /** The handle from the directory, WITHOUT the `@`, or `null`. */
  name: string | null
  /** A `data:` URI. Anything else the directory hands back is refused — see `AVATAR_PATTERN`. */
  avatar: string | null
}

const UNKNOWN: Identity = { name: null, avatar: null }

function entryFor(entries: readonly DirectoryEntry[] | undefined, address: string): DirectoryEntry | null {
  const name = nameFor(entries, address)
  return name ? (entries?.find((e) => e.name === name) ?? null) : null
}

/**
 * A URL here would be a tracking beacon somebody else gets to install by claiming a name: the
 * `<img>` would report to their host every time anyone opened a conversation. Only `data:` passes.
 */
function asDataUri(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null
}

/** Identities for a set of addresses, keyed by the string given. One directory read for all of them. */
export function useIdentities(addresses: readonly string[]): Record<string, Identity> {
  const directory = useQuery(directoryQuery())
  const entries = directory.data
  // Only an entry that says it HAS a picture is worth a second request.
  const withAvatar = useMemo(
    () => addresses.map((address) => ({ address, entry: entryFor(entries, address) })).filter((p) => p.entry?.hasAvatar),
    [entries, addresses],
  )
  const avatars = useQueries({
    queries: withAvatar.map((p) => avatarQuery(p.entry!.address)),
    combine: (results) => {
      const out: Record<string, string | null> = {}
      results.forEach((r, i) => {
        out[withAvatar[i]!.address] = asDataUri(r.data)
      })
      return out
    },
  })
  return useMemo(() => {
    const out: Record<string, Identity> = {}
    for (const address of addresses) out[address] = { name: nameFor(entries, address), avatar: avatars[address] ?? null }
    return out
  }, [addresses, entries, avatars])
}

/** One address's identity — the thread header's read, and the sidebar's. */
export function useIdentity(address: string | null | undefined): Identity {
  const list = useMemo(() => (address ? [address] : []), [address])
  const all = useIdentities(list)
  return address ? (all[address] ?? UNKNOWN) : UNKNOWN
}
