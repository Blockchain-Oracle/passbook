//
// The note a mail will create, named before the SDK compiles it.
//
// The SDK's invoke callback tells a helper about open notes, withdrawals and the pool — never the
// encrypted note a transfer mints. But a note id is `compute_note_id(channel_key, token, index)`,
// and every input is in hand from the walk: the outgoing channel's key (or, for a first contact,
// the key the SDK will derive when it opens the channel) and the next note index on that token.
// `mail-guards.ts` then reads the compiled span and refuses to prove if the SDK disagreed.
//

import { compute_channel_key, compute_note_id } from './discovery.js'
import { sameFelt, type SendChannelData } from './send-plan.js'

export interface MailAnchorInput {
  self: string
  /** The viewing key — the pool's "sender private key" in `compute_channel_key`. */
  viewingKey: bigint
  recipient: string
  recipientPublicKey: bigint
  token: string
  /** The sender's outgoing channels as the walk saw them. */
  channels: readonly SendChannelData[]
}

export interface MailAnchor {
  channelKey: bigint
  /** The note's index inside the (channel, token) subchannel — what the SDK will use as `index`. */
  index: number
  noteId: bigint
}

export function predictMailAnchor(input: MailAnchorInput): MailAnchor {
  const channel = input.channels.find((c) => sameFelt(c.address, input.recipient))
  // A channel the pool already has carries its key; one the SDK is about to open gets the same
  // key the SDK will compute, from the same four inputs.
  const channelKey =
    channel?.key ?? compute_channel_key(BigInt(input.self), input.viewingKey, BigInt(input.recipient), input.recipientPublicKey)
  const slot = channel?.tokens?.find((t) => sameFelt(t.token, input.token))
  const index = slot?.noteNonce ?? 0
  return { channelKey, index, noteId: compute_note_id(channelKey, BigInt(input.token), index) }
}
