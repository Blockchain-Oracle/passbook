//
// The brand, as the site's chrome carries it. Same asterisk-arrow geometry as
// `assets/brand/strk20-mark.svg`; the glyph is `currentColor` so the tile decides its ink.
//
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
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

/** Tile + wordmark. `.run` takes the orange, as it does everywhere else the name is written. */
export function BrandLockup() {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-s28 shrink-0 items-center justify-center rounded-card bg-accent1 text-onAccent"
      >
        <BrandGlyph className="size-s20" />
      </span>
      <span className="display hidden text-heading3 xs:inline">
        strk20<span className="text-accent1">.run</span>
      </span>
    </>
  )
}
