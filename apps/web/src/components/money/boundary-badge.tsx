import { Eye, Lock, ScanEye, ShieldCheck } from 'lucide-react'

import { BOUNDARY, type BoundaryKind, type BoundaryTone } from '@/app/boundary'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TONE_CLASS: Record<BoundaryTone, string> = {
  shielded: 'border-shieldedEdge bg-shieldedTint text-shielded',
  public: 'border-publicEdge bg-publicTint text-public',
  exposed: 'border-dashed border-exposed bg-exposedTint text-exposed',
  neutral: 'border-border bg-muted text-muted-foreground',
}

const TONE_ICON: Record<BoundaryTone, typeof Lock> = {
  shielded: ShieldCheck,
  public: Eye,
  exposed: ScanEye,
  neutral: Lock,
}

/** Surface header and review row only — never per list row. Solid ring = shielded, dashed = exposed. */
export function BoundaryBadge({ kind, className }: { kind: BoundaryKind; className?: string }) {
  const boundary = BOUNDARY[kind]
  const Icon = TONE_ICON[boundary.tone]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className={cn('gap-1 uppercase text-navLabel', TONE_CLASS[boundary.tone], className)} />
        }
      >
        <Icon className="size-3" aria-hidden />
        {boundary.label}
      </TooltipTrigger>
      <TooltipContent>{boundary.hint}</TooltipContent>
    </Tooltip>
  )
}
