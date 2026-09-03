//
// What each Vesu market is actually doing, read from its own contracts.
//
// RAW `starknet_call` through `app-reads.ts`'s transport, not the SDK and not `starknet`: `/earn`
// is an eager route and the `starknet` graph must stay out of its chunk. Same reasoning, same
// transport, same failure policy as the Markets and Launch reads next door.
//
// ── THE VALIDATION IS THE SAFETY PROPERTY, NOT A FORMALITY ────────────────────────────────
//
// `earn-markets.ts` pins seven addresses. A wrong one would send real USDC into a vault nobody
// reviewed, and it would look completely normal doing it. So before any market is allowed to be
// transacted with, three independent sources must agree on its identity:
//
//   1. the vToken says which asset it is for   (`asset()`)
//   2. the vToken says which pool it belongs to (`pool_contract()`)
//   3. the FACTORY, asked independently, returns that same vToken for that pool and asset
//
// Three, because the first two are the vToken's own word for itself. The factory is the one that
// makes a typo in this repository fail closed instead of silently pointing somewhere real.
//
// Verified live on SN_MAIN at block 14300302: all seven agree.
//
// ── AND EVERY NUMBER IS AN OBSERVATION WITH A TIME ON IT ──────────────────────────────────
//
// Rates, liquidity and utilization move. Nothing here is cached as a fact; each snapshot carries
// `observedAt` and the surface says how old it is. A read that fails leaves `null`, never `0` —
// "we could not tell" and "there is none" are different sentences about somebody's money.
//

import { hex, type Transport } from './app-reads.js'
import { EARN_MARKETS, VESU_POOL_FACTORY, type EarnMarketDefinition } from './earn-markets.js'
import { supplyApy, utilizationOf, type EarnRateInputs } from './earn-rate.js'

/** Pre-computed so a view call is one POST with no hashing on the way. */
export const EARN_SELECTOR = {
  asset: '0x3d4060688a1800ae986e4840aebc924bb40b5bf44de4583df2257220b54b77c',
  pool_contract: '0x34044f090cf33c19084c37ddd543c545514cfdce73d9c2b6a2347a8b8e1a22c',
  v_token_for_asset: '0x1af1863f84c6038664ebb45064ad3e4a459b237acc8df4acfbf8fcd52010b92',
  asset_config: '0x40a1db21c93dd4b0a09e752c7b8cc7db2b84275621c8d2941edd851a22b56f',
  utilization: '0x30913c2a8bd8ac596ec914082fbd083d503706829d76de02b43c478c5e4bb70',
  interest_rate: '0x18120d3af7e070f8e77437712dfc1d7dbda025e3ab985b714b1af06b52c69be',
  is_paused: '0x238d7ea31550fece8f0a8a601e3ae1a7c59cb3b6cc976ceb721e31ebd9c36f9',
  convert_to_assets: '0xd98b5465896f232dc34900bfe6aa99e4ebc8a961521c6168a0664b313298c1',
  convert_to_shares: '0x25425c8baf95b52af36121a39e0304ffc963aab145baa8cbbde61af1be9be4c',
  preview_deposit: '0x2152e6631b3dd14160be68ee388eeb94d1e2b02e5c1a4c6ce5da69272c5057e',
  preview_redeem: '0x82c661d8fec0d7c2d8de38b2276e2ae2976aee47a3860369fe9594d5dd9e45',
  is_open_note_depositor_blocked: '0x43e8ae5be0ea46760b65e5f58e262f3f2e231e8461f0536bb492f7980a0d5d',
  pool: '0x35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd',
} as const

/** A `u256` on the wire is two felts, low then high. */
const u256 = (felts: readonly string[], at = 0): bigint => {
  const low = felts[at]
  const high = felts[at + 1]
  if (low === undefined || high === undefined) throw new Error(`expected a u256 at ${at}, got ${felts.length} felts`)
  return BigInt(low) + (BigInt(high) << 128n)
}

/** A `u256` argument, as the two felts a call expects. */
export const u256Args = (value: bigint): string[] => [hex(value & ((1n << 128n) - 1n)), hex(value >> 128n)]

const felt = (felts: readonly string[], at = 0): bigint => {
  const value = felts[at]
  if (value === undefined) throw new Error(`expected a felt at ${at}, got ${felts.length} felts`)
  return BigInt(value)
}

const sameFelt = (a: bigint | string, b: bigint | string): boolean => BigInt(a) === BigInt(b)

