//
// The phone's nav [STUDIO]: a fixed bottom bar with four of the seven modes, a raised lime action
// button in the middle, and a More sheet carrying the rest.
//
// ── ONE ENUM, TWO PROJECTIONS ────────────────────────────────────────────────────────────
//
// The header's pill nav and this bar render the SAME `MODE_ROUTES` links — below 768px the pill is
// `display: none` and this is `display: flex`, so exactly one nav is interactive at any width.
// Both stay in the document because the swap is a stylesheet fact, not a JS media query: there is
// no resize listener to lag behind a rotation.
//
// WHICH FOUR, AND WHY. Wallet and Markets sit left, Chat (with its unread count) and More sit
// right — the prototype's own split. Swap, Bridge, Launch and Houses live in the More sheet beside
// Settings: the bar stays usable at 320px while every mode remains reachable.
//
// THE PLUS IS THE PALETTE. The prototype's centre button opened a "Move value" picker whose four
// rows are exactly the palette's first four commands, so opening the palette IS that picker —
// one component fewer, and the keyboard user and the thumb user land in the same place.
//
import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { MODE_LABELS, MODE_ROUTES } from './modes'
import { ResponsiveDialog } from './ResponsiveDialog'
import { Icon, type IconName } from '../components/icons'
import { UnreadBadge } from '../components/ConversationList'
import { useTotalUnread } from './chat-bus'

/** The rows of the More sheet: the modes the bar has no room for, and the chrome. `as const` keeps
 *  each `to` a literal so `<Link>` checks it against the route tree rather than against `string`. */
const MORE_ROWS = [
  { to: MODE_ROUTES.swap, icon: 'swap', label: MODE_LABELS.swap, sub: 'Trade inside the pool' },
  { to: MODE_ROUTES.bridge, icon: 'bridge', label: MODE_LABELS.bridge, sub: 'Send USDC out to another chain' },
  { to: MODE_ROUTES.launch, icon: 'launch', label: MODE_LABELS.launch, sub: 'Epoch-priced token launches' },
  { to: MODE_ROUTES.houses, icon: 'houses', label: MODE_LABELS.houses, sub: 'Private membership and sealed ballots' },
  { to: '/settings', icon: 'sliders', label: 'Settings', sub: 'Theme, public name, account' },
] as const satisfies readonly { to: string; icon: IconName; label: string; sub: string }[]

export function MobileTabBar({ onPlus }: { onPlus: () => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const unread = useTotalUnread()

  return (
    <>
      <nav aria-label="Modes" className="tab-bar">
        <Link to={MODE_ROUTES.wallet} className="tab-item focus-ring">
          <Icon name="wallet" size={20} strokeWidth={1.7} />
          {MODE_LABELS.wallet}
        </Link>
        <Link to={MODE_ROUTES.markets} className="tab-item focus-ring">
          <Icon name="markets" size={20} strokeWidth={1.7} />
          {MODE_LABELS.markets}
        </Link>
        <button type="button" onClick={onPlus} aria-label="Move value" className="tab-plus focus-ring">
          <Icon name="plus" size={22} strokeWidth={2} />
        </button>
        <Link to={MODE_ROUTES.chat} className="tab-item focus-ring">
          <span className="relative inline-flex">
            <Icon name="chat" size={20} strokeWidth={1.7} />
            <UnreadBadge count={unread} />
          </span>
          {MODE_LABELS.chat}
        </Link>
        {/*
          A button, not a link: it opens a sheet and goes nowhere, and only real navigation may
          carry the router's active stamp.
        */}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className="tab-item focus-ring">
          <Icon name="grid" size={20} strokeWidth={1.7} />
          More
        </button>
      </nav>

      <ResponsiveDialog open={moreOpen} onOpenChange={setMoreOpen} label="More">
        <ul className="flex list-none flex-col gap-s2">
          {MORE_ROWS.map((row) => (
            <li key={row.to}>
              <Link
                to={row.to}
                onClick={() => setMoreOpen(false)}
                className="focus-ring flex items-center gap-s12 rounded-card p-s12 text-neutral1 no-underline hover:bg-inset"
              >
                <span className="flex size-s36 shrink-0 items-center justify-center rounded-pill bg-inset text-neutral2">
                  <Icon name={row.icon} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-buttonLabel3">{row.label}</span>
                  <span className="text-body4 text-neutral3">{row.sub}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ResponsiveDialog>
    </>
  )
}
