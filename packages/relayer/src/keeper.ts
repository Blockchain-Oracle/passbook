//
// The settlement keeper: what decides, for each live market, whether to resolve it, void it, or
// leave it alone.
//
// ── WHY A KEEPER EXISTS AT ALL WHEN EVERYTHING IS PERMISSIONLESS ──────────────────────────
//
// `resolve` and `void` are open to anyone, and that is the safety property — nobody's money depends
// on this process being alive. But "anyone may" is not "someone will", and a market that nobody
// settles inside its 300-second window can only be voided afterwards, which refunds everybody and
// pays out nothing. The keeper is what makes the ordinary case ordinary. It is a convenience with
// no privileges, and it is written so that its being down costs a refund rather than a loss.
//
// ── THE FRESHNESS PRE-CHECK IS THE WHOLE DESIGN ───────────────────────────────────────────
//
// `Markets::resolve` refuses a price whose Pragma timestamp is more than 120 seconds older than the
// deadline, and a refused resolve still costs gas. Day-0 measurement found the feed holding ONE
// timestamp for eleven minutes, so this is not a rare branch — it is a normal afternoon. So the
// keeper reads the oracle first and only sends a transaction the contract will accept. Reading is
// free; sending is not.
//
// ── AND WHY IT NEVER DECIDES A WINNER ─────────────────────────────────────────────────────
//
// The keeper reads Pragma to decide WHETHER to call, never WHAT to write. The contract does its own
// read inside the same transaction and settles on that. If this process were lying about the price,
// the worst it could do is waste its own gas.
//

/** A market as the keeper needs to see it. Everything else about it is the contract's business. */
export interface KeeperMarket {
  marketId: number
  /** Unix seconds. */
  deadline: number
  /** `MARKET_ACTIVE` = 1. Anything else is already settled and needs nothing. */
  state: number
  pairId: string
}

/** What Pragma answered, as far as the keeper cares. */
export interface OracleReading {
  price: bigint
  decimals: number
  /** Pragma's own timestamp — the number the freshness guard is about. */
  lastUpdatedTimestamp: number
}

/** One thing to do, or the reason there is nothing to do. `skip` is by far the common case. */
export type KeeperAction =
  | { kind: 'resolve'; marketId: number }
  | { kind: 'void'; marketId: number }
  | { kind: 'skip'; marketId: number; because: string }

/**
 * Mirrors `markets.cairo`. Duplicated rather than imported because there is nowhere to import them
 * from — they are Cairo constants — and `keeper.test.ts` is what keeps the two sets equal.
 */
export const MARKET_ACTIVE = 1
export const RESOLVE_WINDOW = 300
export const ORACLE_MAX_LAG = 120
export const VOID_AFTER = 600
export const STRIKE_DECIMALS = 8

/**
 * Decide what to do with one market at time `now`.
 *
 * PURE, and every guard below is the contract's own, restated. That is the point: a keeper whose
 * conditions were merely similar to the contract's would send transactions that revert, and each
 * revert costs this wallet gas for nothing. `keeper.test.ts` walks the boundaries one second at a
 * time on both sides.
 *
 * `oracle` is what Pragma answered for this market's pair, or `null` if the read failed. A failed
 * read is a skip, never a guess — the contract is going to do its own read regardless, and sending
 * on a hunch is how a keeper spends a balance discovering the feed is down.
 */
export function decideMarket(
  market: KeeperMarket,
  oracle: OracleReading | null,
  now: number,
): KeeperAction {
  const skip = (because: string): KeeperAction => ({ kind: 'skip', marketId: market.marketId, because })

  if (market.state !== MARKET_ACTIVE) return skip('already settled')
  if (now < market.deadline) return skip('still open')

  // The void branch is checked BEFORE the resolve window, not after. Past `deadline + 600` the
  // resolve window has been shut for 300 seconds, so a resolve there is a guaranteed `TOO_LATE`
  // revert — and voiding is the only thing left that can free anyone's money.
  if (now > market.deadline + VOID_AFTER) {
    return { kind: 'void', marketId: market.marketId }
  }

  if (now > market.deadline + RESOLVE_WINDOW) {
    // The gap between the two windows: too late to settle, too early to void. Nothing to do but
    // wait, and saying so is more useful than a transaction that reverts.
    return skip('past the resolve window; waiting for the void timer')
  }

  if (!oracle) return skip('the oracle could not be read')

  // Every one of these is a live `assert` in `Markets::resolve`, and hitting any of them costs gas
  // to be told what a free view already knew.
  if (oracle.price === 0n) return skip('the oracle has no price for this pair')
  if (oracle.decimals !== STRIKE_DECIMALS) {
    return skip(`the feed reports ${oracle.decimals} decimals and the strike is in ${STRIKE_DECIMALS}`)
  }
  // Written as an addition rather than `deadline - ORACLE_MAX_LAG`, matching the contract, so a
  // deadline under 120 cannot underflow in one implementation and not the other.
  if (oracle.lastUpdatedTimestamp + ORACLE_MAX_LAG < market.deadline) {
    const age = market.deadline - oracle.lastUpdatedTimestamp
    return skip(`the price is ${age}s older than the deadline and the guard allows ${ORACLE_MAX_LAG}s`)
  }

  return { kind: 'resolve', marketId: market.marketId }
}

