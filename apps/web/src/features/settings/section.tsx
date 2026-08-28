import type { ReactNode } from 'react'

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface SettingsSectionProps {
  id: string
  /** `01`, `02`… — the STUDIO kicker numbering. */
  index: string
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'danger'
  children: ReactNode
}

/** One settings card: numbered kicker, display title, then Items. */
export function SettingsSection({ id, index, title, description, action, tone = 'default', children }: SettingsSectionProps) {
  return (
    <Card id={id} className={cn('scroll-mt-24', tone === 'danger' && 'ring-irreversible/40')}>
      <CardHeader>
        <p className="text-kicker uppercase text-muted-foreground">
          {index} — {title}
        </p>
        <CardTitle className={cn('font-display text-display4 uppercase', tone === 'danger' && 'text-irreversible')}>{title}</CardTitle>
        {description ? <CardDescription className="max-w-prose text-body4">{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}
