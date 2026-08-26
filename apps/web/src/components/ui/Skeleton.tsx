//
// Loading shapes (Uniswap `packages/ui/src/loading/{Shine,FlexLoader,Loader}.tsx` is the model).
//
// ── THE SHIMMER WRAPS, IT DOES NOT DRAW ───────────────────────────────────────────────────
//
// `<Skeleton>` applies a moving gradient MASK to whatever is inside it. It draws nothing itself.
// That is why there is no `<TokenRowSkeleton>`, no `<BalanceSkeleton>`, no per-screen loading
// component anywhere in this app: you wrap the real layout, or you wrap a `<SkeletonBox>`, and the
// shape is right by construction because it IS the shape.
//
// ── AND IT REPORTS ITS OWN MOTION TO ASSISTIVE TECH THROUGH THE CALLER ────────────────────
//
// No `aria-busy` here. The element that is loading owns that state — `Text` sets it — because a
// wrapper announcing "busy" around a box announces a box.
//
import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/cn'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Turn the sweep off without unwrapping — for the "warm" case, where real data is refreshing. */
  disabled?: boolean
}

/**
 * Sweeps a highlight across its children.
 *
 * `.shimmer` lives in `index.css` because it needs a `@keyframes` and a reduced-motion override by
 * name — the blanket `*` rule in that block is specificity 0,0,0 and loses to an authored
 * `animation-name`.
 */
export function Skeleton({ disabled = false, className, children, ...rest }: SkeletonProps) {
  return (
    <div className={cn(!disabled && 'shimmer', className)} {...rest}>
      {children}
    </div>
  )
}

export interface SkeletonBoxProps extends HTMLAttributes<HTMLDivElement> {
  /** Any `--spacing-s*` height utility, e.g. `h-s20`. Defaults to a text-sized bar. */
  className?: string
}

/**
 * One grey bar. The thing you wrap when there is no real layout to wrap yet.
 *
 * `neutral3` rather than a dedicated skeleton colour: it is the design authority's faintest ink and
 * it already follows the theme, so a placeholder is never a light-mode grey on a dark surface.
 */
export function SkeletonBox({ className, ...rest }: SkeletonBoxProps) {
  return <div className={cn('h-s20 w-full rounded-control bg-neutral3', className)} {...rest} />
}

/**
 * `count` stacked bars, each fainter than the last.
 *
 * The fade is Uniswap's `(length - i) / length` — a list of identical bars reads as content that has
 * arrived, and the fade is what says "this continues, and none of it is real yet".
 */
export function SkeletonRows({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-s8', className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} style={{ opacity: (count - index) / count }}>
          <SkeletonBox />
        </Skeleton>
      ))}
    </div>
  )
}
