//
// The chrome's icon vocabulary — STUDIO's own stroke paths, one per name.
//
// One component and a closed record rather than an icon library: every glyph in this app is a
// 24-box stroke path drawn in `currentColor`, which is what lets a nav pill recolour its icon by
// recolouring itself. The paths are the ratified prototype's, verbatim. `CategoryDisc` keeps its
// own record because an activity category is not chrome — the two lists overlap on purpose and
// drift on purpose.
//
// Icons here are always DECORATION beside a word, never meaning on their own — the label carries
// the semantics, so every use site renders these `aria-hidden`.
//
import type { Mode } from '../shell/modes'

export const ICON_PATHS = {
  wallet: 'M4 8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM15.5 12h3',
  chat: 'M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6l-4 4v-4H7a3 3 0 0 1-3-3z',
  swap: 'M7 7h11l-3-3M17 17H6l3 3',
  bridge: 'M4 15c0-4 3.6-7 8-7s8 3 8 7M4 15h16M8 15v4M16 15v4',
  markets: 'M4 18h4v-4h4v-4h4V6h4',
  launch: 'M7 17L17 7M9 7h8v8',
  // A house with a keyhole of a door — governance behind an ordinary front.
  houses: 'M4 11l8-6 8 6M6 10v9h12v-9M12 13v3',
  send: 'M12 19V5M12 5l-6 6M12 5l6 6',
  receive: 'M12 5v14M12 19l6-6M12 19l-6-6',
  shield: 'M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z',
  close: 'M6 6l12 12M18 6L6 18',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  check: 'M5 13l4 4L19 7',
  search: 'M16.5 16.5L21 21M5 11a6 6 0 1 0 12 0 6 6 0 0 0-12 0',
  sliders: 'M5 8h14M5 16h14M9 6.2v3.6M15 14.2v3.6',
  chevronDown: 'M6 9l6 6 6-6',
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  flip: 'M8 4v12M8 16l-3-3M8 16l3-3M16 20V8M16 8l3 3M16 8l-3 3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  download: 'M12 4v10M12 14l-4-4M12 14l4-4M5 19h14',
} as const

export type IconName = keyof typeof ICON_PATHS

// Every mode names its own glyph — this assignment fails compilation when a seventh mode arrives
// without one, which is the same coupling `MODE_ROUTES` enforces for paths.
const _modeGlyphs: Record<Mode, string> = ICON_PATHS
void _modeGlyphs

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={ICON_PATHS[name]}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
