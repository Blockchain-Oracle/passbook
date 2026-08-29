//
// The token list: AVNU's aggregator list — the set that is actually routable — with every entry's
// `decimals()` read off its own contract before the value goes near an amount (USDC 6, ETH 18,
// STRK 18, WBTC 8: a guessed 18 on a 6-decimal token misplaces a balance by a trillion). A token
// whose chain answer disagrees with the list is DROPPED, not corrected. `fetch` and JSON only, so a
// surface can import this without reaching `starknet`.
//
import { NET } from './constants.js'

/** `decimals()`, precomputed — see `crowd-rpc.ts` on why a selector is a constant here. */
const DECIMALS_SELECTOR = '0x4c4fb1ab068f6039d5780c68dd0fa2f8742cceb3426d19667778ca7f3518a9'

const AVNU_TOKENS_URL = 'https://starknet.api.avnu.fi/v1/starknet/tokens'

export interface TokenInfo {
  /** Felt address, as the list spells it. Compare with `sameAddress`, never as a string. */
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  /** The token's own logo. `null` when the list has none — the mark falls back to letters. */
  readonly logoUri: string | null
  /** 24h volume in USD, for ranking. `null` when the list did not say. */
  readonly volumeUsd: number | null
  /** True once `decimals()` has been read from the contract and agreed with the list. */
  readonly verified: boolean
}

interface RawToken {
  address?: unknown
  symbol?: unknown
  name?: unknown
  decimals?: unknown
  logoUri?: unknown
  lastDailyVolumeUsd?: unknown
}

function shapeToken(raw: RawToken): Omit<TokenInfo, 'verified'> | null {
  const { address, symbol, name, decimals } = raw
  if (typeof address !== 'string' || address === '') return null
  if (typeof symbol !== 'string' || symbol === '') return null
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) return null
  return {
    address,
    symbol,
    name: typeof name === 'string' && name !== '' ? name : symbol,
    decimals,
    logoUri: typeof raw.logoUri === 'string' && raw.logoUri !== '' ? raw.logoUri : null,
    volumeUsd: typeof raw.lastDailyVolumeUsd === 'number' ? raw.lastDailyVolumeUsd : null,
  }
}

export interface TokenListOptions {
  /** How many tokens to ask for. The list is volume-ordered, so this is "the top N". */
  size?: number
  /** Test seam: the HTTP fetch. */
  fetchJson?: (url: string) => Promise<unknown>
  /** Test seam: the on-chain `decimals()` read. Return `null` when it cannot be read. */
  readDecimals?: (address: string) => Promise<number | null>
}

async function fetchJsonDefault(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

/** One `starknet_call` to `decimals()`, against the configured RPC hosts in turn. */
async function readDecimalsDefault(address: string): Promise<number | null> {
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'starknet_call',
          params: [
            { contract_address: address, entry_point_selector: DECIMALS_SELECTOR, calldata: [] },
            'latest',
          ],
        }),
      })
      if (!response.ok) continue
      const body = (await response.json()) as { result?: unknown }
      const first = Array.isArray(body.result) ? body.result[0] : undefined
      if (typeof first !== 'string') continue
      const value = Number(BigInt(first))
      return Number.isInteger(value) && value >= 0 && value <= 32 ? value : null
    } catch {
      // Try the next host. A token whose decimals cannot be read is dropped, not defaulted.
    }
  }
  return null
}

/**
 * The tradeable token set, every entry's decimals confirmed against its own contract.
 *
 * NEVER THROWS. Returns `[]` when the list cannot be fetched — an asset selector with nothing in it
 * is a surface that says so, and a surface that says so is recoverable. A throw here would take
 * down whatever screen asked.
 *
 * Verification runs in parallel across the set; one unreadable token costs its own row.
 */
export async function fetchTokenList(options: TokenListOptions = {}): Promise<TokenInfo[]> {
  const size = options.size ?? 30
  const fetchJson = options.fetchJson ?? fetchJsonDefault
  const readDecimals = options.readDecimals ?? readDecimalsDefault

  let payload: unknown
  try {
    payload = await fetchJson(`${AVNU_TOKENS_URL}?page=0&size=${size}`)
  } catch {
    return []
  }

  const content = (payload as { content?: unknown })?.content
  if (!Array.isArray(content)) return []

  const shaped = content.map((raw) => shapeToken(raw as RawToken)).filter((t): t is NonNullable<typeof t> => t !== null)

  const verified: Array<TokenInfo | null> = await Promise.all(
    shaped.map(async (token): Promise<TokenInfo | null> => {
      let onChain: number | null = null
      try {
        onChain = await readDecimals(token.address)
      } catch {
        onChain = null
      }
      // DROPPED, NOT CORRECTED. A disagreement means the list and the chain are describing
      // different contracts, and nothing here can say which one the user meant.
      if (onChain === null || onChain !== token.decimals) return null
      return { ...token, verified: true }
    }),
  )

  return verified.filter((token): token is TokenInfo => token !== null)
}

/** Volume-ranked, highest first. Tokens the list gave no volume for sort last, in list order. */
export function byLiquidity(tokens: readonly TokenInfo[]): TokenInfo[] {
  return [...tokens].sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1))
}