async function call(contract: string, selector: string, calldata: readonly string[], transport: Transport): Promise<string[]> {
  const result = await transport('starknet_call', {
    request: { contract_address: contract, entry_point_selector: selector, calldata },
    block_id: 'latest',
  })
  if (!Array.isArray(result) || result.some((f) => typeof f !== 'string')) {
    throw new Error('starknet_call returned something that is not a felt array')
  }
  return result as string[]
}

// ── AssetConfig, transcribed from the deployed V2 `Pool` ABI ──────────────────────────────
//
// Read back off mainnet rather than copied from documentation. Field ORDER is the wire format, so
// a reordering here would silently read the fee rate as the floor. Only the fields this surface
// uses are named; the rest are counted past.
//
//   felt  field                          felt  field
//    0-1  total_collateral_shares u256    12   is_legacy                  bool
//    2-3  total_nominal_debt      u256    13   last_updated               u64
//    4-5  reserve                 u256   14-15 last_rate_accumulator      u256
//    6-7  max_utilization         u256   16-17 last_full_utilization_rate u256
//    8-9  floor                   u256   18-19 fee_rate                   u256
//   10-11 scale                   u256           20-21 fee_shares                 u256
//
// 22 felts in total, confirmed by a live read: reserve, fee_rate and scale all decode to the
// figures the pool reports elsewhere.
//
const ASSET_CONFIG = {
  reserve: 4,
  maxUtilization: 6,
  floor: 8,
  scale: 10,
  isLegacy: 12,
  lastUpdated: 13,
  lastRateAccumulator: 14,
  lastFullUtilizationRate: 16,
  feeRate: 18,
} as const

export interface AssetConfig {
  /** Underlying sitting in the market, unborrowed. The bound on what can leave today. */
  readonly reserveWei: bigint
  readonly feeRate: bigint
  readonly lastUpdated: bigint
  readonly lastFullUtilizationRate: bigint
}

function decodeAssetConfig(felts: readonly string[]): AssetConfig {
  return {
    reserveWei: u256(felts, ASSET_CONFIG.reserve),
    feeRate: u256(felts, ASSET_CONFIG.feeRate),
    lastUpdated: felt(felts, ASSET_CONFIG.lastUpdated),
    lastFullUtilizationRate: u256(felts, ASSET_CONFIG.lastFullUtilizationRate),
  }
}

// ── The snapshot ──────────────────────────────────────────────────────────────────────────

/** Why a market cannot be supplied to right now. `null` means it can. */
export type EarnBlocker =
  | { readonly kind: 'identity'; readonly because: string }
  | { readonly kind: 'paused' }
  | { readonly kind: 'unreadable'; readonly because: string }

export interface EarnMarketSnapshot {
  readonly market: EarnMarketDefinition
  /** All three identity sources agreed. False means nothing here may be transacted with. */
  readonly validated: boolean
  readonly paused: boolean
  /** `null` where the read failed — never `0`, which would be a claim. */
  readonly apy: number | null
  readonly utilization: number | null
  readonly reserveWei: bigint | null
  /** What one whole share is worth in the underlying, for the position value. */
  readonly sharePriceWei: bigint | null
  /** When this was read, in ms. The surface shows the age. */
  readonly observedAt: number
  /** Set when supplying is refused; existing positions stay manageable regardless. */
  readonly blocker: EarnBlocker | null
}

/**
 * One market, validated and measured.
 *
 * Never throws: a market that cannot be read is a market with a `blocker`, because one dead RPC
 * must not blank a catalog of seven. Identity is checked FIRST and short-circuits — there is no
 * point reading a rate off a contract we have not established is the one we meant.
 */
