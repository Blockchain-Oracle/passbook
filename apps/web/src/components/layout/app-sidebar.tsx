import { Link, useLocation } from '@tanstack/react-router'

import { GROUP_LABEL, NAV, isActivePath, type NavGroup } from '@/app/navigation'
import { BrandLockup } from '@/components/brand/brand-mark'
import { NotificationCenter } from '@/components/layout/notification-center'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { SidebarAccount } from '@/features/account'
import { useTotalUnread } from '@/features/chat'
import { useSession } from '@/app/session'

const GROUPS: readonly NavGroup[] = ['money', 'venues']

export function AppSidebar() {
  const { pathname } = useLocation()
  const session = useSession()
  // The socket lives at the app root now, so this number is live on every surface rather than
  // only on the one that used to own the connection.
  const unread = useTotalUnread(session.status === 'ready' ? session.address : undefined)

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/wallet" />}>
              <BrandLockup />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{GROUP_LABEL[group]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.filter((item) => item.group === group).map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={isActivePath(pathname, item.to)}
                      tooltip={item.label}
                      render={<Link to={item.to} />}
                    >
                      <item.icon aria-hidden />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.to === '/chat' && unread > 0 ? <SidebarMenuBadge>{unread}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <NotificationCenter />
          <SidebarAccount />
          {NAV.filter((item) => item.group === 'system').map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={isActivePath(pathname, item.to)}
                tooltip={item.label}
                render={<Link to={item.to} />}
              >
                <item.icon aria-hidden />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
