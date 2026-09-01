import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'

import { MOBILE_MORE, MOBILE_TABS, isActivePath, type NavItem } from '@/app/navigation'
import { useSession } from '@/app/session'
import { NotificationCenter } from '@/components/layout/notification-center'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AccountRow } from '@/features/account'
import { useTotalUnread } from '@/features/chat'
import { cn } from '@/lib/utils'

const tabClass = (active: boolean) =>
  cn(
    'flex flex-1 flex-col items-center gap-1 py-2 text-navLabel uppercase',
    active ? 'text-primary' : 'text-muted-foreground',
  )

function Tab({ item, pathname, badge = 0 }: { item: NavItem; pathname: string; badge?: number }) {
  const active = isActivePath(pathname, item.to)
  return (
    <Link to={item.to} className={tabClass(active)} aria-current={active ? 'page' : undefined}>
      <span className="relative">
        <item.icon className="size-5" aria-hidden />
        {badge > 0 ? (
          // Capped at 9+: a tab is 20% of a phone's width and a four-digit count would own it.
          <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      {item.label}
    </Link>
  )
}

/** Phone navigation: four tabs and a More sheet that also holds the account. Hidden from `md` up. */
export function MobileTabs() {
  const { pathname } = useLocation()
  const session = useSession()
  const unread = useTotalUnread(session.status === 'ready' ? session.address : undefined)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE.some((item) => isActivePath(pathname, item.to))

  // `z-40`, under every sheet and dialog (`z-50`): a review sheet's confirm button must never sit behind the tabs.
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
      {MOBILE_TABS.map((item) => (
        <Tab key={item.to} item={item} pathname={pathname} badge={item.to === '/chat' ? unread : 0} />
      ))}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* Chat is behind More on a phone, so the count has to be readable without opening it —
            a badge nobody can see until they go looking is not a notification. */}
        <SheetTrigger className={tabClass(moreActive)}>
          <span className="relative">
            <Ellipsis className="size-5" aria-hidden />
            {unread > 0 ? (
              <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </span>
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <AccountRow />
            <NotificationCenter variant="row" />
            <div className="grid grid-cols-3 gap-2">
              {MOBILE_MORE.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border p-4 text-body4',
                    isActivePath(pathname, item.to) && 'border-primary text-primary',
                  )}
                >
                  <span className="relative">
                    <item.icon className="size-5" aria-hidden />
                    {item.to === '/chat' && unread > 0 ? (
                      <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    ) : null}
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  )
}
