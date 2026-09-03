import type { ShieldedBalance } from '@strk20/protocol/balances'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS } from '@strk20/protocol/bridge'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { isEarnShareToken } from '@strk20/protocol/earn-markets'
import type { TokenInfo } from '@strk20/protocol/token-list'

import type { BalanceRow } from '@/components/money/balance-cards'
import { findToken, type PublicBalances } from '@/queries'

/** What the wallet knows about a token before any balance is read. */
export interface WalletToken {
  token: string
  symbol: string
  name: string | null
  logoUri: string | null
  decimals: number | null
}

/** The two product assets, with identity that survives a dead token list. */
const CORE: readonly WalletToken[] = [
  { token: STRK_TOKEN, symbol: 'STRK', name: 'Starknet Token', logoUri: null, decimals: 18 },
  { token: BRIDGE_USDC, symbol: 'USDC', name: 'USD Coin', logoUri: null, decimals: BRIDGE_USDC_DECIMALS },
]

function sameToken(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

function fromList(token: string, list: readonly TokenInfo[] | undefined, fallback?: WalletToken): WalletToken {
  const info = findToken(list, token)
  if (info) {
    return { token, symbol: info.symbol, name: info.name, logoUri: info.logoUri, decimals: info.decimals }
  }
  return fallback ?? { token, symbol: 'TOKEN', name: null, logoUri: null, decimals: null }
}

/**
 * STRK and USDC always, in that order, then anything else the shielded book holds. Decimals for
 * the extras come from the walk (verified on chain) before the list.
 *
 * ── EXCEPT EARN SHARES, WHICH ARE A POSITION AND NOT A BALANCE ────────────────────────────
 *
 * Supplying a Vesu market mints vToken notes, and the walk finds them like it finds everything
 * else — so without this filter the wallet would grow a row reading `TOKEN —` for a token the
 * list has never heard of, sitting beside real balances as if it were spendable money. It is not:
 * those shares are a lending position, they are redeemed rather than sent, and `/earn` is where
 * they are worth something. So they are excluded here and summed there.
 *
 * Excluded, NOT hidden: the value is on `/earn` and in `/positions`, and the wallet links to it.
 * What must never happen is the shares being added to a shielded token balance, which would be
 * two different kinds of holding in one number.
 */
export function walletTokens(list: readonly TokenInfo[] | undefined, shielded: ShieldedBalance | undefined): WalletToken[] {
  const out = CORE.map((core) => fromList(core.token, list, core))
  for (const held of shielded?.tokens ?? []) {
    if (isEarnShareToken(held.token)) continue
    if (out.some((row) => sameToken(row.token, held.token))) continue
    const known = fromList(held.token, list)
    out.push({ ...known, decimals: held.decimals ?? known.decimals })
  }
  return out
}

/** True when this walk holds any Earn position, so the wallet can offer the door to it. */
export function holdsEarnShares(shielded: ShieldedBalance | undefined): boolean {
  return (shielded?.tokens ?? []).some((held) => isEarnShareToken(held.token) && held.wei > 0n)
}

/** The token the wallet lists for an address, if any. */
export function walletTokenFor(tokens: readonly WalletToken[], address: string): WalletToken | null {
  return tokens.find((row) => sameToken(row.token, address)) ?? null
}

/**
 * Pool notes per token. `undefined` while the first walk is out, `null` when the walk did not
 * complete (an `unknown` book is a gap, not an empty one), and a real `0n` only once it has.
 */
export function shieldedRows(
  tokens: readonly WalletToken[],
  balance: ShieldedBalance | undefined,
  failed: boolean,
): BalanceRow[] {
  return tokens.map((row) => {
    let wei: bigint | null | undefined
    if (failed) wei = null
    else if (balance === undefined) wei = undefined
    else if (balance.book === 'unknown') wei = null
    else wei = balance.tokens.find((held) => sameToken(held.token, row.token))?.wei ?? 0n
    return { ...row, wei, confidence: balance?.book === 'unknown' ? 'unknown' : 'dated' }
  })
}

/** ERC-20 balances at the account address. A row absent from the read is not yet read. */
export function publicRows(
  tokens: readonly WalletToken[],
  balances: PublicBalances | undefined,
  failed: boolean,
): BalanceRow[] {
  return tokens.map((row) => {
    let wei: bigint | null | undefined
    if (failed) wei = null
    else if (balances === undefined) wei = undefined
    else {
      const key = Object.keys(balances).find((address) => sameToken(address, row.token))
      wei = key === undefined ? undefined : balances[key]
    }
    return { ...row, wei, confidence: 'dated' }
  })
}

/** One row's wei, or `null` when unread or unreadable. */
export function weiOf(rows: readonly BalanceRow[], token: string): bigint | null {
  const row = rows.find((candidate) => sameToken(candidate.token, token))
  return row && typeof row.wei === 'bigint' ? row.wei : null
}
