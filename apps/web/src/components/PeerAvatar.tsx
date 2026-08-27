//
// The mark for another person, in chat.
//
// ── IT IS `IdentityDisc` WITH A PICTURE IN FRONT OF IT ───────────────────────────────────
//
// The deterministic disc already exists and is already the account chip's own mark, so a second
// hashing function here would be two ways to draw the same address — and they would drift the
// first time either was touched. What this adds is the ONE thing the disc cannot do: show a
// picture somebody uploaded to the directory.
//
// ── THE FALLBACK IS THE DEFAULT, NOT THE ERROR PATH ──────────────────────────────────────
//
// Almost nobody will have claimed a name, let alone uploaded an avatar, so the disc is what this
// renders nearly always. An `<img>` that fails to load falls back to it too — a broken-image glyph
// beside somebody's money is worse than the mark that was always going to be there.
//
import { useState } from 'react'

import { cn } from '../lib/cn'
import { IdentityDisc } from './IdentityDisc'

export interface PeerAvatarProps {
  address: string
  /**
   * A `data:` URI from the directory, when this peer published one.
   *
   * A DATA URI AND NOTHING ELSE. `directory.ts`'s `AVATAR_PATTERN` bounds it to base64 PNG/JPEG/
   * WebP and `MAX_AVATAR_CHARS` bounds its size, so what arrives here cannot be a remote URL —
   * which matters, because an `<img src>` pointing at a third-party host would leak to that host
   * every time somebody opened a conversation.
   */
  avatar?: string | null
  size?: number
  className?: string
}

export function PeerAvatar({ address, avatar, size = 40, className }: PeerAvatarProps) {
  const [broken, setBroken] = useState(false)

  if (!avatar || broken) return <IdentityDisc address={address} size={size} className={className} />

  return (
    <img
      src={avatar}
      // Empty, not a name: the row already carries the peer's name or address as text, and an alt
      // that repeated it would have a screen reader say it twice before reaching the message.
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className={cn('shrink-0 rounded-pill object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}
