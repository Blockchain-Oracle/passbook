//
// Who you are, in the sidebar footer and at the top of the phone's More sheet.
//
// It used to show `session.label` — a nickname that only exists in this browser — with no `@` and
// no way to tell it apart from a claimed handle. So a registered account read as an unregistered
// one with a word next to it. The PUBLIC name leads now, the private label steps back to a chip,
// and an account with no public name says so rather than showing hex and hoping.
//
import { useState } from 'react'
import { ChevronRight, Lock } from 'lucide-react'

import { useSession } from '@/app/session'
import { IdentityAvatar } from '@/components/money/identity-avatar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { shortAddress } from '@/lib/format'
import { useIdentity } from '@/queries/identity'
import { AccountDrawer } from './account-drawer'
import { LOCKED_MARK, NO_ACCOUNT, NO_NAME_MARK } from './account-copy'

interface Who {
  /** What leads: the claimed handle, else the private label, else the address. */
  title: string
  /** The line under it: the address, or the missing-name prompt. */
  detail: string
  /** Shown only when a public name leads AND a private label also exists. */
  chip: string | null
  handle: string | null
}

function who(address: string, name: string | null, label: string | null): Who {
  if (name) {
    return {
      title: `@${name}`,
      detail: shortAddress(address),
      chip: label && label !== name ? label : null,
      handle: name,
    }
  }
  return { title: label ?? shortAddress(address), detail: NO_NAME_MARK, chip: null, handle: null }
}

/** The sidebar footer's account row. Collapses to the identicon alone. */
export function SidebarAccount() {
  const session = useSession()
  const identity = useIdentity(session.status === 'ready' || session.status === 'locked' ? session.address : null)
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
  const w = who(session.address, identity.name, session.label ?? null)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" tooltip={w.title} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <IdentityAvatar address={session.address} name={identity.name} avatar={identity.avatar} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{w.title}</span>
            {w.chip ? (
              <Badge variant="secondary" className="shrink-0 text-navLabel uppercase">
                {w.chip}
              </Badge>
            ) : null}
          </span>
          <span className="truncate font-mono text-mono text-muted-foreground">{locked ? LOCKED_MARK : w.detail}</span>
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
  const identity = useIdentity(session.status === 'ready' || session.status === 'locked' ? session.address : null)
  const [open, setOpen] = useState(false)

  if (session.status === 'booting') return <Skeleton className="h-14 w-full rounded-lg" />
  if (session.status === 'fresh' || session.status === 'no-storage' || !session.address) {
    return <p className="text-body4 text-muted-foreground">{NO_ACCOUNT}</p>
  }

  const locked = session.status === 'locked'
  const w = who(session.address, identity.name, session.label ?? null)
  return (
    <>
      <Item
        variant="outline"
        size="sm"
        className="text-left"
        render={<button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" />}
      >
        <IdentityAvatar address={session.address} name={identity.name} avatar={identity.avatar} />
        <ItemContent className="min-w-0">
          <ItemTitle className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{w.title}</span>
            {w.chip ? (
              <Badge variant="secondary" className="shrink-0 text-navLabel uppercase">
                {w.chip}
              </Badge>
            ) : null}
          </ItemTitle>
          <ItemDescription className="truncate font-mono text-mono">
            {w.detail}
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
