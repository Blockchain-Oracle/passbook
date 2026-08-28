// Chat's one chain read: a peer's registered key, and the room derived from it. The core has no
// room query (it is chat-only), so it lives here. Room keys are CryptoKeys — not serialisable, and
// not something structural sharing should walk — so sharing is off and the entry never goes stale.
import { queryOptions, skipToken } from '@tanstack/react-query'
import { NET } from '@strk20/protocol/constants'
import type { Room } from '@strk20/protocol/room'

import { CHAT_PEER_INVALID, CHAT_PEER_SELF, CHAT_PEER_UNREGISTERED } from '@strk20/protocol/chat-copy'

export type PeerStatus =
  | { kind: 'invalid' }
  | { kind: 'self' }
  | { kind: 'unregistered' }
  | { kind: 'unreadable'; because: string }
  | { kind: 'open'; room: Room }

export interface RoomInputs {
  address: string
  /** The root key. Only ever read inside the queryFn — never part of the key. */
  accountKey: string
}

async function derivePeer(me: RoomInputs, peer: string): Promise<PeerStatus> {
  const [{ maybeAddress, sameAddress }, { getPublicKey }, { deriveRoom }, { deriveViewingKey }, { deriveRegisteredPublicKey }] =
    await Promise.all([
      import('@strk20/protocol/address'),
      import('@strk20/protocol/pool'),
      import('@strk20/protocol/room'),
      import('@strk20/protocol/identity'),
      import('@strk20/protocol/registration'),
    ])
  if (maybeAddress(peer) === null) return { kind: 'invalid' }
  if (sameAddress(peer, me.address)) return { kind: 'self' }
  let theirPublicKey: bigint
  try {
    theirPublicKey = await getPublicKey(peer)
  } catch (error) {
    return { kind: 'unreadable', because: String(error) }
  }
  if (theirPublicKey === 0n) return { kind: 'unregistered' }
  try {
    const room = await deriveRoom({
      myViewingKey: deriveViewingKey(me.accountKey, NET.chainId, NET.pool),
      myPublicKey: deriveRegisteredPublicKey(me.accountKey),
      theirPublicKey,
    })
    return { kind: 'open', room }
  } catch (error) {
    return { kind: 'unreadable', because: String(error) }
  }
}

/** The room with `peer`, or why there is none. `me` absent → the query waits (`skipToken`). */
export function peerRoomQuery(me: RoomInputs | null, peer: string) {
  return queryOptions({
    queryKey: ['chat', 'room', me?.address.toLowerCase() ?? null, peer.toLowerCase()],
    queryFn: me ? () => derivePeer(me, peer) : skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
    structuralSharing: false,
    retry: false,
  })
}

/** One line for the thread header, from the peer's status. */
export function statusLine(status: PeerStatus | undefined): string {
  if (!status) return 'Reading their key…'
  switch (status.kind) {
    case 'invalid':
      return CHAT_PEER_INVALID
    case 'self':
      return CHAT_PEER_SELF
    case 'unregistered':
      return CHAT_PEER_UNREGISTERED
    case 'unreadable':
      return `The chain could not be read, so nothing is known about this address yet: ${status.because}`
    case 'open':
      return `Room ${status.room.id.slice(0, 8)}… — derived here, from a key neither of you sent anywhere.`
  }
}
