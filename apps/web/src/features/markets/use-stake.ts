import { useQuery } from '@tanstack/react-query'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'

import { useSession } from '@/app/session'
import { findToken, shieldedBalanceQuery, tokenListQuery } from '@/queries'

export interface Stake {
  token: string
  symbol: string
  decimals: number | null
  logoUri: string | null
  /** Shielded balance of this token. `null` = unreadable, never 0. */
  available: bigint | null
  /** Where the session stands: a ticket needs an account before it can spend. */
  sessionReady: boolean
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

/** The shielded balance a market's stake token spends from, with its display identity. */
export function useStake(token: string): Stake {
  const session = useSession()
  const ready = session.status === 'ready'
  const balance = useQuery(shieldedBalanceQuery(ready ? session.address : undefined, ready ? session.accountKey : undefined))
  const list = useQuery(tokenListQuery())

  const listed = findToken(list.data, token)
  const isStrk = sameFelt(token, STRK_TOKEN)
  const symbol = listed?.symbol ?? (isStrk ? 'STRK' : 'units')
  const decimals = listed?.decimals ?? (isStrk ? KNOWN_TOKEN_DECIMALS[STRK_TOKEN]! : null)

  let available: bigint | null = null
  if (balance.data && balance.data.presence !== 'unknown') {
    const row = balance.data.tokens.find((t) => sameFelt(t.token, token))
    // A walked wallet with no note of this token holds zero of it — that is a read, not a gap.
    available = row ? row.wei : 0n
  }

  return { token, symbol, decimals, logoUri: listed?.logoUri ?? null, available, sessionReady: ready }
}

/** STRK is the seed token: every registered account holds it because it paid the pool fee. */
export function useStrkStake(): Stake {
  return useStake(STRK_TOKEN)
}
