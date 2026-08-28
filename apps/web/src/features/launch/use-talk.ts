// The Talk thread: an open room on the chat relay, one per tag, held while any mount reads it.
// Nothing persists locally — the relay's 50-message replay IS the history, which is exactly what
// `OPEN_ROOM_DISCLOSURE` promises and not one message more.
import { useEffect, useSyncExternalStore } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { RoomEnvelope } from '@strk20/protocol/room'
import { NET } from '@strk20/protocol/constants'

import { getSessionSnapshot } from '@/app/session'
import { relayerPost, relayerStream } from '@/lib/relayer'

export type TalkStreamState = 'idle' | 'connecting' | 'live' | 'retrying'

export interface TalkPost {
  /** The envelope nonce — unique per message, the dedupe key. */
  id: string
  /** The poster's claimed identity x (`0x…`), `0x0` for a keyless client. A claim, not a proof. */
  from: string
  name: string | null
  text: string
}

export interface TalkThread {
  posts: readonly TalkPost[]
  stream: TalkStreamState
}

interface Held {
  state: TalkThread
  listeners: Set<() => void>
  controller: AbortController | null
  refs: number
}

const KEEP = 50
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const
const threads = new Map<string, Held>()

function heldFor(tag: string): Held {
  let held = threads.get(tag)
  if (!held) {
    held = { state: { posts: [], stream: 'idle' }, listeners: new Set(), controller: null, refs: 0 }
    threads.set(tag, held)
  }
  return held
}

function patch(held: Held, next: Partial<TalkThread>): void {
  held.state = { ...held.state, ...next }
  for (const listener of held.listeners) listener()
}

async function run(tag: string, held: Held, signal: AbortSignal): Promise<void> {
  const [{ deriveOpenRoom, openOpenPost }, { isRoomEnvelope }, { decodeRoomMessage }] = await Promise.all([
    import('@strk20/protocol/open-room'),
    import('@strk20/protocol/room'),
    import('@strk20/protocol/room-message'),
  ])
  // Reading needs no identity: the key comes from the tag.
  const room = await deriveOpenRoom(tag, null)
  const receive = async (envelope: RoomEnvelope) => {
    let plaintext: string
    try {
      plaintext = await openOpenPost(room, envelope)
    } catch {
      return // A frame the key does not authenticate is a message that did not arrive.
    }
    const message = decodeRoomMessage(plaintext)
    if (message.kind !== 'post' || held.state.posts.some((p) => p.id === envelope.iv)) return
    const post: TalkPost = { id: envelope.iv, from: envelope.from, name: message.name ?? null, text: message.text }
    patch(held, { posts: [...held.state.posts, post].slice(-KEEP) })
  }

  let attempt = 0
  while (!signal.aborted) {
    patch(held, { stream: attempt === 0 ? 'connecting' : 'retrying' })
    try {
      await relayerStream<unknown>(
        '/api/room/stream',
        { room: room.id },
        (frame) => {
          patch(held, { stream: 'live' })
          if (isRoomEnvelope(frame)) void receive(frame)
        },
        signal,
      )
    } catch {
      // Reconnects below; the shim cuts the stream every few minutes by design.
    }
    if (signal.aborted) return
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
    attempt += 1
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

function retain(tag: string): () => void {
  const held = heldFor(tag)
  held.refs += 1
  if (held.refs === 1 && !held.controller) {
    held.controller = new AbortController()
    void run(tag, held, held.controller.signal)
  }
  return () => {
    held.refs -= 1
    if (held.refs <= 0) {
      held.controller?.abort()
      held.controller = null
      patch(held, { stream: 'idle' })
    }
  }
}

/** The thread for a tag, live while any component holds it. */
export function useTalkThread(tag: string): TalkThread {
  useEffect(() => retain(tag), [tag])
  const held = heldFor(tag)
  return useSyncExternalStore(
    (listener) => {
      held.listeners.add(listener)
      return () => {
        held.listeners.delete(listener)
      }
    },
    () => held.state,
    () => held.state,
  )
}

async function post(input: { tag: string; text: string; name: string | null }): Promise<void> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.accountKey) throw new Error('An account is needed to post.')
  const [{ deriveOpenRoom, sealOpenPost }, { encodeRoomMessage }, identity] = await Promise.all([
    import('@strk20/protocol/open-room'),
    import('@strk20/protocol/room-message'),
    import('@strk20/protocol/identity'),
  ])
  // The byline identity is the viewing key's public x — the same stamp sealed chat uses.
  const viewingKey = identity.deriveViewingKey(session.accountKey, NET.chainId, NET.pool)
  const publicKey = BigInt(identity.deriveIdentityPublicKey(`0x${viewingKey.toString(16)}`))
  const room = await deriveOpenRoom(input.tag, publicKey)
  const envelope = await sealOpenPost(
    room,
    encodeRoomMessage({ kind: 'post', text: input.text, ...(input.name ? { name: input.name } : {}) }),
  )
  await relayerPost('/api/room/send', { room: room.id, envelope })
  // The echo comes back off the stream and renders like everyone else's — one code path.
}

/** Post into a tag's thread. The claimed byline travels IN the post; neither it nor the key is proof. */
export function useTalkPost() {
  return useMutation({ mutationKey: ['talk', 'post'], mutationFn: post })
}
