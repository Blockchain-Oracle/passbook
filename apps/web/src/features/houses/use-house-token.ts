import { useQuery } from '@tanstack/react-query'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { HOUSE_COUNTING, type OnChainHouse } from '@strk20/protocol/governance-reads'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'

import { useSession } from '@/app/session'
import { shortAddress } from '@/lib/format'
import { findToken, shieldedBalanceQuery, tokenListQuery } from '@/queries'

export interface HouseToken {
  token: string
  symbol: string
  decimals: number | null
  /** Decimals the ballot weight renders in: 0 when the House counts members, not tokens. */
  weightDecimals: number | null
  /** The unit word for a weight: the symbol, or "voices" in member mode. */
  weightUnit: string
  logoUri: string | null
  /** Shielded balance of the House's token. `null` = unreadable, never 0. */
  available: bigint | null
  sessionReady: boolean
  memberMode: boolean
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

/** The House's voting token: identity from the list, shielded balance from the walk. */
export function useHouseToken(house: Pick<OnChainHouse, 'token' | 'counting'>): HouseToken {
  const session = useSession()
  const ready = session.status === 'ready'
  const balance = useQuery(shieldedBalanceQuery(ready ? session.address : undefined, ready ? session.accountKey : undefined))
  const list = useQuery(tokenListQuery())

  const listed = findToken(list.data, house.token)
  const isStrk = sameFelt(house.token, STRK_TOKEN)
  const symbol = listed?.symbol ?? (isStrk ? 'STRK' : shortAddress(house.token, 6, 4))
  const decimals = listed?.decimals ?? (isStrk ? KNOWN_TOKEN_DECIMALS[STRK_TOKEN]! : null)
  const memberMode = house.counting === HOUSE_COUNTING.member

  let available: bigint | null = null
  if (balance.data && balance.data.presence !== 'unknown') {
    const row = balance.data.tokens.find((t) => sameFelt(t.token, house.token))
    // A walked wallet with no note of this token holds zero of it — a read, not a gap.
    available = row ? row.wei : 0n
  }

  return {
    token: house.token,
    symbol,
    decimals,
    weightDecimals: memberMode ? 0 : decimals,
    weightUnit: memberMode ? 'voices' : symbol,
    logoUri: listed?.logoUri ?? null,
    available,
    sessionReady: ready,
    memberMode,
  }
}
