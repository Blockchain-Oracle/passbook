//
// The Talk threads — open rooms on the chat relay, one per tag, shared across every mount.
//
// A MODULE CACHE, NOT A BUS. `chat-bus.ts` multiplexes a whole conversation list over one socket
// because a sidebar needs every thread at once; a Talk tab needs exactly the one thread on the
// page, so each tag holds its own stream, opened on first subscriber and CLOSED when the last
// unmounts — a token page left behind must not keep a socket warm forever.
//
// NOTHING PERSISTS LOCALLY, on purpose. The relay's 50-message replay IS the history; a reload
// renders what the room still holds, which is what `OPEN_ROOM_DISCLOSURE` promises and not one
// message more. Everything `starknet`-reaching stays behind dynamic imports — the build gate.
//
import { useEffect, useSyncExternalStore } from 'react'

import type { RoomStreamHandle, RoomStreamState } from '@strk20/protocol/room-transport'
import type { RoomMessage } from '@strk20/protocol/room-message'

import { useSession } from './session'
import { toast } from './toast-store'

export interface TalkPost {
  /** The envelope nonce — unique per message, the dedupe key upstream. */
  id: string
  /** The poster's claimed public identity x (`0x…`), `0x0` for a keyless client. */
  from: string
  /** The claimed directory handle carried in the post, or null. A byline, not a proof. */
  name: string | null
  text: string
}

export interface TalkThreadState {
  posts: readonly TalkPost[]
  stream: RoomStreamState | 'idle'
}

interface Thread {
  state: TalkThreadState
  listeners: Set<() => void>
  handle: RoomStreamHandle | null
  refs: number
  opening: boolean
}

const threads = new Map<string, Thread>()

function threadFor(tag: string): Thread {
  let held = threads.get(tag)
  if (!held) {
    held = { state: { posts: [], stream: 'idle' }, listeners: new Set(), handle: null, refs: 0, opening: false }
    threads.set(tag, held)
  }
  return held
}

function patch(thread: Thread, next: Partial<TalkThreadState>): void {
  thread.state = { ...thread.state, ...next }
  for (const listener of thread.listeners) listener()
}

async function open(tag: string, thread: Thread): Promise<void> {
  if (thread.opening || thread.handle) return
  thread.opening = true
  try {
    const [{ deriveOpenRoom, openOpenPost }, { openRoomStream }, { decodeRoomMessage }] =
      await Promise.all([
        import('@strk20/protocol/open-room'),
        import('@strk20/protocol/room-transport'),
        import('@strk20/protocol/room-message'),
      ])
    // Reading needs no identity at all; the room key comes from the tag.
    const room = await deriveOpenRoom(tag, null)
    if (thread.refs === 0) return
    thread.handle = openRoomStream({
      room: room.id,
      onState: (state) => patch(thread, { stream: state }),
      onEnvelope: (envelope) => {
        void openOpenPost(room, envelope).then(
          (plaintext) => {
            const message: RoomMessage = decodeRoomMessage(plaintext)
            if (message.kind !== 'post') return
            if (thread.state.posts.some((p) => p.id === envelope.iv)) return
            patch(thread, {
              posts: [
                ...thread.state.posts,
                {
                  id: envelope.iv,
                  from: envelope.from,
                  name: message.name ?? null,
                  text: message.text,
                },
              ].slice(-50),
            })
          },
          () => {
            // A frame the key does not authenticate is a message that did not arrive.
          },
        )
      },
    })
  } finally {
    thread.opening = false
  }
}

function retain(tag: string): () => void {
  const thread = threadFor(tag)
  thread.refs += 1
  if (thread.refs === 1) void open(tag, thread)
  return () => {
    thread.refs -= 1
    if (thread.refs <= 0) {
      thread.handle?.close()
      thread.handle = null
      patch(thread, { stream: 'idle' })
    }
  }
}

/** The thread for a tag, live while any component holds it. */
export function useTalkThread(tag: string): TalkThreadState {
  useEffect(() => retain(tag), [tag])
  const thread = threadFor(tag)
  return useSyncExternalStore(
    (listener) => {
      thread.listeners.add(listener)
      return () => thread.listeners.delete(listener)
    },
    () => thread.state,
  )
}

/**
 * Post into a tag's thread. Requires a ready session only for the identity stamp — the claimed
 * byline travels IN the post, the pubkey in the envelope, and neither is proof (the disclosure
 * line says so on every mount).
 */
export function useTalkComposer(tag: string, claimedName: string | null) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  return {
    canPost: ready !== null,
    post: async (text: string): Promise<boolean> => {
      if (!ready) return false
      try {
        const [{ deriveOpenRoom, sealOpenPost }, { sendEnvelope }, { encodeRoomMessage }, identity] =
          await Promise.all([
            import('@strk20/protocol/open-room'),
            import('@strk20/protocol/room-transport'),
            import('@strk20/protocol/room-message'),
            import('@strk20/protocol/identity'),
          ])
        const publicKey = BigInt(
          identity.deriveIdentityPublicKey(`0x${ready.viewingKey.toString(16)}`),
        )
        const room = await deriveOpenRoom(tag, publicKey)
        const envelope = await sealOpenPost(
          room,
          encodeRoomMessage({ kind: 'post', text, ...(claimedName ? { name: claimedName } : {}) }),
        )
        const sent = await sendEnvelope(room.id, envelope)
        if (!sent.ok) {
          toast({ kind: 'error', title: 'The post did not send', detail: sent.failure.reason })
          return false
        }
        // The echo comes back off the bus and renders like everyone else's — one code path.
        return true
      } catch (e) {
        toast({ kind: 'error', title: 'The post did not send', detail: String(e) })
        return false
      }
    },
  }
}
