//
// The pair marks — drawn, not fetched. Yosuku's `ChainIcon` discipline, in its author's words:
// "they inherit size, stay crisp, and add nothing to the bundle." A typographic glyph in the
// asset's brand circle; brand colours are IDENTITY marks and use the declared off-token exception
// (`TokenLogo.tsx`), so a theme cannot repaint what Bitcoin looks like.
//
const MARKS: Record<string, { glyph: string; bg: string; fg: string }> = {
  'BTC/USD': { glyph: '₿', bg: '#F7931A', fg: '#FFFFFF' },
  'ETH/USD': { glyph: 'Ξ', bg: '#627EEA', fg: '#FFFFFF' },
  'STRK/USD': { glyph: 'S', bg: '#0C0C4F', fg: '#FAFAFA' },
}

const FALLBACK = { glyph: '◇', bg: '#3A3A3A', fg: '#F1F0EB' }

export function PairMark({ pair, size = 28 }: { pair: string; size?: number }) {
  const mark = MARKS[pair] ?? FALLBACK
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-pill"
      style={{
        width: size,
        height: size,
        backgroundColor: mark.bg,
        color: mark.fg,
        fontSize: Math.round(size * 0.55),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {mark.glyph}
    </span>
  )
}
