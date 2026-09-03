//
// Which block each thread was last looked at to, per account.
//
// A per-viewer convenience and nothing more: the threads themselves are rebuilt from the chain,
// and losing this file costs a badge, not a message. Kept in this browser because "have I seen
// this" is a fact about this browser.
//
import { useSyncExternalStore } from 'react'
import type { MailThread } from '@strk20/protocol/mail-discover'

const KEY = 'strk20.mail-seen'

/** address (lowercased) → peer (lowercased) → last block seen. */
type Store = Record<string, Record<string, number>>

let store: Store = read()
const listeners = new Set<() => void>()

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

const lower = (s: string) => s.toLowerCase()

export function seenBlock(address: string, peer: string): number {
  return store[lower(address)]?.[lower(peer)] ?? 0
}

export function markSeen(address: string, peer: string, block: number): void {
  if (seenBlock(address, peer) >= block) return
  store = { ...store, [lower(address)]: { ...(store[lower(address)] ?? {}), [lower(peer)]: block } }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage refused: the badge comes back next load. Nothing else does.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The latest INCOMING block in a thread — outgoing mail is never "unread". */
export function latestIncoming(thread: MailThread): number {
  let latest = 0
  for (const item of thread.items) if (item.direction === 'in' && item.blockNumber > latest) latest = item.blockNumber
  return latest
}

export function isUnread(address: string, thread: MailThread): boolean {
  return latestIncoming(thread) > seenBlock(address, thread.peer)
}

/** How many threads hold incoming mail newer than the last look. Live across tabs of this session. */
export function useUnreadThreads(address: string | undefined, threads: readonly MailThread[] | undefined): number {
  const version = useSyncExternalStore(subscribe, () => store, () => store)
  void version
  if (!address || !threads) return 0
  return threads.filter((t) => isUnread(address, t)).length
}
