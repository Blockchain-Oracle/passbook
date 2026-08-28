import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileTabs } from '@/components/layout/mobile-tabs'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AccountChip } from '@/features/account'
import { OnboardingGate } from '@/features/onboarding'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Shell,
})

function Shell() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="pb-20 md:pb-0">
          {/* The account chip sits above every surface until the sidebar footer takes it. */}
          <div className="flex justify-end px-4 pt-3 md:px-8">
            <AccountChip />
          </div>
          <OnboardingGate />
          <Outlet />
        </SidebarInset>
        <MobileTabs />
        <Toaster position="top-center" />
      </SidebarProvider>
    </TooltipProvider>
  )
}
