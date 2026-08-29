import type { SVGProps } from 'react'

/**
 * The strk20.run mark: a six-arm asterisk whose right arm runs off as an arrow. Same geometry as
 * `assets/brand/strk20-mark.svg`; drawn in `currentColor` so it takes whatever ink it sits in.
 */
export function BrandGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" {...props}>
      <g
        transform="translate(-18 0)"
        fill="none"
        stroke="currentColor"
        strokeWidth="68"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="336" y1="117.44" x2="176" y2="394.56" />
        <line x1="176" y1="117.44" x2="336" y2="394.56" />
        <line x1="96" y1="256" x2="452" y2="256" />
        <path d="M 394 198 L 452 256 L 394 314" />
      </g>
    </svg>
  )
}

/** The mark on its orange tile, plus the wordmark. The header lockup. */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BrandGlyph className="size-6" />
      </span>
      <span className="font-display text-display4 lowercase">
        strk20<span className="text-primary">.run</span>
      </span>
    </span>
  )
}
