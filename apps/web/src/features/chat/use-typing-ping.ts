// The outbound half of the typing indicator: one fire-and-forget ping per window, never per key.
import { useCallback, useEffect, useRef } from 'react'
import type { Room } from '@strk20/protocol/room'
import { TYPING_PING_MS } from '@strk20/protocol/room-signal'

import { relayerPost } from '@/lib/relayer'

/**
 * Hands back a `ping()` to call on every keystroke. It is cheap to call and mostly does nothing:
 * the ref clock drops everything inside `TYPING_PING_MS` of the last one that went out.
 *
 * FAILURES ARE SWALLOWED ON PURPOSE, and this is the one place in the app where that is right.
 * A ping into a room with nobody in it answers 404 by design (`rooms.ts`), a rate-limited one
 * answers 429, and neither is a thing to tell a person mid-sentence — the cost of a lost ping is
 * a dot that does not appear. Money and messages never get this treatment; `useSendMessage`
 * annotates a failed send in the thread precisely because that one matters.
 */
export function useTypingPing(room: Room | null): () => void {
  const lastAt = useRef(0)

  // A new room is a new conversation: the next keystroke there should ping immediately.
  useEffect(() => {
    lastAt.current = 0
  }, [room?.id])

  return useCallback(() => {
    if (!room) return
    const now = Date.now()
    if (now - lastAt.current < TYPING_PING_MS) return
    lastAt.current = now
    void relayerPost('/api/room/typing', { room: room.id, from: room.selfPublicKey }).catch(() => {})
  }, [room])
}
