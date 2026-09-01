// The conversation log, opened once per account. It is localStorage-backed and the only copy of
// chat history there is (CHAT_HISTORY_IS_LOCAL), so it is genuinely non-cacheable UI state — the
// one kind the brief allows a module store for. Read through `useSyncExternalStore`.
import { useSyncExternalStore } from 'react'
import { openChatLog, type ChatLog, type ChatLogEntry, type ConversationSummary } from '@strk20/protocol/chat-log'

let current: { address: string; log: ChatLog } | null = null
let activePeer: string | null = null
const NO_CONVERSATIONS: readonly ConversationSummary[] = []
const NO_ENTRIES: readonly ChatLogEntry[] = []

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // private mode: memory carries the session, the header copy owns the loss
  }
}

/** The log for this account — opened on first ask, swapped when the account changes. */
export function chatLogFor(address: string): ChatLog {
  const key = address.toLowerCase()
  if (current?.address !== key) current = { address: key, log: openChatLog(key, storage()) }
  return current.log
}

/** Normalised conversation id: a lowercased address, so two spellings are one thread. */
export function peerKey(peer: string): string {
  return peer.trim().toLowerCase()
}

/** The thread on screen accrues no unread. `null` when no thread is open. */
export function setActiveThread(address: string, peer: string | null): void {
  activePeer = peer ? peerKey(peer) : null
  if (activePeer) chatLogFor(address).markRead(activePeer)
}

export function isActiveThread(peer: string): boolean {
  return activePeer === peerKey(peer)
}

// Stable per address, so `useSyncExternalStore` does not resubscribe every render.
const subscribers = new Map<string, (listener: () => void) => () => void>()
const subscribeNothing = () => () => {}

function subscribeTo(address: string | undefined) {
  if (!address) return subscribeNothing
  const key = address.toLowerCase()
  let fn = subscribers.get(key)
  if (!fn) {
    fn = (listener) => chatLogFor(key).subscribe(listener)
    subscribers.set(key, fn)
  }
  return fn
}

export function useConversations(address: string | undefined): readonly ConversationSummary[] {
  return useSyncExternalStore(
    subscribeTo(address),
    () => (address ? chatLogFor(address).list() : NO_CONVERSATIONS),
    () => NO_CONVERSATIONS,
  )
}

/**
 * Unread across every conversation, for the navigation badge.
 *
 * A number, so the snapshot is stable by value and no caching is needed. It could only ever have
 * been zero on a non-chat surface until the socket moved to the app root (`chat-stream.tsx`) —
 * a badge is a promise that you will be told, and nothing was listening to keep it.
 */
export function useTotalUnread(address: string | undefined): number {
  return useSyncExternalStore(
    subscribeTo(address),
    () => (address ? chatLogFor(address).totalUnread() : 0),
    () => 0,
  )
}

export function useThread(address: string | undefined, peer: string): readonly ChatLogEntry[] {
  return useSyncExternalStore(
    subscribeTo(address),
    () => (address ? chatLogFor(address).thread(peerKey(peer)) : NO_ENTRIES),
    () => NO_ENTRIES,
  )
}
