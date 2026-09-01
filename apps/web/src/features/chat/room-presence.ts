//
// Who is attached, and who is typing. In memory, for exactly as long as the socket lasts.
//
// A module store rather than React state for the same reason `chat-log-store.ts` is one: the
// writer is a stream running outside the tree, and the readers are a sidebar row and a thread
// header that must not re-render the whole app between them. Nothing here is ever persisted —
// presence is a claim about right now, and a remembered one would be a lie on the next page load.
//
// SNAPSHOTS ARE REPLACED, NEVER EDITED. `useSyncExternalStore` compares with `Object.is`, so a
// mutated record is a change React does not see. That is not a hypothetical here: it is the exact
// bug that made this surface look frozen (`chat-log.ts` header).
//
import { useSyncExternalStore } from 'react'
import { TYPING_TTL_MS } from '@strk20/protocol/room-signal'

export interface PeerPresence {
  /** Sockets on this room other than ours. `0` is "nobody else is attached", not "unknown". */
  readonly others: number
  /** Whether their last ping is still inside `TYPING_TTL_MS`. */
  readonly typing: boolean
}

const ABSENT: PeerPresence = { others: 0, typing: false }
const EMPTY: Record<string, PeerPresence> = {}

let state: Record<string, PeerPresence> = {}
const listeners = new Set<() => void>()
/** One expiry timer per typing peer, so a stopped typist clears itself without a ticking clock. */
const expiries = new Map<string, ReturnType<typeof setTimeout>>()

function emit() {
  for (const l of listeners) l()
}

function write(peer: string, next: PeerPresence) {
  const current = state[peer] ?? ABSENT
  if (current.others === next.others && current.typing === next.typing) return
  state = { ...state, [peer]: next }
  emit()
}

function clearExpiry(peer: string) {
  const timer = expiries.get(peer)
  if (timer !== undefined) {
    clearTimeout(timer)
    expiries.delete(peer)
  }
}

/** The relayer's socket count for this room, already reduced to "everyone but us". */
export function setOthers(peer: string, others: number): void {
  const current = state[peer] ?? ABSENT
  // Nobody else on the socket means nobody else can be typing on it either.
  if (others === 0) clearExpiry(peer)
  write(peer, { others, typing: others === 0 ? false : current.typing })
}

/** A ping landed. Lights the indicator and arms the one timer that puts it out. */
export function markTyping(peer: string): void {
  clearExpiry(peer)
  expiries.set(
    peer,
    setTimeout(() => {
      expiries.delete(peer)
      write(peer, { ...(state[peer] ?? ABSENT), typing: false })
    }, TYPING_TTL_MS),
  )
  write(peer, { ...(state[peer] ?? ABSENT), typing: true })
}

/**
 * Forget everything. Called when the stream drops or the account changes.
 *
 * A stale "online" is worse than no answer at all: it is the one state a user acts on. A dropped
 * socket knows nothing about who is still there, so it says nothing.
 */
export function resetPresence(): void {
  for (const timer of expiries.values()) clearTimeout(timer)
  expiries.clear()
  if (Object.keys(state).length === 0) return
  state = {}
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePresence(peer: string | null | undefined): PeerPresence {
  return useSyncExternalStore(
    subscribe,
    () => (peer ? (state[peer] ?? ABSENT) : ABSENT),
    () => ABSENT,
  )
}

/** The whole map, for a list that needs a dot on every row without a hook per row. */
export function useAllPresence(): Record<string, PeerPresence> {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  )
}
