// One socket for every open room. The relayer's `/api/room/stream` is POST-only SSE (so the auth
// gate applies), replays its short buffer on attach, and the Vercel shim cuts it every ~5 minutes —
// so this reconnects with backoff and lets the log's id-dedupe absorb the replay.
import { useEffect, useMemo, useState } from 'react'
import type { Room, RoomEnvelope } from '@strk20/protocol/room'

import { relayerStream } from '@/lib/relayer'

import { chatLogFor, isActiveThread } from './chat-log-store'

export type StreamState = 'idle' | 'connecting' | 'live' | 'retrying'

export interface OpenRoom {
  peer: string
  room: Room
}

/** Mirrors the relayer's cap on rooms per stream. */
export const MAX_ROOMS_PER_STREAM = 32

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** A stream that is still up after this long is called live even before a frame arrives. */
const SETTLE_MS = 1_500

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function run(address: string, rooms: readonly OpenRoom[], signal: AbortSignal, onState: (s: StreamState) => void) {
  const [{ isRoomEnvelope, openMessage }, { decodeRoomMessage }] = await Promise.all([
    import('@strk20/protocol/room'),
    import('@strk20/protocol/room-message'),
  ])
  const log = chatLogFor(address)
  const ids = rooms.map((r) => r.room.id)

  // Every room shares our public key, so an echo of our own send is recognised once. Anything
  // else is tried against each room's receive key; the one that opens it is the sender's.
  async function receive(envelope: RoomEnvelope) {
    let from: bigint
    try {
      from = BigInt(envelope.from)
    } catch {
      return
    }
    if (rooms.length && BigInt(rooms[0]!.room.selfPublicKey) === from) return
    for (const open of rooms) {
      let plaintext: string
      try {
        plaintext = await openMessage(open.room, envelope)
      } catch {
        continue
      }
      log.insert(
        open.peer,
        { id: envelope.iv, mine: false, message: decodeRoomMessage(plaintext), at: Date.now() },
        { active: isActiveThread(open.peer) },
      )
      return
    }
  }

  let attempt = 0
  while (!signal.aborted) {
    onState(attempt === 0 ? 'connecting' : 'retrying')
    const startedAt = Date.now()
    const settle = setTimeout(() => onState('live'), SETTLE_MS)
    try {
      await relayerStream<unknown>(
        '/api/room/stream',
        { rooms: ids },
        (frame) => {
          onState('live')
          if (isRoomEnvelope(frame)) void receive(frame)
        },
        signal,
      )
    } catch {
      // A cut stream and a refused one look the same from here: wait, then try again.
    } finally {
      clearTimeout(settle)
    }
    if (signal.aborted) return
    if (Date.now() - startedAt > 60_000) attempt = 0 // it lived a while: restart the ramp
    await delay(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!, signal)
    attempt += 1
  }
}

/**
 * Keeps one stream open over `rooms` for as long as the caller is mounted. Reopens only when
 * membership changes (compared by sorted room id), never on a re-render.
 */
export function useRoomStream(address: string | undefined, rooms: readonly OpenRoom[]): StreamState {
  const [state, setState] = useState<StreamState>('idle')
  const signature = useMemo(
    () =>
      rooms
        .slice(0, MAX_ROOMS_PER_STREAM)
        .map((r) => r.room.id)
        .sort()
        .join(','),
    [rooms],
  )

  useEffect(() => {
    if (!address || signature === '') {
      setState('idle')
      return
    }
    const controller = new AbortController()
    void run(address, rooms.slice(0, MAX_ROOMS_PER_STREAM), controller.signal, (s) => {
      if (!controller.signal.aborted) setState(s)
    })
    return () => {
      controller.abort()
      setState('idle')
    }
    // `rooms` is read through `signature` on purpose: identity churn must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, signature])

  return state
}
