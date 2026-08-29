import type { PricePoint } from '@strk20/protocol/chain-feed-wire'

import { cn } from '@/lib/utils'

export interface SparklineProps {
  /** Oldest first, 8-dp fixed point. Only points at or after `fromMs` are drawn. */
  points: readonly PricePoint[]
  fromMs: number
  /** The level to colour against, 8-dp. Absent: the first drawn point. */
  reference: number | null
  className?: string
}

const W = 240
const H = 56

/**
 * The window's price as one line, green above the line it is measured against and red below.
 * Inline SVG on purpose: ten of these sit in a rail and none of them should pull a chart library.
 */
export function Sparkline({ points, fromMs, reference, className }: SparklineProps) {
  const data = points.filter((p) => p.t >= fromMs)
  if (data.length < 2) {
    return (
      <div className={cn('flex h-14 items-center justify-center text-body4 text-muted-foreground', className)} aria-hidden>
        Collecting readings…
      </div>
    )
  }
  const level = reference ?? data[0]!.p
  const lo = Math.min(level, ...data.map((p) => p.p))
  const hi = Math.max(level, ...data.map((p) => p.p))
  const span = hi - lo || 1
  const t0 = data[0]!.t
  const t1 = data[data.length - 1]!.t
  const x = (t: number) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W)
  const y = (p: number) => 4 + (1 - (p - lo) / span) * (H - 8)
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}`).join(' ')
  const last = data[data.length - 1]!.p
  const tone = last >= level ? 'text-settled' : 'text-irreversible'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn('h-14 w-full', tone, className)} role="img" aria-label="Price over this window">
      <line x1="0" x2={W} y1={y(level)} y2={y(level)} className="stroke-muted-foreground/40" strokeDasharray="3 4" strokeWidth="1" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(t1)} cy={y(last)} r="2.5" fill="currentColor" />
    </svg>
  )
}
