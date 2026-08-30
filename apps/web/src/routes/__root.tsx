import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileTabs } from '@/components/layout/mobile-tabs'
import { SponsorshipBanner } from '@/components/layout/sponsorship-banner'
import { TabBanner } from '@/components/layout/tab-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OnboardingGate } from '@/features/onboarding'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Shell,
})

function Shell() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        {/* `min-w-0` + clip: a wide row inside a surface scrolls or wraps inside it; it never widens the page.
            `@container` is what stops that clip from EATING content: the surfaces below split on the
            width they actually have, not on the window's, which is 200px of sidebar wider. */}
        <SidebarInset className="@container min-w-0 overflow-x-clip pb-20 md:pb-0">
          <OnboardingGate />
          <TabBanner />
          <SponsorshipBanner />
          <Outlet />
        </SidebarInset>
        <MobileTabs />
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
