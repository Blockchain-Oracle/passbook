import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, useLocation } from '@tanstack/react-router'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { MobileTabs } from '@/components/layout/mobile-tabs'
import { NotFoundPage } from '@/components/layout/not-found'
import { AccountBanner } from '@/components/layout/account-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatStreamProvider } from '@/features/chat'
import { OnboardingGate } from '@/features/onboarding'
import { useRecoverySync } from '@/app/session'
import { cn } from '@/lib/utils'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Shell,
  // Rendered in the Outlet's place, so the shell around it stays.
  notFoundComponent: NotFoundPage,
})

function Shell() {
  //
  // Chat is the one surface that scrolls INSIDE itself rather than scrolling the document: a
  // message list needs its own scrollbar so the composer can stay put at the bottom of the SCREEN
  // instead of at the bottom of an ever-growing page. That only works if an ancestor is genuinely
  // viewport-height — `min-h-svh` grows, `h-svh` bounds — after which the surfaces below chain
  // `flex-1 min-h-0` down to the list. Every other page keeps document scrolling, which is why
  // this is a route check and not a new shell for the whole app.
  //
  // THE HEIGHT GOES ON THE WRAPPER, NOT ON THE INSET, and the difference is visible. The inset
  // carries `md:m-2` in the `inset` variant, so `h-svh` on the inset itself measures svh INSIDE
  // the margin and the layout ends up a rem taller than the screen — the composer sits just below
  // the fold on a desktop. Bounding the flex parent instead lets `align-items: stretch` size the
  // child, and stretch subtracts a child's margins. One rem, and it is the whole bug.
  //
  const { pathname } = useLocation()
  const bounded = pathname === '/chat' || pathname.startsWith('/chat/')
  // App-wide, like the chat stream: a passkey vault's sealed copy follows every local write.
  useRecoverySync()

  return (
    <TooltipProvider>
      <SidebarProvider className={cn(bounded && 'h-svh overflow-hidden')}>
        <AppSidebar />
        {/* `min-w-0` + clip: a wide row inside a surface scrolls or wraps inside it; it never widens the page.
            `@container` is what stops that clip from EATING content: the surfaces below split on the
            width they actually have, not on the window's, which is 200px of sidebar wider.
            `pb-20` is the phone tab bar's height, so a bounded page stops above it rather than under it. */}
        <SidebarInset
          className={cn('@container min-w-0 overflow-x-clip pb-20 md:pb-0', bounded && 'min-h-0 overflow-y-hidden')}
        >
          <ChatStreamProvider>
            <OnboardingGate />
            <AccountBanner />
            <Outlet />
          </ChatStreamProvider>
        </SidebarInset>
        <MobileTabs />
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
