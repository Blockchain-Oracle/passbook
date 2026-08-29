import { Link, useLocation } from '@tanstack/react-router'

import { GROUP_LABEL, NAV, isActivePath, type NavGroup } from '@/app/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { SidebarAccount } from '@/features/account'

const GROUPS: readonly NavGroup[] = ['money', 'venues']

export function AppSidebar() {
  const { pathname } = useLocation()

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/wallet" />}>
              <span className="flex size-8 items-center justify-center rounded-md bg-primary font-display text-body2 text-primary-foreground">
                P
              </span>
              <span className="font-display text-display4 uppercase">Passbook</span>
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
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
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
