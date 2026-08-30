import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'

import { MOBILE_MORE, MOBILE_TABS, isActivePath, type NavItem } from '@/app/navigation'
import { NotificationCenter } from '@/components/layout/notification-center'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AccountRow } from '@/features/account'
import { cn } from '@/lib/utils'

const tabClass = (active: boolean) =>
  cn(
    'flex flex-1 flex-col items-center gap-1 py-2 text-navLabel uppercase',
    active ? 'text-primary' : 'text-muted-foreground',
  )

function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.to)
  return (
    <Link to={item.to} className={tabClass(active)} aria-current={active ? 'page' : undefined}>
      <item.icon className="size-5" aria-hidden />
      {item.label}
    </Link>
  )
}

/** Phone navigation: four tabs and a More sheet that also holds the account. Hidden from `md` up. */
export function MobileTabs() {
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE.some((item) => isActivePath(pathname, item.to))

  // `z-40`, under every sheet and dialog (`z-50`): a review sheet's confirm button must never sit behind the tabs.
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
      {MOBILE_TABS.map((item) => (
        <Tab key={item.to} item={item} pathname={pathname} />
      ))}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger className={tabClass(moreActive)}>
          <Ellipsis className="size-5" aria-hidden />
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
                  <item.icon className="size-5" aria-hidden />
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
