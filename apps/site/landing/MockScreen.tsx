'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A screen of the product, rendered as a scaled iframe over a static file in `/public`.
 *
 * ── WHY AN IFRAME AND NOT A SCREENSHOT ────────────────────────────────────────────────────
 *
 * A screenshot is a raster at one density, so it is soft on every display that is not the one it
 * was taken on, and it goes stale silently — the page keeps showing last month's product and
 * nothing fails. These mocks are markup: crisp at any zoom and DPR, diffable, and they live in this
 * repository next to the tokens they are built from.
 *
 * ── AND WHY NOT THE REAL COMPONENTS ───────────────────────────────────────────────────────
 *
 * The app is Vite + TanStack Router and this site is Next; a shared UI package to bridge them is
 * real work for a page that needs four static screens. More to the point, the app's surfaces read
 * a chain — rendering them here would either need a wallet or fake reads, and a marketing page
 * showing invented balances is the thing this product is supposed to be against. A hand-built
 * screen is honestly a drawing, and it is labelled as one.
 *
 * `aria-hidden` and `pointer-events: none` throughout: it is an illustration, so it must not be a
 * tab stop, must not be read aloud, and must not look interactive when it is not.
 */
export function MockScreen({
  src,
  width,
  height,
  className,
  maxHeight,
}: {
  readonly src: string
  readonly width: number
  readonly height: number
  readonly className?: string
  /** Crops the bottom so a tall screen can peek rather than dominate. */
  readonly maxHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    // The natural width is fixed, so the scale is whatever the column gives us.
    const observer = new ResizeObserver(() => setScale(node.clientWidth / width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [width])

  const natural = Math.round(height * scale)
  return (
    <div
      ref={ref}
      aria-hidden
      className={className}
      style={{
        // Height only once the width is known: rendering at scale 0 would flash a full-size iframe.
        height: scale > 0 ? (maxHeight ? Math.min(natural, maxHeight) : natural) : undefined,
        overflow: 'hidden',
      }}
    >
      {scale > 0 ? (
        <iframe
          src={src}
          title=""
          tabIndex={-1}
          loading="lazy"
          scrolling="no"
          style={{
            width,
            height,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
            colorScheme: 'dark',
            background: 'transparent',
          }}
        />
      ) : null}
    </div>
  )
}
