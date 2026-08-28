import { useState } from 'react'
import { Eye, ShieldCheck } from 'lucide-react'
import { logoDisplayUrl } from '@strk20/protocol/token-media'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type AssetBoundary = 'shielded' | 'public'

/**
 * The disc palette for a token with no logo. Eight warm pairs, closed on purpose: seeded from the
 * NAME (not the address) so the mapping is stable and never lands on a status colour. These are
 * identity marks, so they are the one deliberate exception to "every colour is a token".
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

function discFor(seed: string): { bg: string; fg: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return DISCS[hash % DISCS.length]!
}

/** The disc background a name seeds — for surfaces that tint around a mark. */
export function accentFor(seed: string): string {
  return discFor(seed).bg
}

export interface TokenLogoProps {
  logoUri?: string | null
  symbol: string
  /** Seeds the fallback disc; falls back to the symbol. */
  name?: string | null
  size?: number
  className?: string
}

/** The mark alone: image when the URI resolves and loads, else the name-seeded disc. */
export function TokenLogo({ logoUri, symbol, name, size = 32, className }: TokenLogoProps) {
  const [failed, setFailed] = useState(false)
  const url = logoDisplayUrl(logoUri)
  const disc = discFor(name || symbol)
  const showImage = url !== null && !failed
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full rounded-pill bg-white object-cover"
        />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-pill font-medium"
          style={{ backgroundColor: disc.bg, color: disc.fg, fontSize: Math.max(9, Math.round(size * 0.34)), letterSpacing: '-0.02em' }}
        >
          {symbol.slice(0, 3).toUpperCase()}
        </span>
      )}
    </span>
  )
}

const SIZES = { sm: 24, md: 32, lg: 40 } as const

const CHIP: Record<AssetBoundary, { label: string; hint: string; className: string; Icon: typeof ShieldCheck }> = {
  shielded: {
    label: 'SHIELDED',
    // The auditor holds an escrowed viewing key: no "only you" here, phrased or otherwise.
    hint: 'Inside the pool. Held as encrypted notes; the relayer and the auditor can read them, other users cannot.',
    className: 'border-shielded bg-shieldedTint text-shielded',
    Icon: ShieldCheck,
  },
  public: {
    label: 'PUBLIC',
    hint: 'On your public Starknet address. Anyone can read this balance.',
    className: 'border-dashed border-public bg-publicTint text-public',
    Icon: Eye,
  },
}

export interface AssetIdentityProps {
  symbol: string
  name?: string | null
  logoUri?: string | null
  boundary: AssetBoundary
  size?: keyof typeof SIZES
  /** Hide the chip when the surface header already names the boundary. */
  chip?: boolean
  className?: string
}

/**
 * Canonical logo + boundary overlay + chip. Solid lime ring = shielded, dashed amber = public, so
 * the difference survives greyscale; the shield overlay sits on the logo's corner.
 */
export function AssetIdentity({ symbol, name, logoUri, boundary, size = 'md', chip = true, className }: AssetIdentityProps) {
  const px = SIZES[size]
  const overlay = Math.round(px * 0.45)
  const meta = CHIP[boundary]
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                'relative inline-flex rounded-pill border-2 p-px',
                boundary === 'shielded' ? 'border-shielded' : 'border-dashed border-public',
              )}
            />
          }
        >
          <TokenLogo logoUri={logoUri} symbol={symbol} name={name} size={px} />
          {boundary === 'shielded' ? (
            <span
              className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-pill bg-shielded text-ground ring-2 ring-raised"
              style={{ width: overlay, height: overlay }}
              aria-hidden
            >
              <ShieldCheck style={{ width: overlay * 0.66, height: overlay * 0.66 }} />
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{meta.hint}</TooltipContent>
      </Tooltip>
      <span className="flex flex-col leading-tight">
        <span className="text-body3 font-medium">{symbol}</span>
        {chip ? (
          <Badge variant="outline" className={cn('h-4 gap-1 px-1.5 text-[10px] tracking-[0.12em]', meta.className)}>
            <meta.Icon aria-hidden />
            {meta.label}
          </Badge>
        ) : null}
      </span>
    </span>
  )
}