/** What a keeper pass needs to do its job. Every dependency injected, so a test needs no chain. */
export interface KeeperDeps {
  /** Every market the keeper knows about — derived from `MarketCreated` events by the caller. */
  markets: () => Promise<readonly KeeperMarket[]>
  /** Read Pragma for one pair. Returning `null` is a legitimate answer and means "skip". */
  readOracle: (pairId: string) => Promise<OracleReading | null>
  /** Send the transaction. The caller owns signing, the allowlist and the retry policy. */
  send: (action: { kind: 'resolve' | 'void'; marketId: number }) => Promise<void>
  /** Unix seconds. Injected so the boundary tests are not a race against the wall clock. */
  now: () => number
}

/** What one pass did. Returned rather than logged, so the caller decides how to say it. */
export interface KeeperPass {
  resolved: number[]
  voided: number[]
  skipped: { marketId: number; because: string }[]
  /** Markets whose transaction threw. The pass continues past them; see below. */
  failed: { marketId: number; reason: string }[]
}

/**
 * One sweep over every known market.
 *
 * ── THE ORACLE IS READ ONCE PER PAIR, NOT ONCE PER MARKET ─────────────────────────────────
 *
 * A three-strike ladder is three markets sharing one pair and one deadline, which is the shape this
 * whole product is built around. Reading Pragma once each would be three identical RPC calls to
 * settle one ladder.
 *
 * ── AND ONE MARKET'S FAILURE NEVER STOPS THE PASS ─────────────────────────────────────────
 *
 * A throw from `send` is recorded and the loop continues. The alternative — letting it propagate —
 * means one market whose transaction reverts blocks every later market in the same pass from being
 * settled inside its own 300-second window, turning one wasted fee into a row of forced voids.
 */
