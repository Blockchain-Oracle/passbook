import type { ReactNode } from 'react'

import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

interface PageProps {
  kicker?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}

/** Every surface's frame: kicker, display title, optional actions, then content. */
export function Page({ kicker, title, description, actions, className, children }: PageProps) {
  return (
    // A second container: `max-w-5xl` caps the content well below the inset on a wide screen, so a
    // surface asking "have I room for two columns" has to ask about THIS box, not the one outside it.
    <div className={cn('@container mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-4 md:px-8 md:py-6', className)}>
      {/* The title block keeps a phone's width to itself; the actions drop under it rather than squeeze it. */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <SidebarTrigger className="mt-1 hidden md:inline-flex" />
          <div className="min-w-0 flex-1">
            {kicker ? <p className="text-kicker uppercase text-muted-foreground">{kicker}</p> : null}
            <h1 className="wrap-break-word font-display text-display3 uppercase md:text-display2">{title}</h1>
            {description ? <p className="mt-1 max-w-prose text-body3 text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}
