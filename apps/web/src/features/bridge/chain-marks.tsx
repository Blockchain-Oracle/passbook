import { cn } from '@/lib/utils'

// The six destination marks as inline SVG — never fetched, never a letter disc. Polygon and Solana
// are the svgl.app vectors; Ethereum is the two-facet diamond; Base, Optimism and Arbitrum are drawn
// from their published geometry on their brand colours. Def ids are namespaced `pbchain-*` and
// identical across instances, so several marks on one page paint correctly.

export type ChainKey = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'solana'

interface MarkProps {
  size: number
}

function EthereumMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#627eea" />
      <g fill="#fff">
        <path d="M18.2 5.5v9.24l7.8 3.49Z" fillOpacity=".6" />
        <path d="M18.2 5.5 10.4 18.23l7.8-3.49Z" />
        <path d="M18.2 24.62v6.05L26 20.03Z" fillOpacity=".6" />
        <path d="M18.2 30.67v-6.05L10.4 20.03Z" />
        <path d="m18.2 23.17 7.8-4.94-7.8-3.48Z" fillOpacity=".2" />
        <path d="m10.4 18.23 7.8 4.94v-8.42Z" fillOpacity=".6" />
      </g>
    </svg>
  )
}

function BaseMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <clipPath id="pbchain-base-clip">
          <circle cx="18" cy="18" r="18" />
        </clipPath>
      </defs>
      <circle cx="18" cy="18" r="18" fill="#0052ff" />
      <rect x="0" y="16.3" width="21.4" height="3.4" fill="#fff" clipPath="url(#pbchain-base-clip)" />
    </svg>
  )
}

function ArbitrumMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#213147" />
      <path d="m19.9 14.4 3.6 9.4 2.6-1.6-4.7-12.1Z" fill="#12aaff" />
      <path d="M16.1 10.1c.1-.3.4-.3.5 0l6.2 15.7-2.7 1.6-4-10.3-4 10.3-2.7-1.6Z" fill="#fff" />
      <path d="m12.4 23.8 1.5-3.9 1.9 4.9-1.7 2.6Z" fill="#12aaff" />
    </svg>
  )
}

function OptimismMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#ff0420" />
      <g fill="#fff">
        <path d="M12.6 13.4c2.7 0 4.5 1.8 4.5 4.5s-1.8 4.7-4.6 4.7c-2.7 0-4.5-1.8-4.5-4.5s1.9-4.7 4.6-4.7Zm0 2.3c-1.2 0-2 1-2 2.4 0 1.3.7 2.2 1.9 2.2 1.2 0 2-1 2-2.4 0-1.3-.7-2.2-1.9-2.2Z" />
        <path d="M19.7 13.6h4.1c2.2 0 3.6 1.2 3.6 3.1 0 2-1.5 3.3-3.8 3.3h-1.7l-.5 2.5h-2.6Zm2.6 2.2-.5 2.1h1.5c.9 0 1.4-.4 1.4-1.2 0-.6-.4-.9-1.1-.9Z" />
      </g>
    </svg>
  )
}

function PolygonMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="18" fill="#8247e5" />
      <path
        d="M24.172 13.954c-.438-.25-1.002-.25-1.504 0l-3.509 2.068-2.38 1.316-3.447 2.068c-.439.25-1.003.25-1.504 0l-2.695-1.63a1.527 1.527 0 0 1-.752-1.315v-3.133c0-.502.25-1.003.752-1.316l2.695-1.567c.438-.25 1.002-.25 1.504 0l2.694 1.63c.439.25.752.751.752 1.315v2.068l2.381-1.378v-2.13c0-.502-.25-1.004-.752-1.317l-5.013-2.945c-.438-.25-1.002-.25-1.504 0l-5.138 3.008c-.501.25-.752.752-.752 1.253v5.89c0 .502.25 1.003.752 1.316l5.076 2.946c.438.25 1.002.25 1.504 0l3.446-2.006 2.381-1.378 3.447-2.006c.438-.25 1.002-.25 1.504 0l2.694 1.567c.439.25.752.752.752 1.316v3.133c0 .501-.25 1.003-.752 1.316l-2.632 1.567c-.438.25-1.002.25-1.504 0l-2.694-1.567a1.527 1.527 0 0 1-.752-1.316v-2.005L16.84 22.1v2.067c0 .502.25 1.003.752 1.316l5.075 2.946c.439.25 1.003.25 1.504 0l5.076-2.946c.439-.25.752-.752.752-1.316v-5.953c0-.5-.25-1.002-.752-1.316l-5.076-2.945z"
        fill="#fff"
      />
    </svg>
  )
}

function SolanaMark({ size }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient x1="90.737%" y1="34.776%" x2="35.509%" y2="55.415%" id="pbchain-sol-a">
          <stop stopColor="#00FFA3" offset="0%" />
          <stop stopColor="#DC1FFF" offset="100%" />
        </linearGradient>
        <linearGradient x1="66.588%" y1="43.8%" x2="11.36%" y2="64.439%" id="pbchain-sol-b">
          <stop stopColor="#00FFA3" offset="0%" />
          <stop stopColor="#DC1FFF" offset="100%" />
        </linearGradient>
        <linearGradient x1="78.586%" y1="39.317%" x2="23.358%" y2="59.956%" id="pbchain-sol-c">
          <stop stopColor="#00FFA3" offset="0%" />
          <stop stopColor="#DC1FFF" offset="100%" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r="18" fill="#181E33" />
      <g transform="translate(6 9)">
        <path
          d="M3.9 14.355a.785.785 0 0 1 .554-.23h19.153c.35 0 .525.423.277.67l-3.783 3.784a.785.785 0 0 1-.555.23H.393a.392.392 0 0 1-.277-.67l3.783-3.784z"
          fill="url(#pbchain-sol-a)"
        />
        <path
          d="M3.9.23c.15-.146.35-.23.554-.23h19.153c.35 0 .525.422.277.67l-3.783 3.783a.785.785 0 0 1-.555.23H.393a.392.392 0 0 1-.277-.67L3.899.229z"
          fill="url(#pbchain-sol-b)"
        />
        <path
          d="M20.1 7.247a.785.785 0 0 0-.554-.23H.393a.392.392 0 0 0-.277.67l3.783 3.784c.145.145.344.23.555.23h19.153c.35 0 .525-.423.277-.67l-3.783-3.784z"
          fill="url(#pbchain-sol-c)"
        />
      </g>
    </svg>
  )
}

const MARKS: Record<ChainKey, (p: MarkProps) => React.JSX.Element> = {
  ethereum: EthereumMark,
  base: BaseMark,
  arbitrum: ArbitrumMark,
  optimism: OptimismMark,
  polygon: PolygonMark,
  solana: SolanaMark,
}

export function isKnownChain(chainKey: string): chainKey is ChainKey {
  return chainKey in MARKS
}

export interface ChainMarkProps {
  /** A `DESTINATIONS` key. An unknown key renders an empty disc so the layout holds. */
  chainKey: string
  size?: number
  className?: string
}

export function ChainMark({ chainKey, size = 24, className }: ChainMarkProps) {
  const Mark = isKnownChain(chainKey) ? MARKS[chainKey] : null
  return (
    <span className={cn('inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {Mark ? <Mark size={size} /> : <span className="size-full rounded-pill bg-inset" aria-hidden />}
    </span>
  )
}
