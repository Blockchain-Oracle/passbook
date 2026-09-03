import type { LinkProps } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChartCandlestick,
  Landmark,
  Mail,
  MessageCircle,
  PiggyBank,
  Rocket,
  Send,
  Settings,
  Trophy,
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
  { to: '/earn', label: 'Earn', icon: PiggyBank, group: 'money' },
  { to: '/bridge', label: 'Exit', icon: ArrowUpRight, group: 'money' },
  // Two messaging surfaces on purpose. Mail is a pool transaction that lands on chain and pays the
  // fee; Chat is ciphertext over the relay that costs nothing and stores nothing. Neither replaces
  // the other, so neither is hidden behind the other.
  { to: '/mail', label: 'Mail', icon: Mail, group: 'venues' },
  { to: '/chat', label: 'Chat', icon: MessageCircle, group: 'venues' },
  { to: '/markets', label: 'Markets', icon: ChartCandlestick, group: 'venues' },
  { to: '/launch', label: 'Launch', icon: Rocket, group: 'venues' },
  { to: '/houses', label: 'DAOs', icon: Landmark, group: 'venues' },
  // Claims outlive the venue that made them, so they get a home of their own rather than three.
  { to: '/positions', label: 'Positions', icon: Trophy, group: 'venues' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'system' },
]

export const GROUP_LABEL: Record<NavGroup, string> = {
  money: 'Money',
  venues: 'Venues',
  system: 'System',
}

/**
 * The four that fit a phone's bottom bar; everything else lives behind "More".
 *
 * Earn is in and Exit is out. A phone's four slots go to what a holder does often, and leaving a
 * one-way public exit ahead of the surface that earns on a balance had it backwards.
 */
export const MOBILE_TABS = NAV.slice(0, 4)
export const MOBILE_MORE = NAV.slice(4)

export function isActivePath(pathname: string, to: NavItem['to']): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
