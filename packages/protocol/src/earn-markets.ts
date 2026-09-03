//
// The Vesu USDC markets Earn can see, pinned by address rather than fetched by name.
//
// ── WHY A PINNED REGISTRY AND NOT A FEED ──────────────────────────────────────────────────
//
// `api.vesu.xyz/pools` answers 200 and lists all twenty V2 pools, but every V2 entry carries
// `stats: null`, `usdPrice: null` and `risk: null` — identity only. It is not an outage we can
// wait out, and it is certainly not something to compose a transaction against. So identity is
// pinned HERE, where a diff is reviewable, and every number the user reads is a live contract
// read (`earn-reads.ts`). The API's one irreplaceable contribution — the human names below and
// the curator labels — is transcribed, because a market called `0x0451fe…` helps nobody.
//
// Pinning is also the safety property. `enabledDeposit` on a wrong address would send real USDC
// into a vault nobody reviewed; `validateMarket` re-derives each vToken from the PoolFactory and
// refuses a mismatch, so a typo here becomes a blocked market rather than a lost deposit.
//
// Verified live on SN_MAIN at block 14300302: for all seven, `vToken.asset()` is the USDC below,
// `vToken.pool_contract()` is the pool below, and `PoolFactory.v_token_for_asset(pool, USDC)`
// returns the same vToken. Vesu is ONE protocol; these are seven isolated markets inside it.
//

/** Vesu V2's factory. Every entry below is re-derivable from it, and is re-derived before use. */
export const VESU_POOL_FACTORY = '0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0'

/** The USDC every market below lends. 6 decimals, read live, not assumed. */
export const EARN_UNDERLYING = '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'

export interface EarnMarketDefinition {
  readonly marketId: string
  readonly provider: 'vesu-v2-direct'
  readonly label: string
  /** The isolated Vesu pool contract — where the rate, utilization and pause state are read. */
  readonly pool: string
  readonly underlying: string
  /** The ERC-4626 share token. Shares are 18-decimal while USDC is 6 — never conflate them. */
  readonly vToken: string
  readonly underlyingDecimals: number
  readonly shareDecimals: number
  /** Who curates the market, in their own words. `null` where the feed names nobody. */
  readonly curatorLabel: string | null
  /** The block the vToken was listed in, from the first-party feed. A floor for history scans. */
  readonly listedBlock: number
  readonly sourceUrl: string
}

/**
 * Every verified, active, non-deprecated Vesu V2 USDC market.
 *
 * The full set is here on purpose. A catalog trimmed to the profitable four would be a product
 * that quietly decides for the user, and the empty one (Frontier, zero supplied, zero utilization)
 * is the most honest thing on the page: it is what a market with no lenders actually looks like.
 * Whether any of these can be transacted with is decided per market, live, in `earn-reads.ts`.
 */
export const EARN_MARKETS: readonly EarnMarketDefinition[] = [
  {
    marketId: 'vesu-v2-re7-usdc-core',
    provider: 'vesu-v2-direct',
    label: 'Re7 USDC Core',
    pool: '0x03976cac265a12609934089004df458ea29c776d77da423c96dc761d09d24124',
    underlying: EARN_UNDERLYING,
    vToken: '0x017891114c00b07317b9102adefbad9fd5de40c5616f094ee09fe2fad67191b1',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Re7 Labs',
    listedBlock: 3994545,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-clearstar-usdc-reactor',
    provider: 'vesu-v2-direct',
    label: 'Clearstar USDC Reactor',
    pool: '0x01bc5de51365ed7fbb11ebc81cef9fd66b70050ec10fd898f0c4698765bf5803',
    underlying: EARN_UNDERLYING,
    vToken: '0x058337c3372ebd55bec9963644c169a62988d695a4f3e242d83d5b706ded22d3',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Clearstar',
    listedBlock: 5447467,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-prime',
    provider: 'vesu-v2-direct',
    label: 'Prime',
    pool: '0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5',
    underlying: EARN_UNDERLYING,
    vToken: '0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: null,
    listedBlock: 3983603,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-re7-usdc-prime',
    provider: 'vesu-v2-direct',
    label: 'Re7 USDC Prime',
    pool: '0x02eef0c13b10b487ea5916b54c0a7f98ec43fb3048f60fdeedaf5b08f6f88aaf',
    underlying: EARN_UNDERLYING,
    vToken: '0x06c9d1090d38488b3d08f3ee914ac878d003b8f243f82a9867eb70706a73950b',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Re7 Labs',
    listedBlock: 3994551,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-re7-usdc-stable-core',
    provider: 'vesu-v2-direct',
    label: 'Re7 USDC Stable Core',
    pool: '0x073702fce24aba36da1eac539bd4bae62d4d6a76747b7cdd3e016da754d7a135',
    underlying: EARN_UNDERLYING,
    vToken: '0x00cf3ea1abb06e1f2cba191f10684fc4ce505eba0ed64a847ab6b00ef52e5722',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Re7 Labs',
    listedBlock: 3994549,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-re7-starknet-ecosystem',
    provider: 'vesu-v2-direct',
    label: 'Re7 Labs Starknet Ecosystem',
    pool: '0x0486294fe74daf3d964523e7a1f4e5d686f153934b2c183ececa0cab9dd2f3e6',
    underlying: EARN_UNDERLYING,
    vToken: '0x009a5ac579fc1ebcedf9bfa12daec9f86d0e258a1736d9cf5d1d8e9053672b09',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Re7 Labs',
    listedBlock: 4790387,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
  {
    marketId: 'vesu-v2-re7-usdc-frontier',
    provider: 'vesu-v2-direct',
    label: 'Re7 USDC Frontier',
    pool: '0x05c03e7e0ccfe79c634782388eb1e6ed4e8e2a013ab0fcc055140805e46261bd',
    underlying: EARN_UNDERLYING,
    vToken: '0x020f0579b2a1ae642369ca67430f7156d2e83c00f351bfeaea74017aa1f306ea',
    underlyingDecimals: 6,
    shareDecimals: 18,
    curatorLabel: 'Re7 Labs',
    listedBlock: 5262542,
    sourceUrl: 'https://app.vesu.xyz/pools',
  },
]

/** The lowest listed block across the catalog: no Earn event can predate it. */
export const EARN_FIRST_BLOCK = EARN_MARKETS.reduce((low, m) => Math.min(low, m.listedBlock), Number.MAX_SAFE_INTEGER)

const sameFelt = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

export function marketById(marketId: string): EarnMarketDefinition | null {
  return EARN_MARKETS.find((m) => m.marketId === marketId) ?? null
}

/** The market a vToken belongs to. This is how a discovered note becomes a position. */
export function marketByVToken(vToken: string): EarnMarketDefinition | null {
  return EARN_MARKETS.find((m) => sameFelt(m.vToken, vToken)) ?? null
}

/** Every share token Earn knows about — the filter a note walk is read through. */
export const EARN_SHARE_TOKENS: readonly string[] = EARN_MARKETS.map((m) => m.vToken)

export function isEarnShareToken(token: string): boolean {
  return marketByVToken(token) !== null
}
