// One socket for every open room. The relayer's `/api/room/stream` is POST-only SSE (so the auth
// gate applies), replays its short buffer on attach, and the Vercel shim cuts it every ~5 minutes —
// so this reconnects with backoff and lets the log's id-dedupe absorb the replay.
import { useEffect, useMemo, useState } from 'react'
import type { Room, RoomEnvelope } from '@strk20/protocol/room'
import { PRESENCE_BEACON_MS, isPresenceFrame, isTypingFrame, othersFrom } from '@strk20/protocol/room-signal'

import { useDebounced } from '@/hooks/use-debounced'
import { relayerPost, relayerStream } from '@/lib/relayer'

import { chatLogFor, isActiveThread } from './chat-log-store'
import { markTyping, resetPresence, setOthers } from './room-presence'

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
/** How long the room set must hold still before the socket acts on it. See `useRoomStream`. */
const SETTLE_ROOMS_MS = 400

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
  // The relayer's control frames name a ROOM; every surface downstream speaks in peers.
  const peerOf = new Map(rooms.map((r) => [r.room.id, r.peer]))

  /** True when a frame's `from` hint is our own key — our echo, on any room. */
  function isMine(hint: string): boolean {
    if (rooms.length === 0) return false
    try {
      return BigInt(rooms[0]!.room.selfPublicKey) === BigInt(hint)
    } catch {
      return false
    }
  }

  // Every room shares our public key, so an echo of our own send is recognised once. Anything
  // else is tried against each room's receive key; the one that opens it is the sender's.
  async function receive(envelope: RoomEnvelope) {
    if (isMine(envelope.from)) return
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

  //
  // The presence beacon, repeated while the stream is up.
  //
  // It is what tells the other side we are here AND, by going quiet, that we have gone. Neither
  // fact is derivable from the socket: the serverless hop in front of the relayer keeps its own
  // connection open long after a tab closes, so a dot built on socket liveness lights on arrival
  // and never goes out. Measured at 145 seconds stale before this existed.
  //
  // The id is the room's PRESENCE TAG, not a random per-connection value. A random one made every
  // second tab and every five-minute reconnect count as an extra person — and since our own
  // beacon is in every room we stream, that read as "everyone you know is online". The tag is
  // derived per room from our side of it, so re-registering is idempotent (`room.ts`).
  //
  const beacons = rooms.map((r) => ({ room: r.room.id, id: r.room.presenceTag }))
  let beacon: ReturnType<typeof setInterval> | undefined
  const sendBeacon = () => {
    if (beacons.length === 0) return
    void relayerPost('/api/room/here', { beacons }).catch(() => {})
  }
  const startBeacon = () => {
    if (beacon !== undefined) return
    sendBeacon() // immediately, so a peer's dot appears on arrival rather than a cycle later
    beacon = setInterval(sendBeacon, PRESENCE_BEACON_MS)
  }
  const stopBeacon = () => {
    if (beacon === undefined) return
    clearInterval(beacon)
    beacon = undefined
  }
  signal.addEventListener('abort', stopBeacon)

  let attempt = 0
  while (!signal.aborted) {
    onState(attempt === 0 ? 'connecting' : 'retrying')
    const startedAt = Date.now()
    // The relayer subscribes BEFORE it opens the SSE response, so by the time this fires the rooms
    // exist and a beacon into them will be accepted rather than refused as `no-room`.
    const settle = setTimeout(() => {
      onState('live')
      startBeacon()
    }, SETTLE_MS)
    try {
      await relayerStream<unknown>(
        '/api/room/stream',
        { rooms: ids },
        (frame) => {
          onState('live')
          startBeacon()
          if (isRoomEnvelope(frame)) {
            void receive(frame)
            return
          }
          // A frame that is not an envelope is one of ours or one from a future version. Both are
          // ignored rather than logged: a client must survive a relayer that learned a new frame.
          if (isPresenceFrame(frame)) {
            const peer = peerOf.get(frame.room)
            if (peer) setOthers(peer, othersFrom(frame.count))
          } else if (isTypingFrame(frame) && !isMine(frame.from)) {
            const peer = peerOf.get(frame.room)
            if (peer) markTyping(peer)
          }
        },
        signal,
      )
    } catch {
      // A cut stream and a refused one look the same from here: wait, then try again.
    } finally {
      clearTimeout(settle)
      stopBeacon()
      // The socket is gone, so every presence count it delivered is now a claim about a room this
      // client is no longer attached to. Say nothing rather than something stale.
      resetPresence()
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
  //
  // ── THE ROOM SET ARRIVES IN PIECES, AND THE SOCKET MUST NOT ──────────────────────────────
  //
  // Rooms come from a fan-out of per-peer queries that settle one at a time, so a person with six
  // conversations produces six different room sets in the first second of a page load. Reacting to
  // each one tore the stream down and rebuilt it six times, and what the user saw was the badge
  // sitting on "Reconnecting…" while the thing it describes was in fact starting over and over.
  //
  // Waiting for the set to hold still costs a few hundred milliseconds before the first message
  // can arrive and saves every restart after the first. The delay is short enough that opening a
  // brand-new thread still feels immediate.
  //
  const settled = useDebounced(signature, SETTLE_ROOMS_MS)

  useEffect(() => {
    if (!address || settled === '') {
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
      resetPresence()
    }
    // `rooms` is read through the settled signature on purpose: identity churn must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, settled])

  return state
}
