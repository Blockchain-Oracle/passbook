import type { PricePoint } from '@strk20/protocol/chain-feed-wire'

import { cn } from '@/lib/utils'

export interface SparklineProps {
  /** Oldest first; `p` is a decimal price. */
  points: readonly PricePoint[]
  /** The window's start, epoch ms. Readings from here on are drawn; older ones pad a young window. */
  fromMs: number
  /** The level to colour against, as a decimal. Absent: the first drawn point. */
  reference: number | null
  /** The live price, decimal — drawn as the last point when the relay's history is behind it. */
  spot: number | null
  className?: string
}

const W = 240
const H = 56
/** A window that has just opened has one or two readings; pad it from before the mark to this many. */
const MIN_POINTS = 12

/**
 * The window's price as one line, green above the line it is measured against and red below.
 * Inline SVG on purpose: ten of these sit in a rail and none of them should pull a chart library.
 */
export function Sparkline({ points, fromMs, reference, spot, className }: SparklineProps) {
  let data = points.filter((p) => p.t >= fromMs)
  if (data.length < MIN_POINTS) data = points.slice(-MIN_POINTS)
  if (spot !== null && (data.length === 0 || data[data.length - 1]!.p !== spot)) data = [...data, { t: Date.now(), p: spot }]
  if (data.length === 0) {
    return <div className={cn('h-14 w-full rounded-md bg-muted/40', className)} aria-hidden />
  }
  const level = reference ?? data[0]!.p
  const lo = Math.min(level, ...data.map((p) => p.p))
  const hi = Math.max(level, ...data.map((p) => p.p))
  const span = hi - lo || Math.abs(level) * 0.001 || 1
  const t0 = data[0]!.t
  const t1 = data[data.length - 1]!.t
  const x = (t: number) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W)
  const y = (p: number) => 4 + (1 - (p - lo) / span) * (H - 8)
  const path = data.length === 1 ? `M0 ${y(data[0]!.p).toFixed(1)} L${W} ${y(data[0]!.p).toFixed(1)}` : data.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}`).join(' ')
  const last = data[data.length - 1]!.p
  const tone = last >= level ? 'text-settled' : 'text-irreversible'
  const markX = fromMs > t0 && fromMs < t1 ? x(fromMs) : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn('h-14 w-full', tone, className)} role="img" aria-label="Price over this window">
      <line x1="0" x2={W} y1={y(level)} y2={y(level)} className="stroke-muted-foreground/40" strokeDasharray="3 4" strokeWidth="1" />
      {markX !== null ? <line x1={markX} x2={markX} y1="0" y2={H} className="stroke-muted-foreground/30" strokeWidth="1" /> : null}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={W} cy={y(last)} r="2.5" fill="currentColor" />
    </svg>
  )
}
