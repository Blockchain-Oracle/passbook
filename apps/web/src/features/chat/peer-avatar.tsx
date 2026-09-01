import { CHAT_PRESENCE_MEANING } from '@strk20/protocol/chat-copy'

import { IdentityAvatar, type IdentityAvatarSize } from '@/components/money/identity-avatar'
import { handleLabel } from '@/lib/format'

import type { PeerIdentity } from './use-peers'

/**
 * A peer's face. Chat's thin binding onto the app-wide identicon, so a person looks the same here,
 * in the sidebar and on their profile — initials used to make every unnamed peer identical.
 *
 * The dot is drawn only when somebody IS attached. There is no grey "offline" dot, because absence
 * here has two causes that look identical from this browser — they closed the tab, or our own
 * socket is down — and a badge that renders the same for both would be asserting the first.
 */
export function PeerAvatar({
  peer,
  identity,
  size = 'default',
  here = false,
}: {
  peer: string
  identity: PeerIdentity | undefined
  size?: IdentityAvatarSize
  /** Someone other than us is on this room's socket right now. */
  here?: boolean
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <IdentityAvatar address={peer} name={identity?.name} avatar={identity?.avatar} size={size} />
      {here ? (
        <span
          // `ring` in the surface colour, so the dot reads as a badge on the face rather than a
          // smudge over it, on a list row and on a card header alike.
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-settled ring-2 ring-card"
          title={CHAT_PRESENCE_MEANING}
        >
          <span className="sr-only">Online</span>
        </span>
      ) : null}
    </span>
  )
}

/** `@name` when the directory has one, else the shortened address. */
export function peerLabel(peer: string, identity: PeerIdentity | undefined): string {
  return handleLabel(identity?.name, peer, 10, 8)
}
