//
// Where a notification goes after its four seconds are up.
//
// The toast is the interruption; this is the record. Same tones, same hashes, no urgency — you
// come here because you missed something or want to re-read it, which is exactly the case the
// toast alone could not serve.
//
import { useState } from 'react'
import { Bell, Inbox } from 'lucide-react'

import type { NotificationTone } from '@/components/ui/notification'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useNow } from '@/hooks/use-now'
import {
  clearNotifications,
  markNotificationsRead,
  useNotifications,
  type NotificationRecord,
} from '@/lib/notification-store'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

const DOT: Record<NotificationTone, string> = {
  moving: 'bg-accent1',
  settled: 'bg-settled',
  refused: 'bg-irreversible',
  warned: 'bg-exposed',
  noted: 'bg-neutral3',
}

function ago(at: number, now: number): string {
  const gap = Math.max(0, now - at)
  if (gap < 60_000) return 'now'
  if (gap < 3_600_000) return `${Math.floor(gap / 60_000)}m`
  if (gap < 86_400_000) return `${Math.floor(gap / 3_600_000)}h`
  return `${Math.floor(gap / 86_400_000)}d`
}

function Row({ record, now }: { record: NotificationRecord; now: number }) {
  return (
    <Item size="sm" variant="default" className="items-start gap-2">
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-pill', DOT[record.tone])} aria-hidden />
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="flex w-full items-start gap-2">
          <span className="min-w-0 flex-1 whitespace-normal">{record.title}</span>
          <span className="shrink-0 text-body4 text-muted-foreground">{ago(record.at, now)}</span>
        </ItemTitle>
        {record.description ? <ItemDescription className="whitespace-normal">{record.description}</ItemDescription> : null}
        {record.hash ? (
          <a
            href={explorerTx(record.hash)}
            target="_blank"
            rel="noreferrer"
            className="w-fit font-mono text-mono text-accent1 underline underline-offset-4"
          >
            {shortAddress(record.hash, 8, 6)}
          </a>
        ) : null}
      </ItemContent>
    </Item>
  )
}

/** The list itself, so the sidebar popover and the phone's sheet show one thing, not two. */
function NotificationList({ records }: { records: readonly NotificationRecord[] }) {
  // The same 30s tick the rest of the app reads relative times from.
  const now = useNow(30_000)
  if (records.length === 0) {
    return (
      <Empty className="py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Nothing yet</EmptyTitle>
          <EmptyDescription>Submissions, settlements and refusals collect here as they happen.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <ItemGroup className="max-h-80 gap-1 overflow-y-auto">
        {records.map((record) => (
          <Row key={record.id} record={record} now={now} />
        ))}
      </ItemGroup>
      <div className="flex justify-end border-t px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={clearNotifications}>
          Clear
        </Button>
      </div>
    </>
  )
}

function Title({ unread }: { unread: number }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <span className="text-kicker uppercase text-muted-foreground">Notifications</span>
      {unread > 0 ? <Badge className="ml-auto">{unread} new</Badge> : null}
    </div>
  )
}

/**
 * The sidebar footer's bell. `variant="row"` is the same thing as a full-width button, for the
 * phone's More sheet where there is no sidebar to hang a popover off.
 */
export function NotificationCenter({ variant = 'sidebar' }: { variant?: 'sidebar' | 'row' }) {
  const { records, unread } = useNotifications()
  const [open, setOpen] = useState(false)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) markNotificationsRead()
  }

  const count = unread > 9 ? '9+' : String(unread)

  if (variant === 'row') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger
          render={
            <Button variant="outline" className="w-full justify-start">
              <Bell data-icon="inline-start" aria-hidden />
              Notifications
              {unread > 0 ? <Badge className="ml-auto">{count}</Badge> : null}
            </Button>
          }
        />
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <NotificationList records={records} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger render={<SidebarMenuButton tooltip="Notifications" />}>
          <span className="relative">
            <Bell aria-hidden />
            {/* The dot rides the icon so it survives the sidebar collapsing to icons alone. */}
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-pill bg-accent1 ring-2 ring-sidebar" aria-hidden />
            ) : null}
          </span>
          <span>Notifications</span>
          {unread > 0 ? <Badge className="ml-auto">{count}</Badge> : null}
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-80 p-0">
          <Title unread={unread} />
          <NotificationList records={records} />
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}