export async function readMarket(market: EarnMarketDefinition, transport: Transport): Promise<EarnMarketSnapshot> {
  const observedAt = Date.now()
  const base = { market, observedAt, apy: null, utilization: null, reserveWei: null, sharePriceWei: null } as const

  let validated = false
  try {
    const [asset, poolContract, fromFactory] = await Promise.all([
      call(market.vToken, EARN_SELECTOR.asset, [], transport),
      call(market.vToken, EARN_SELECTOR.pool_contract, [], transport),
      call(VESU_POOL_FACTORY, EARN_SELECTOR.v_token_for_asset, [market.pool, market.underlying], transport),
    ])
    if (!sameFelt(felt(asset), market.underlying)) {
      return { ...base, validated: false, paused: false, blocker: { kind: 'identity', because: 'this vToken is for a different asset than the one recorded' } }
    }
    if (!sameFelt(felt(poolContract), market.pool)) {
      return { ...base, validated: false, paused: false, blocker: { kind: 'identity', because: 'this vToken belongs to a different pool than the one recorded' } }
    }
    if (!sameFelt(felt(fromFactory), market.vToken)) {
      return { ...base, validated: false, paused: false, blocker: { kind: 'identity', because: 'the factory returns a different vToken for this pool and asset' } }
    }
    validated = true
  } catch (error) {
    return { ...base, validated: false, paused: false, blocker: { kind: 'unreadable', because: reason(error) } }
  }

  try {
    const [pausedFelts, utilFelts, configFelts, shareFelts] = await Promise.all([
      call(market.pool, EARN_SELECTOR.is_paused, [], transport),
      call(market.pool, EARN_SELECTOR.utilization, [market.underlying], transport),
      call(market.pool, EARN_SELECTOR.asset_config, [market.underlying], transport),
      // One whole share, so the caller can price any position without a second round trip.
      call(market.vToken, EARN_SELECTOR.convert_to_assets, u256Args(10n ** BigInt(market.shareDecimals)), transport),
    ])
    const paused = felt(pausedFelts) === 1n
    const utilization = u256(utilFelts)
    const config = decodeAssetConfig(configFelts)
    const rateFelts = await call(
      market.pool,
      EARN_SELECTOR.interest_rate,
      [market.underlying, ...u256Args(utilization), hex(config.lastUpdated), ...u256Args(config.lastFullUtilizationRate)],
      transport,
    )
    const rate: EarnRateInputs = { borrowRatePerSecond: u256(rateFelts), utilization, feeRate: config.feeRate }
    return {
      market,
      validated,
      paused,
      apy: supplyApy(rate),
      utilization: utilizationOf(utilization),
      reserveWei: config.reserveWei,
      sharePriceWei: u256(shareFelts),
      observedAt,
      blocker: paused ? { kind: 'paused' } : null,
    }
  } catch (error) {
    // Identity held, so the market is real and any position in it is still recoverable — it is
    // only the live figures that are missing, and supplying without them would be blind.
    return { ...base, validated, paused: false, blocker: { kind: 'unreadable', because: reason(error) } }
  }
}

/** Every market, read together. Order follows the registry so the rail does not reshuffle. */
export async function readCatalog(transport: Transport, markets: readonly EarnMarketDefinition[] = EARN_MARKETS): Promise<EarnMarketSnapshot[]> {
  return Promise.all(markets.map((market) => readMarket(market, transport)))
}

// ── Quotes ────────────────────────────────────────────────────────────────────────────────

/** `preview_deposit(assets)` — the shares this supply would mint, at the market's own reckoning. */
export async function previewSupply(market: EarnMarketDefinition, assetsWei: bigint, transport: Transport): Promise<bigint> {
  return u256(await call(market.vToken, EARN_SELECTOR.preview_deposit, u256Args(assetsWei), transport))
}

/** `preview_redeem(shares)` — the underlying an exact share count would return. */
export async function previewRedeem(market: EarnMarketDefinition, sharesWei: bigint, transport: Transport): Promise<bigint> {
  return u256(await call(market.vToken, EARN_SELECTOR.preview_redeem, u256Args(sharesWei), transport))
}

/** `convert_to_assets(shares)` — what a held position is worth now. */
export async function convertToAssets(market: EarnMarketDefinition, sharesWei: bigint, transport: Transport): Promise<bigint> {
  return u256(await call(market.vToken, EARN_SELECTOR.convert_to_assets, u256Args(sharesWei), transport))
}

// ── The helper, before it is trusted with anything ────────────────────────────────────────

export type HelperCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly because: string }

/**
 * That our deployed helper is the one we think it is, and that the pool will let it work.
 *
 * Two facts, both free, both read at call time rather than assumed from a deploy log:
 *
 *  - the helper's `pool()` is the pool this build talks to — a helper wired to another pool would
 *    accept the call and then be unable to hand anything back; and
 *  - the pool has not blocked it as an open-note depositor. The pool keeps a BLOCKLIST, not an
 *    allowlist, so a fresh helper works by default — but "works by default" is a thing to verify
 *    rather than believe, and a blocked helper fails after the fee is spent.
 */
export async function checkHelper(helper: string, expectedPool: string, transport: Transport): Promise<HelperCheck> {
  try {
    const [helperPool, blocked] = await Promise.all([
      call(helper, EARN_SELECTOR.pool, [], transport),
      call(expectedPool, EARN_SELECTOR.is_open_note_depositor_blocked, [helper], transport),
    ])
    if (!sameFelt(felt(helperPool), expectedPool)) {
      return { ok: false, because: 'the Earn helper is wired to a different privacy pool than this build uses' }
    }
    if (felt(blocked) === 1n) {
      return { ok: false, because: 'the pool has blocked this helper from depositing into open notes' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, because: `the Earn helper could not be checked: ${reason(error)}` }
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
