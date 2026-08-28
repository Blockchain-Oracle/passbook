// Sealing and sending one message. Optimistic insert first (its id is the envelope nonce, so the
// relay's replay of it is a no-op), then the post; a failure annotates the entry in place.
import { useMutation } from '@tanstack/react-query'
import type { Room } from '@strk20/protocol/room'
import type { RoomMessage } from '@strk20/protocol/room-message'

import { RelayerError, relayerPost } from '@/lib/relayer'

import { chatLogFor, peerKey } from './chat-log-store'

export interface SendAsk {
  address: string
  peer: string
  room: Room
  message: RoomMessage
}

async function send({ address, peer, room, message }: SendAsk): Promise<void> {
  const [{ sealMessage, MAX_MESSAGE_BYTES }, { encodeRoomMessage }] = await Promise.all([
    import('@strk20/protocol/room'),
    import('@strk20/protocol/room-message'),
  ])
  if (message.kind === 'text' && new TextEncoder().encode(message.text).byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`That is longer than one message can carry (${MAX_MESSAGE_BYTES} bytes).`)
  }
  const log = chatLogFor(address)
  const key = peerKey(peer)
  const envelope = await sealMessage(room, encodeRoomMessage(message))
  log.insert(key, { id: envelope.iv, mine: true, message, at: Date.now() }, { active: true })
  try {
    await relayerPost<{ delivered?: number }>('/api/room/send', { room: room.id, envelope })
  } catch (error) {
    const because =
      error instanceof RelayerError
        ? `Not delivered — the relay refused it (${error.reason ?? error.message}).`
        : 'Not delivered — the relay could not be reached.'
    log.markUndelivered(key, envelope.iv, because)
    throw new Error(because)
  }
}

export function useSendMessage() {
  return useMutation({ mutationKey: ['chat', 'send'], mutationFn: send })
}
