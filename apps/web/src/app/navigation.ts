import type { LinkProps } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChartCandlestick,
  Landmark,
  MessageCircle,
  Rocket,
  Send,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type NavGroup = 'money' | 'venues' | 'system'

export interface NavItem {
  readonly to: LinkProps['to']
  readonly label: string
  readonly icon: LucideIcon
  readonly group: NavGroup
}

// One list drives the sidebar, the mobile tabs and the command palette.
export const NAV: readonly NavItem[] = [
  { to: '/wallet', label: 'Wallet', icon: Wallet, group: 'money' },
  { to: '/send', label: 'Send', icon: Send, group: 'money' },
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight, group: 'money' },
  { to: '/bridge', label: 'Exit', icon: ArrowUpRight, group: 'money' },
  { to: '/chat', label: 'Chat', icon: MessageCircle, group: 'venues' },
  { to: '/markets', label: 'Markets', icon: ChartCandlestick, group: 'venues' },
  { to: '/launch', label: 'Launch', icon: Rocket, group: 'venues' },
  { to: '/houses', label: 'Houses', icon: Landmark, group: 'venues' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'system' },
]

export const GROUP_LABEL: Record<NavGroup, string> = {
  money: 'Money',
  venues: 'Venues',
  system: 'System',
}

/** The four that fit a phone's bottom bar; everything else lives behind "More". */
export const MOBILE_TABS = NAV.slice(0, 4)
export const MOBILE_MORE = NAV.slice(4)

export function isActivePath(pathname: string, to: NavItem['to']): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
