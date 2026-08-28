import { queryOptions, skipToken } from '@tanstack/react-query'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { BRIDGE_USDC } from '@strk20/protocol/bridge'

const PUBLIC_MS = 20_000

/** Token address → wei. `null` is a failed read, and it is NEVER folded into zero. */
export type PublicBalances = Record<string, bigint | null>

/** STRK and USDC always, plus whatever the shielded book holds — deduplicated as felts. */
export function publicTokenSet(shieldedTokens: readonly string[] = []): string[] {
  const seen = new Set<bigint>()
  const out: string[] = []
  for (const token of [STRK_TOKEN, BRIDGE_USDC, ...shieldedTokens]) {
    try {
      const felt = BigInt(token)
      if (seen.has(felt)) continue
      seen.add(felt)
      out.push(token)
    } catch {
      // Not a felt: nothing to read.
    }
  }
  return out
}

async function readOne(
  provider: { callContract(call: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]> },
  token: string,
  address: string,
): Promise<bigint | null> {
  try {
    const raw = await provider.callContract({ contractAddress: token, entrypoint: 'balanceOf', calldata: [address] })
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') return null
    const low = BigInt(raw[0])
    const high = typeof raw[1] === 'string' ? BigInt(raw[1]) : 0n
    return (high << 128n) + low
  } catch {
    return null
  }
}

/**
 * ERC-20 `balanceOf` at the account address, one read per token, concurrently. One dead token
 * contract yields `null` for that row and real numbers for the rest — never a rejected query.
 */
export function publicBalancesQuery(address: string | undefined, tokens: readonly string[]) {
  const sorted = [...tokens].sort()
  return queryOptions({
    queryKey: ['public-balances', address ?? null, sorted],
    queryFn:
      address && sorted.length > 0
        ? async (): Promise<PublicBalances> => {
            const { withFallback } = await import('@strk20/protocol/rpc')
            const balances: PublicBalances = {}
            await Promise.all(
              sorted.map(async (token) => {
                balances[token] = await withFallback((p) => readOne(p, token, address)).catch(() => null)
              }),
            )
            return balances
          }
        : skipToken,
    staleTime: PUBLIC_MS,
    refetchInterval: PUBLIC_MS,
  })
}
