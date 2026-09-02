// The pure half of `use-position-groups.ts`: how a claim is described, timed, toned and grouped.
// Nothing here reads the chain; the hook feeds these what it read.
import { MARKET_STATE, timeLeft, type OnChainLaunch, type OnChainMarket } from '@strk20/protocol/app-reads'
import type { PositionLifecycle, PositionTone } from '@strk20/protocol/position-lifecycle'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

import { launchStateWord } from '@/features/launch/phase'
import { shortAddress } from '@/lib/format'
import { findToken } from '@/queries'

import { mergeClaimable, type Claim, type Claimable, type PositionGroup, type Payout } from './types'

export type TokenList = Parameters<typeof findToken>[0]

/** One frozen empty array, so "nothing stored" is a stable reference rather than a new one. */
export const EMPTY: readonly StoredPosition[] = []

/** A token's display identity, or an honest stand-in. `decimals: null` renders raw units, never a guess. */
export function payoutFor(list: TokenList, token: string, symbol?: string): Payout {
  const info = findToken(list, token)
  return { token, symbol: symbol ?? info?.symbol ?? shortAddress(token, 6, 3), decimals: info?.decimals ?? (symbol ? 18 : null) }
}

export function marketClock(market: OnChainMarket | undefined, now: number): string | null {
  if (!market) return null
  if (market.state === MARKET_STATE.resolved) return 'Resolved'
  if (market.state === MARKET_STATE.voided) return 'Voided — stakes are refundable'
  const left = timeLeft(market.deadline, now)
  return left === 'closed' ? 'Closed · settling' : `Resolves in ${left}`
}

export function launchClock(launch: OnChainLaunch | undefined, now: number): string | null {
  if (!launch) return null
  const word = launchStateWord(launch)
  if (word === 'graduated') return 'Graduated'
  if (word === 'failed') return 'Did not fill'
  const left = timeLeft(launch.deadline, now)
  return left === 'closed' ? 'Deadline passed' : `Closes in ${left}`
}

/** Ready beats running beats finished: a group is as actionable as its most actionable claim. */
export function groupTone(claims: readonly Claim[]): PositionTone {
  if (claims.some((c) => c.life.tone === 'ready')) return 'ready'
  return claims.some((c) => c.life.tone === 'waiting') ? 'waiting' : 'settled'
}

export function claimableOf(claims: readonly Claim[]): Claimable[] {
  return mergeClaimable(
    claims
      .filter((c) => c.life.tone === 'ready' && c.life.amount !== null)
      .map((c) => [{ symbol: c.payout.symbol, decimals: c.payout.decimals, wei: c.life.amount! }]),
  )
}

export function assemble(
  key: string,
  venue: PositionGroup['venue'],
  tab: PositionGroup['tab'],
  title: string,
  kicker: string,
  href: PositionGroup['href'],
  clock: string | null,
  claims: Claim[],
): PositionGroup {
  return {
    key,
    venue,
    tab,
    title,
    kicker,
    href,
    clock,
    claims,
    ready: claims.filter((c) => c.life.tone === 'ready').length,
    running: claims.filter((c) => c.life.tone === 'waiting').length,
    finished: claims.filter((c) => c.life.tone === 'settled').length,
    claimable: claimableOf(claims),
    tone: groupTone(claims),
  }
}

/**
 * A founder's claim has no chain read and no door, so `positionLifecycle(null)` — which means
 * "the chain has not answered yet" — reported it as READING, forever. It is not being read. It is
 * a credential you hold, and the row now says that instead of spinning on a question nobody asked.
 */
export const FOUNDER_CLAIM: PositionLifecycle = {
  tone: 'waiting',
  label: 'Held',
  detail: 'Your founder claim on this DAO. It is a credential, not a payout — there is no door until the DAO needs one.',
  amount: null,
}

/**
 * A claim on a contract this build no longer reads.
 *
 * Markets was migrated once and the old deployment was left behind. A position opened on it is not
 * loading and is not running — it is stranded, and the honest row says so and offers the one action
 * that remains: forget it. `settled` is the tone precisely because nothing further can happen.
 */
export const RETIRED_CLAIM: PositionLifecycle = {
  tone: 'settled',
  label: 'Retired',
  detail: 'Opened on an earlier deployment this build no longer reads. Nothing here can settle it — forget it to clear the row.',
  amount: null,
}

/** Insertion-ordered buckets, so settling one claim never reshuffles the board. */
export function bucket<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const held = out.get(key)
    if (held) held.push(row)
    else out.set(key, [row])
  }
  return out
}

