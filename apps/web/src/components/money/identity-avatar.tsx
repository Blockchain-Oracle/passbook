//
// The face of an address.
//
// `directory-name.ts` has said "absence is the identicon" since the directory was written, and the
// app has been rendering two initials instead — so every unclaimed address looked like every other
// unclaimed address, and a name in a search result had nothing to recognise it by.
//
// THE SEED IS THE ADDRESS, NEVER THE NAME. Somebody renaming themselves must not change their
// face; the face is for the account, and the handle is a label stuck on it. It is normalised
// through `BigInt` first, so `0x0abc` and `0xABC` are one person rather than two.
//
// THE PALETTE IS OURS. `boring-avatars` takes the colours it blends, so these are STUDIO's orange,
// its cream and its near-black. An identicon in someone else's default palette is a sticker; in
// the app's own palette it reads as part of the app.
//
import BoringAvatar from 'boring-avatars'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Orange-dominant, with cream to lift it and near-black for depth. Five, so faces stay various. */
const PALETTE = ['#E04708', '#B93404', '#7A2203', '#FBF4EC', '#1A1A1A']

export type IdentityAvatarSize = 'sm' | 'default' | 'lg' | 'xl'

/** `xl` is the profile-page size; the other three are the shadcn Avatar's own scale. */
const XL = 'size-16'

export interface IdentityAvatarProps {
  /** The address this face stands for. */
  address: string
  /** The directory handle, for the label a screen reader reads. */
  name?: string | null
  /** An uploaded picture, as a `data:` URI. Anything else is ignored — see `AVATAR_PATTERN`. */
  avatar?: string | null
  size?: IdentityAvatarSize
  className?: string
}

/** Same account, same face, whatever the address was spelled like on the way in. */
export function identitySeed(address: string): string {
  try {
    return BigInt(address).toString(16)
  } catch {
    return address.toLowerCase()
  }
}

export function IdentityAvatar({ address, name, avatar, size = 'default', className }: IdentityAvatarProps) {
  const label = name ? `@${name}` : shortAddress(address)
  const uploaded = typeof avatar === 'string' && avatar.startsWith('data:image/') ? avatar : null
  return (
    <Avatar size={size === 'xl' ? 'lg' : size} className={cn(size === 'xl' && XL, className)}>
      {uploaded ? <AvatarImage src={uploaded} alt={label} /> : null}
      {/* The fallback is the identicon, so a slow or broken upload still lands on a face. */}
      <AvatarFallback className="bg-transparent p-0">
        <BoringAvatar variant="marble" name={identitySeed(address)} colors={PALETTE} size="100%" title={false} />
        <span className="sr-only">{label}</span>
      </AvatarFallback>
    </Avatar>
  )
}
