import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { shortAddress } from '@/lib/format'

import type { PeerIdentity } from './use-peers'

/** Image only from a `data:` URI; otherwise the first letters of the name or address. */
export function PeerAvatar({
  peer,
  identity,
  size = 'default',
}: {
  peer: string
  identity: PeerIdentity | undefined
  size?: 'sm' | 'default' | 'lg'
}) {
  const label = identity?.name ?? shortAddress(peer)
  const initials = identity?.name ? identity.name.slice(0, 2).toUpperCase() : peer.slice(2, 4).toUpperCase()
  return (
    <Avatar size={size}>
      {identity?.avatar ? <AvatarImage src={identity.avatar} alt={label} /> : null}
      <AvatarFallback className="font-mono text-mono">{initials}</AvatarFallback>
    </Avatar>
  )
}

/** `@name` when the directory has one, else the shortened address. */
export function peerLabel(peer: string, identity: PeerIdentity | undefined): string {
  return identity?.name ? `@${identity.name}` : shortAddress(peer, 10, 8)
}
