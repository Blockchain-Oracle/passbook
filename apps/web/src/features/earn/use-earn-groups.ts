import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EarnPosition } from '@strk20/protocol/earn-position'

import { useSession } from '@/app/session'
import { earnPositionsQuery } from '@/queries/earn'
import type { PositionGroup } from '@/features/positions/types'

const USDC_DECIMALS = 6

/**
 * Earn positions, shaped like every other row on `/positions`.
 *
 * ── WHY THIS DOES NOT TOUCH THE BEARER STORE ──────────────────────────────────────────────
 *
 * `usePositionGroups` reads `storedPositionsQuery` — the local record of bet and buy secrets,
 * where the secret IS the money. Earn writes nothing there and must not: its position is discovered
 * vToken notes, so it is recoverable from the chain alone, and copying it into a store would create
 * a second answer that can disagree with the first.
 *
 * So this hook is a sibling rather than a branch, and `usePositionGroups` concatenates it. The
 * groups it returns carry no `claims` at all — the numbers ride in `group.earn`, and the table
 * prefers those when they are there.
 */
export function useEarnGroups(): PositionGroup[] {
  const session = useSession()
  const ready = session.status === 'ready'
  const positions = useQuery(earnPositionsQuery(ready ? session.address : undefined, ready ? session.accountKey : undefined))

  return useMemo(() => (positions.data ?? []).map(groupFor), [positions.data])
}

function groupFor(position: EarnPosition): PositionGroup {
  const { market } = position
  return {
    key: `earn:${market.marketId}`,
    venue: 'earn',
    tab: 'earn',
    title: market.label,
    kicker: 'Lending',
    href: { to: '/earn', id: market.marketId },
    // No clock. A lending position does not decide at a time — it is redeemable until it is not,
    // and inventing a deadline would be the one number on this row that is not read from the chain.
    clock: null,
    claims: [],
    ready: 0,
    running: 0,
    finished: 0,
    // Never `0` for a price that could not be read: an unreadable value is an absent row here, and
    // the `earn` payload below carries the `null` the card renders as an em dash.
    claimable: position.valueWei === null ? [] : [{ symbol: 'USDC', decimals: USDC_DECIMALS, wei: position.valueWei }],
    // `settled` rather than `ready`: nothing here is waiting for the user, and colouring it as
    // actionable would put it above bets that genuinely are.
    tone: 'settled',
    earn: {
      sharesWei: position.sharesWei,
      valueWei: position.valueWei,
      noteCount: position.noteCount,
      paused: position.redeemable?.limit === 'paused',
    },
  }
}
