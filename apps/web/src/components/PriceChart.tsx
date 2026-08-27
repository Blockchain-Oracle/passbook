//
// The canvas the price is drawn on.
//
// ── A CANVAS AND NOT AN SVG, AND NOT A CHART LIBRARY ─────────────────────────────────────
//
// Recharts is roughly 90 kB for one line with a threshold on it, and the one thing this chart does
// that a library will not is the verdict mode: the whole series drawn twice, clipped either side
// of the strike, so the picture answers "who is winning" with no legend. `lib/price-chart.ts` owns
// that; this component owns the React and DOM side of it, which is three problems:
//
//   1. The canvas has no intrinsic size, so its CSS box is the only source of truth — and it has
//      to be re-drawn when that box changes, which a `ResizeObserver` reports and a window resize
//      listener does not (a sidebar opening changes the box without changing the window).
//   2. The ink has to come from the THEME, and canvas inherits nothing. The values are read off
//      the computed style of a probe element so a theme flip repaints correctly.
//   3. Redrawing must not be a render. The draw runs in an effect against a ref; nothing here
//      holds pixel state in React.
//
import { useEffect, useRef } from 'react'

import { drawPriceLine, drawSparkline } from '../lib/price-chart'
import { cn } from '../lib/cn'

/**
 * Resolve a design token to the value canvas needs.
 *
 * Canvas takes colour strings and cannot read a CSS custom property, so the value is pulled off
 * the computed style of the element the chart is actually inside — which is what makes a chart on
 * a raised card and one on the page ground both correct, and what makes a theme toggle repaint
 * rather than leave last theme's gridlines behind.
 */
function token(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/**
 * Repaint when the theme changes — BOTH ways it can change.
 *
 * ── THE ATTRIBUTE IS ONLY HALF OF IT ─────────────────────────────────────────────────────
 *
 * The toggle writes `data-theme` on the root, so a `MutationObserver` catches a pinned change. But
 * the ABSENCE of that attribute is a first-class state — "follow the OS" — and it is the default
 * for anyone who has never pinned. `tokens.css` flips every token through
 * `@media (prefers-color-scheme: dark)` with no attribute mutation at all, so an unpinned user
 * switching macOS to dark got a canvas still drawn in light ink: `--color-surface3` at 8% black on
 * a #131313 ground is invisible. Nothing would have repainted it until the next distinct price,
 * and this feed can sit eleven minutes.
 */
function watchTheme(repaint: () => void): () => void {
  const attribute = new MutationObserver(repaint)
  attribute.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', repaint)

  return () => {
    attribute.disconnect()
    media.removeEventListener('change', repaint)
  }
}

export interface PriceChartProps {
  series: readonly number[]
  /** The strike. Present turns on verdict mode. */
  target?: number | null
  className?: string
  /** Rendered height in px. The width comes from the layout. */
  height?: number
  label?: string
}

export function PriceChart({ series, target = null, className, height = 220, label }: PriceChartProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return

    const paint = () => {
      drawPriceLine(element, {
        series,
        target,
        // Token names, resolved live — see `token`.
        up: token(element, '--color-settled', '#0c8911'),
        down: token(element, '--color-irreversible', '#e10f0f'),
        color: token(element, '--color-accent1', '#ff37c7'),
        grid: token(element, '--color-surface3', 'rgba(128,128,128,0.18)'),
      })
    }

    paint()

    // THE BOX, NOT THE WINDOW. A sidebar opening or a drawer docking changes this element's width
    // without firing `resize`, and the chart would keep its old geometry until something else
    // happened to redraw it.
    const observer = new ResizeObserver(paint)
    observer.observe(element)

    const stopWatchingTheme = watchTheme(paint)

    return () => {
      observer.disconnect()
      stopWatchingTheme()
    }
  }, [series, target])

  return (
    <canvas
      ref={canvas}
      // `block` matters: an inline canvas gets a baseline gap under it that reads as a broken
      // border. `w-full` plus an explicit height is what gives it a box to measure.
      className={cn('block w-full', className)}
      style={{ height }}
      // The picture is not the information — the numbers beside it are — so it is decorative to a
      // screen reader unless the caller gives it a name.
      role={label ? 'img' : 'presentation'}
      aria-label={label}
    />
  )
}

/** The tiny one, for a row. No axes, no smoothing — a shape rather than a chart. */
export function Sparkline({
  series,
  colour,
  className,
  width = 64,
  height = 24,
}: {
  series: readonly number[]
  /** A CSS custom property name, resolved against this element. */
  colour?: string
  className?: string
  width?: number
  height?: number
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const paint = () =>
      drawSparkline(element, series, token(element, colour ?? '--color-neutral3', '#888888'))
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(element)
    // A sparkline needs the theme watch just as much as the chart does — it had none, so after a
    // theme change three of these sat in the previous theme's ink until a new price landed, which
    // on a feed that stalls for minutes is a long time to look wrong.
    const stopWatchingTheme = watchTheme(paint)
    return () => {
      observer.disconnect()
      stopWatchingTheme()
    }
  }, [series, colour])

  return (
    <canvas
      ref={canvas}
      className={cn('block shrink-0', className)}
      style={{ width, height }}
      role="presentation"
    />
  )
}
