import { useState } from 'react'
import { ChevronRight, Lock } from 'lucide-react'

import { useSession } from '@/app/session'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
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

function Disc({ address }: { address: string }) {
  const { text, hue } = disc(address)
  return (
    <Avatar>
      <AvatarFallback style={{ background: `hsl(${hue} 40% 35%)`, color: 'white' }} className="font-mono text-[10px]">
        {text}
      </AvatarFallback>
    </Avatar>
  )
}

/** The sidebar footer's account row: disc, label, address, lock state. Collapses to the disc alone. */
export function SidebarAccount() {
  const session = useSession()
  const [open, setOpen] = useState(false)

  if (session.status === 'booting') {
    return (
      <SidebarMenuItem>
        <Skeleton className="h-12 w-full rounded-md" />
      </SidebarMenuItem>
    )
  }
  if (session.status === 'fresh' || session.status === 'no-storage' || !session.address) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" disabled tooltip={NO_ACCOUNT}>
          <Avatar>
            <AvatarFallback />
          </Avatar>
          <span className="text-muted-foreground">{NO_ACCOUNT}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }
  const locked = session.status === 'locked'
  const name = session.label ?? shortAddress(session.address)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" tooltip={name} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Disc address={session.address} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate font-mono text-mono text-muted-foreground">{locked ? LOCKED_MARK : shortAddress(session.address)}</span>
        </span>
        {locked ? <Lock className="ml-auto text-muted-foreground" aria-hidden /> : null}
      </SidebarMenuButton>
      <AccountDrawer session={session} open={open} onOpenChange={setOpen} />
    </SidebarMenuItem>
  )
}

/** The phone's account row, at the top of the More sheet. Opens the same drawer. */
export function AccountRow() {
  const session = useSession()
  const [open, setOpen] = useState(false)

  if (session.status === 'booting') return <Skeleton className="h-14 w-full rounded-lg" />
  if (session.status === 'fresh' || session.status === 'no-storage' || !session.address) {
    return <p className="text-body4 text-muted-foreground">{NO_ACCOUNT}</p>
  }
  const locked = session.status === 'locked'
  return (
    <>
      <Item
        variant="outline"
        size="sm"
        className="text-left"
        render={<button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" />}
      >
        <Disc address={session.address} />
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{session.label ?? shortAddress(session.address)}</ItemTitle>
          <ItemDescription className="truncate font-mono text-mono">
            {shortAddress(session.address)}
            {locked ? ` · ${LOCKED_MARK}` : ''}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {locked ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : null}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </ItemActions>
      </Item>
      <AccountDrawer session={session} open={open} onOpenChange={setOpen} />
    </>
  )
}
