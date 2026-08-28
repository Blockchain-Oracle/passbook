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
    <div className={cn('mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-4 md:px-8 md:py-6', className)}>
      <header className="flex items-start gap-3">
        <SidebarTrigger className="mt-1 hidden md:inline-flex" />
        <div className="flex-1">
          {kicker ? <p className="text-kicker uppercase text-muted-foreground">{kicker}</p> : null}
          <h1 className="font-display text-display2 uppercase">{title}</h1>
          {description ? <p className="mt-1 max-w-prose text-body3 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}
