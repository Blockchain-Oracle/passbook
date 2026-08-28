import { useState } from 'react'
import { Lock } from 'lucide-react'

import { useSession } from '@/app/session'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { shortAddress } from '@/lib/format'
import { AccountDrawer } from './account-drawer'
import { LOCKED_MARK, NO_ACCOUNT } from './account-copy'

/** Two hex nibbles of the address, coloured by the address: a disc that is recognisable, not an image. */
function disc(address: string): { text: string; hue: number } {
  const felt = address.replace(/^0x0*/, '')
  let hue = 0
  for (const ch of felt.slice(0, 12)) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  return { text: felt.slice(0, 2).toUpperCase(), hue }
}

/** Address short + label + lock state. Opens the drawer. Hidden while there is nothing to show. */
export function AccountChip({ className }: { className?: string }) {
  const session = useSession()
  const [open, setOpen] = useState(false)

  if (session.status === 'booting') return <Skeleton className="h-8 w-32 rounded-lg" />
  if (session.status === 'fresh' || session.status === 'no-storage' || !session.address) {
    return <span className="text-body4 text-muted-foreground">{NO_ACCOUNT}</span>
  }
  const { text, hue } = disc(session.address)
  const locked = session.status === 'locked'
  return (
    <>
      <Button variant="outline" size="default" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Avatar size="sm">
          <AvatarFallback style={{ background: `hsl(${hue} 40% 35%)`, color: 'white' }} className="font-mono text-[10px]">
            {text}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-32 truncate">{session.label ?? shortAddress(session.address)}</span>
        {locked ? (
          <span className="flex items-center gap-1 text-body4 text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {LOCKED_MARK}
          </span>
        ) : null}
      </Button>
      <AccountDrawer session={session} open={open} onOpenChange={setOpen} />
    </>
  )
}
