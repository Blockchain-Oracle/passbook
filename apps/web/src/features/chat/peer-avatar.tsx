import { IdentityAvatar, type IdentityAvatarSize } from '@/components/money/identity-avatar'
import { handleLabel } from '@/lib/format'

import type { PeerIdentity } from './use-peers'

/**
 * A peer's face. Chat's thin binding onto the app-wide identicon, so a person looks the same here,
 * in the sidebar and on their profile — initials used to make every unnamed peer identical.
 */
export function PeerAvatar({
  peer,
  identity,
  size = 'default',
}: {
  peer: string
  identity: PeerIdentity | undefined
  size?: IdentityAvatarSize
}) {
  return <IdentityAvatar address={peer} name={identity?.name} avatar={identity?.avatar} size={size} />
}

/** `@name` when the directory has one, else the shortened address. */
export function peerLabel(peer: string, identity: PeerIdentity | undefined): string {
  return handleLabel(identity?.name, peer, 10, 8)
}
