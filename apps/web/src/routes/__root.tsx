import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileTabs } from '@/components/layout/mobile-tabs'
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
        {/* `min-w-0` + clip: a wide row inside a surface scrolls or wraps inside it; it never widens the page. */}
        <SidebarInset className="min-w-0 overflow-x-clip pb-20 md:pb-0">
          <OnboardingGate />
          <TabBanner />
          <Outlet />
        </SidebarInset>
        <MobileTabs />
        <Toaster position="top-center" />
      </SidebarProvider>
    </TooltipProvider>
  )
}
