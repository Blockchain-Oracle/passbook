import { queryOptions } from '@tanstack/react-query'
import type { TokenInfo } from '@strk20/protocol/token-list'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS } from '@strk20/protocol/bridge'

/** AVNU's verified list, read straight from the browser. Rarely changes: an hour is fine. */
export function tokenListQuery() {
  return queryOptions({
    queryKey: ['tokens', 'list'],
    queryFn: async (): Promise<TokenInfo[]> => {
      const { fetchTokenList } = await import('@strk20/protocol/token-list')
      const tokens = await fetchTokenList()
      // An empty answer is the list failing quietly; error so the next mount retries.
      if (tokens.length === 0) throw new Error('the token list came back empty')
      return tokens
    },
    staleTime: 60 * 60_000,
  })
}

/** Decimals table for `balancesFrom`, keyed by address exactly as the list spells it. */
export function decimalsTable(tokens: readonly TokenInfo[] | undefined): Record<string, number> {
  const table: Record<string, number> = { ...KNOWN_TOKEN_DECIMALS, [BRIDGE_USDC]: BRIDGE_USDC_DECIMALS }
  for (const token of tokens ?? []) table[token.address] = token.decimals
  return table
}

/** The list's entry for an address, compared as felts — spellings differ. */
export function findToken(tokens: readonly TokenInfo[] | undefined, address: string): TokenInfo | null {
  let target: bigint
  try {
    target = BigInt(address)
  } catch {
    return null
  }
  for (const token of tokens ?? []) {
    try {
      if (BigInt(token.address) === target) return token
    } catch {
      // A malformed list address matches nothing.
    }
  }
  return null
}
