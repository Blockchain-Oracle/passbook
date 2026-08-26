//
// The token mark (Uniswap `packages/uniswap/src/components/CurrencyLogo/TokenLogo.tsx` is the model).
//
// ── THE FALLBACK IS THE POINT, NOT THE IMAGE ──────────────────────────────────────────────
//
// Any product can render a USDC logo when the CDN answers. What separates a product from a demo is
// what the other 30% of a token list looks like: a freshly launched token, a long tail asset, a
// blocked image request. Uniswap's answer — and this one — is a coloured disc carrying the first
// three characters of the symbol, where the COLOUR IS DERIVED FROM THE TOKEN'S NAME. It is stable
// (the same token is always the same colour), it is distinguishable (adjacent rows differ), and it
// never looks like a broken image.
//
// ── WHY THE SEED IS THE NAME AND NOT THE ADDRESS ──────────────────────────────────────────
//
// An address is uniform random, so hashing it gives uniform random hues — including several that
// collide with this app's semantic colours, and a token that happens to hash to the `irreversible`
// red reads as a warning. Seeding from the name keeps the mapping human-checkable, and the palette
// below is a closed hand-picked set rather than a hue wheel, so nothing can land on a status colour.
//
// ── AND IT NEVER SPENDS A SEMANTIC TOKEN ──────────────────────────────────────────────────
//
// The discs use their own literal palette, declared here. Every other colour in this app is a design
// token, and this is the deliberate exception: these are IDENTITY marks, not statements about
// state, and routing them through `--color-*` would make a token's brand colour theme-dependent.
//
import { useState } from 'react'

import { cn } from '../lib/cn'

/**
 * The disc palette. Eight pairs, each `{ background, foreground }`, all checked for contrast.
 *
 * Warm and muted on purpose: the app's surfaces are warm paper, and a saturated web palette on top
 * of them reads as a foreign widget. None of these is near `exposed` amber or `irreversible` red.
 */
const DISCS: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#E8DCC8', fg: '#4A3B24' },
  { bg: '#D6E0D2', fg: '#2C4029' },
  { bg: '#DCDCEA', fg: '#2F3050' },
  { bg: '#EADCD6', fg: '#4E3229' },
  { bg: '#D4E2E6', fg: '#23414A' },
  { bg: '#E6DCE6', fg: '#452F45' },
  { bg: '#DEE4D0', fg: '#37421F' },
  { bg: '#E2D8DE', fg: '#452C39' },
]

/**
 * A small, stable, order-independent hash. Not cryptographic and does not need to be — the only
 * requirement is that the same name always picks the same disc.
 */
function discFor(seed: string): { bg: string; fg: string } {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return DISCS[hash % DISCS.length]!
}

export interface TokenLogoProps {
  /** The token's image, when the token list supplied one. */
  url?: string | null
  symbol?: string | null
  /** Seeds the fallback disc's colour. Falls back to the symbol when a list omits the name. */
  name?: string | null
  /** Pixels. 40 in lists, 28 in the swap pill, 24 in dense rows. */
  size?: number
  /** A small mark overlaid bottom-right — the network, or a badge a surface wants to attach. */
  badge?: React.ReactNode
  className?: string
}

/** Uniswap's `STATUS_RATIO`: the badge is 40% of the logo, which holds at every size. */
const BADGE_RATIO = 0.4

export function TokenLogo({ url, symbol, name, size = 40, badge, className }: TokenLogoProps) {
  // A URL that 404s or is blocked has to fall back at RUNTIME, not just when the list omits one.
  // Without this, a broken image is a transparent hole where the mark should be.
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(url) && !failed

  const disc = discFor(name || symbol || '')
  const letters = (symbol ?? '').slice(0, 3).toUpperCase()
  const badgeSize = Math.round(size * BADGE_RATIO)

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={url ?? undefined}
          // Empty alt, and deliberately: every caller renders the symbol as text beside this mark,
          // so a described image makes a screen reader say the token's name twice.
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full rounded-pill object-cover"
          // A white disc behind the image so a logo with a transparent background does not sit
          // directly on warm paper — which is what makes third-party marks look pasted on.
          style={{ backgroundColor: '#FFFFFF' }}
        />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-pill"
          style={{
            backgroundColor: disc.bg,
            color: disc.fg,
            // Scales with the disc so 24px and 40px both read. Not a token: it is a function of
            // this component's own geometry, and the type scale has no continuum.
            fontSize: Math.max(9, Math.round(size * 0.34)),
            fontWeight: 535,
            letterSpacing: '-0.02em',
          }}
        >
          {letters}
        </span>
      )}

      {badge ? (
        <span
          className="absolute rounded-pill bg-ground"
          // Offset outside the disc's edge, with a ring in the page colour so the badge punches a
          // hole in the mark rather than sitting on top of it. Uniswap's `-2 / -3`.
          style={{ bottom: -2, right: -3, width: badgeSize, height: badgeSize, padding: 1.5 }}
        >
          {badge}
        </span>
      ) : null}
    </span>
  )
}