export async function runKeeperPass(deps: KeeperDeps): Promise<KeeperPass> {
  const pass: KeeperPass = { resolved: [], voided: [], skipped: [], failed: [] }
  const markets = await deps.markets()
  const now = deps.now()

  const oracles = new Map<string, OracleReading | null>()
  const readOnce = async (pairId: string): Promise<OracleReading | null> => {
    if (!oracles.has(pairId)) {
      try {
        oracles.set(pairId, await deps.readOracle(pairId))
      } catch {
        // A read that throws is a read that failed, which `decideMarket` already treats as a skip.
        oracles.set(pairId, null)
      }
    }
    return oracles.get(pairId) ?? null
  }

  for (const market of markets) {
    // The oracle is only consulted for markets that are actually in their resolve window — every
    // other branch of `decideMarket` reaches its answer without it, and most markets on most
    // passes are simply still open.
    const needsOracle =
      market.state === MARKET_ACTIVE &&
      now >= market.deadline &&
      now <= market.deadline + RESOLVE_WINDOW
    const oracle = needsOracle ? await readOnce(market.pairId) : null

    const action = decideMarket(market, oracle, now)
    if (action.kind === 'skip') {
      pass.skipped.push({ marketId: action.marketId, because: action.because })
      continue
    }

    try {
      await deps.send(action)
      if (action.kind === 'resolve') pass.resolved.push(action.marketId)
      else pass.voided.push(action.marketId)
    } catch (e) {
      pass.failed.push({ marketId: action.marketId, reason: String(e) })
    }
  }

  return pass
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The chain adapter — turning a provider and an account into `KeeperDeps`
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Where each field sits in a serialised `Market`, from `markets.cairo`'s struct order:
 *
 *   pair_id, strike, deadline, token, up, down, k(u256 = TWO felts), seed, collateral,
 *   state, winner, experimental
 *
 * Pinned as named constants rather than inline numbers because `k` being two felts is exactly
 * the kind of off-by-one that would read `collateral` as `state` and silently decide every
 * market was already settled — a keeper that then does nothing, forever, without erroring.
 * `keeper.test.ts` decodes a hand-built struct to hold these.
 */
export const MARKET_FIELD = { pairId: 0, deadline: 2, state: 10 } as const

/** `PragmaPricesResponse`: price, decimals, last_updated_timestamp, num_sources_aggregated, … */
export const ORACLE_FIELD = { price: 0, decimals: 1, lastUpdated: 2 } as const

/** `DataType::SpotEntry` is variant 0 — the calldata shape banked in the Day-0 evidence. */
export const SPOT_ENTRY_VARIANT = '0x0'

export interface KeeperChainIO {
  /** The deployed Markets contract. */
  markets: string
  /** Pragma, as the deployment recorded it — the oracle `Markets` was CONSTRUCTED with. */
  pragma: string
  /** A read-only contract call. */
  call: (contractAddress: string, entrypoint: string, calldata: string[]) => Promise<string[]>
  /** Sign and submit. The caller owns the account, the allowlist and the retry policy. */
  send: (contractAddress: string, entrypoint: string, calldata: string[]) => Promise<void>
  now?: () => number
}

export function decodeMarket(marketId: number, felts: readonly string[]): KeeperMarket {
  return {
    marketId,
    pairId: felts[MARKET_FIELD.pairId] ?? '0x0',
    deadline: Number(BigInt(felts[MARKET_FIELD.deadline] ?? '0x0')),
    state: Number(BigInt(felts[MARKET_FIELD.state] ?? '0x0')),
  }
}

export function decodeOracle(felts: readonly string[]): OracleReading {
  return {
    price: BigInt(felts[ORACLE_FIELD.price] ?? '0x0'),
    decimals: Number(BigInt(felts[ORACLE_FIELD.decimals] ?? '0x0')),
    lastUpdatedTimestamp: Number(BigInt(felts[ORACLE_FIELD.lastUpdated] ?? '0x0')),
  }
}

/**
 * Build `KeeperDeps` against a live chain.
 *
 * ── MARKETS ARE ENUMERATED FROM `market_count`, NOT FROM EVENTS ───────────────────────────
 *
 * The design said "scan MarketCreated". Ids are assigned sequentially from zero by
 * `Markets::op_create`, so `market_count()` plus `get_market(i)` reaches exactly the same set
 * with no block-range pagination, no `from_block` to persist across restarts, and no risk of a
 * missed page silently meaning a market never gets settled. Events remain the right tool for the
 * UI's history; for "what exists right now", the count IS the answer.
 *
 * ── AND SETTLED MARKETS ARE READ ONCE ─────────────────────────────────────────────────────
 *
 * A market that is resolved or voided can never go back to active, so once seen in a terminal
 * state it is cached and never re-read. Without that, every pass costs one RPC call per market
 * this contract has ever held, forever.
 */
export function createChainKeeperDeps(io: KeeperChainIO): KeeperDeps {
  const settled = new Map<number, KeeperMarket>()

  return {
    now: io.now ?? (() => Math.floor(Date.now() / 1000)),

    markets: async () => {
      const countFelts = await io.call(io.markets, 'market_count', [])
      const count = Number(BigInt(countFelts[0] ?? '0x0'))

      const out: KeeperMarket[] = []
      for (let id = 0; id < count; id++) {
        const cached = settled.get(id)
        if (cached) {
          out.push(cached)
          continue
        }
        const market = decodeMarket(id, await io.call(io.markets, 'get_market', [`0x${id.toString(16)}`]))
        if (market.state !== MARKET_ACTIVE) settled.set(id, market)
        out.push(market)
      }
      return out
    },

    readOracle: async (pairId) =>
      decodeOracle(await io.call(io.pragma, 'get_data_median', [SPOT_ENTRY_VARIANT, pairId])),

    send: async ({ kind, marketId }) => {
      await io.send(io.markets, kind, [`0x${marketId.toString(16)}`])
    },
  }
}
