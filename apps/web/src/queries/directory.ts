import { queryOptions } from '@tanstack/react-query'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'

import { relayerPost } from '@/lib/relayer'

/**
 * The whole name directory, searched locally. A search endpoint would tell the relayer who you
 * are looking for; the list is a few kilobytes and that is the point.
 */
export function directoryQuery() {
  return queryOptions({
    queryKey: ['directory'],
    queryFn: async (): Promise<DirectoryEntry[]> => {
      const body = await relayerPost<{ entries?: unknown }>('/api/directory/list', {})
      if (!Array.isArray(body.entries)) throw new Error('the directory returned no entries list')
      // Validated on the way in: this list puts a name over an address, so a row without one is out.
      return body.entries.filter(
        (e): e is DirectoryEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as DirectoryEntry).name === 'string' &&
          typeof (e as DirectoryEntry).address === 'string',
      )
    },
    staleTime: 5 * 60_000,
  })
}

/** One peer's avatar data URI, or `null`. Only worth asking when the entry says `hasAvatar`. */
export function avatarQuery(address: string) {
  return queryOptions({
    queryKey: ['directory', 'avatar', address.toLowerCase()],
    queryFn: async (): Promise<string | null> => {
      const body = await relayerPost<{ avatar?: unknown }>('/api/directory/avatar', { address })
      return typeof body.avatar === 'string' ? body.avatar : null
    },
    staleTime: Infinity,
  })
}

/** The directory's name for an address, compared as felts. */
export function nameFor(entries: readonly DirectoryEntry[] | undefined, address: string): string | null {
  let target: bigint
  try {
    target = BigInt(address)
  } catch {
    return null
  }
  for (const entry of entries ?? []) {
    try {
      if (BigInt(entry.address) === target) return entry.name
    } catch {
      // A malformed row matches nothing.
    }
  }
  return null
}
