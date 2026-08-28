import { queryOptions, skipToken } from '@tanstack/react-query'
import type { ActivityEntry } from '@strk20/protocol/activity-entry'
import { NET } from '@strk20/protocol/constants'

import { queryClient } from '@/app/query-client'
import { shieldedQuery } from './shielded'

const ACTIVITY_MS = 20_000

export interface ActivityRead {
  entries: ActivityEntry[]
  /**
   * The window that was actually read. `null` means the usual span; a sentence means the pool was
   * busy enough that the view narrowed or was cut short — shown beside the feed, never hidden.
   */
  windowNote: string | null
  complete: boolean
  blocks: number
}

/**
 * The pool's recent events, decoded with this account's personal keys so its own rows are marked.
 * Reads up to the block the balance walk was read beside, so feed and balance describe one moment.
 */
export function activityReadQuery(address: string | undefined, accountKey: string | undefined) {
  return queryOptions({
    queryKey: ['activity', address ?? null, 'read'],
    queryFn:
      address && accountKey
        ? async (): Promise<ActivityRead> => {
            const read = await queryClient.fetchQuery(shieldedQuery(address, accountKey))
            if (read.state !== 'walked') {
              throw new Error(`The record could not be read: ${read.reason}`)
            }
            const [
              { readRecentEvents, ACTIVITY_WINDOW_BLOCKS, describeSpan },
              { buildActivity, markOwnAddress, personalKeysFrom },
              { deriveViewingKey },
            ] = await Promise.all([
              import('@strk20/protocol/activity-window'),
              import('@strk20/protocol/activity'),
              import('@strk20/protocol/identity'),
            ])
            const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
            const personal = personalKeysFrom(read.registry, viewingKey)
            const amountsByNoteId = new Map(read.notes.map((note) => [note.id.toString(), note.amount]))
            const page = await readRecentEvents({ toBlock: read.blockNumber })
            const entries = markOwnAddress(buildActivity(page.events, { personal, amountsByNoteId }), address)
            const windowNote = !page.complete
              ? 'This list stops part-way through and does not reach the present. The pool returned more than one read can hold, so the most recent transactions are missing.'
              : page.blocks < ACTIVITY_WINDOW_BLOCKS
                ? `This covers about ${describeSpan(page.blocks)}, not the usual week — the pool was busy enough that a longer view would not fit in one read.`
                : null
            return { entries, windowNote, complete: page.complete, blocks: page.blocks }
          }
        : skipToken,
    staleTime: ACTIVITY_MS,
  })
}

/** The entries alone. Shares the read above through the client, so both keys cost one decode. */
export function activityQuery(address: string | undefined, accountKey: string | undefined) {
  return queryOptions({
    queryKey: ['activity', address ?? null],
    queryFn:
      address && accountKey
        ? async (): Promise<ActivityEntry[]> => (await queryClient.fetchQuery(activityReadQuery(address, accountKey))).entries
        : skipToken,
    staleTime: ACTIVITY_MS,
  })
}
