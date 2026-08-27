import { describe, it, expect } from 'vitest'

import {
  MARKET_ACTIVE,
  ORACLE_MAX_LAG,
  RESOLVE_WINDOW,
  VOID_AFTER,
  decideMarket,
  runKeeperPass,
  type KeeperMarket,
  type OracleReading,
} from '../src/keeper.js'

//
// Every boundary here is a live `assert` in `markets.cairo`, and crossing one costs this wallet gas
// to be told what a free read already knew. So the windows are walked a second at a time on both
// sides — a keeper whose conditions merely resembled the contract's would be a slow leak.
//

const DEADLINE = 1_700_000_000

const market = (over: Partial<KeeperMarket> = {}): KeeperMarket => ({
  marketId: 7,
  deadline: DEADLINE,
  state: MARKET_ACTIVE,
  pairId: 'BTC/USD',
  ...over,
})

/** A reading the contract would accept: 8 decimals, and stamped exactly at the deadline. */
const fresh = (over: Partial<OracleReading> = {}): OracleReading => ({
  price: 8_100_000_000_000n,
  decimals: 8,
  lastUpdatedTimestamp: DEADLINE,
  ...over,
})

describe('a market that needs nothing', () => {
  it('is skipped while it is still open', () => {
    expect(decideMarket(market(), fresh(), DEADLINE - 1)).toMatchObject({
      kind: 'skip',
      because: 'still open',
    })
  })

  it('is skipped once it has already been settled', () => {
    // MARKET_RESOLVED = 2, MARKET_VOIDED = 3. Either way there is nothing left to do.
    expect(decideMarket(market({ state: 2 }), fresh(), DEADLINE + 10)).toMatchObject({ kind: 'skip' })
    expect(decideMarket(market({ state: 3 }), fresh(), DEADLINE + 10)).toMatchObject({ kind: 'skip' })
  })
})

describe('the resolve window', () => {
  it('opens exactly at the deadline', () => {
    expect(decideMarket(market(), fresh(), DEADLINE)).toEqual({ kind: 'resolve', marketId: 7 })
  })

  it('is still open on its last second', () => {
    expect(decideMarket(market(), fresh(), DEADLINE + RESOLVE_WINDOW)).toEqual({
      kind: 'resolve',
      marketId: 7,
    })
  })

  // Past here `resolve` is a guaranteed TOO_LATE revert, and the void timer has not opened. There
  // is genuinely nothing to do, and saying so beats sending a transaction to find out.
  it('closes one second later, into the gap before voiding', () => {
    expect(decideMarket(market(), fresh(), DEADLINE + RESOLVE_WINDOW + 1)).toMatchObject({
      kind: 'skip',
      because: expect.stringContaining('void timer'),
    })
  })
})

//
// THE PRE-CHECK THAT PAYS FOR ITSELF. Day-0 measurement caught Pragma holding one timestamp for
// eleven minutes, so a stale feed is a normal afternoon rather than a rare branch — and every
// resolve sent into one is gas spent to be refused.
//
describe('the freshness guard, restated exactly as the contract has it', () => {
  it('accepts a price stamped exactly at the limit', () => {
    const oracle = fresh({ lastUpdatedTimestamp: DEADLINE - ORACLE_MAX_LAG })
    expect(decideMarket(market(), oracle, DEADLINE + 10)).toEqual({ kind: 'resolve', marketId: 7 })
  })

  it('refuses one second past it, rather than paying to be told', () => {
    const oracle = fresh({ lastUpdatedTimestamp: DEADLINE - ORACLE_MAX_LAG - 1 })
    expect(decideMarket(market(), oracle, DEADLINE + 10)).toMatchObject({
      kind: 'skip',
      because: expect.stringContaining('older than the deadline'),
    })
  })

  it('skips when the oracle could not be read at all', () => {
    expect(decideMarket(market(), null, DEADLINE + 10)).toMatchObject({
      kind: 'skip',
      because: 'the oracle could not be read',
    })
  })

  it('skips a feed with no price', () => {
    expect(decideMarket(market(), fresh({ price: 0n }), DEADLINE + 10)).toMatchObject({ kind: 'skip' })
  })

  // The strike is recorded in Pragma's 8 decimals. A feed that changed scale would make the
  // comparison meaningless, and the contract stops rather than settling on it.
  it('skips a feed that changed its decimals', () => {
    expect(decideMarket(market(), fresh({ decimals: 18 }), DEADLINE + 10)).toMatchObject({
      kind: 'skip',
      because: expect.stringContaining('decimals'),
    })
  })

  // A deadline under 120 would underflow `deadline - ORACLE_MAX_LAG` in u64. The contract writes
  // the guard as an addition for exactly this reason, and so does the keeper.
  it('does not underflow on a market with a very small deadline', () => {
    const early = market({ deadline: 60 })
    const oracle = fresh({ lastUpdatedTimestamp: 60 })
    expect(decideMarket(early, oracle, 70)).toEqual({ kind: 'resolve', marketId: 7 })
  })
})

describe('voiding', () => {
  it('is refused on the timer’s last second, matching the contract’s strict comparison', () => {
    expect(decideMarket(market(), null, DEADLINE + VOID_AFTER)).toMatchObject({ kind: 'skip' })
  })

  it('opens one second later', () => {
    expect(decideMarket(market(), null, DEADLINE + VOID_AFTER + 1)).toEqual({
      kind: 'void',
      marketId: 7,
    })
  })

  // The void branch is checked BEFORE the resolve window on purpose: past the void timer a resolve
  // is a certain revert, and voiding is the only thing left that frees anyone's money.
  it('wins over resolving even when the oracle is perfectly fresh', () => {
    const late = DEADLINE + VOID_AFTER + 1
    expect(decideMarket(market(), fresh({ lastUpdatedTimestamp: late }), late)).toEqual({
      kind: 'void',
      marketId: 7,
    })
  })
})

describe('a full pass', () => {
  const makeDeps = (markets: KeeperMarket[], now: number, oracle: OracleReading | null = fresh()) => {
    const sent: { kind: string; marketId: number }[] = []
    const reads: string[] = []
    return {
      sent,
      reads,
      deps: {
        markets: async () => markets,
        readOracle: async (pairId: string) => {
          reads.push(pairId)
          return oracle
        },
        send: async (action: { kind: 'resolve' | 'void'; marketId: number }) => {
          sent.push(action)
        },
        now: () => now,
      },
    }
  }

  // A three-strike ladder is three markets on one pair and one deadline — the shape this whole
  // product is built around. Reading the oracle per market would be three identical RPC calls to
  // settle one ladder.
  it('reads the oracle once per pair, not once per market', async () => {
    const ladder = [
      market({ marketId: 1 }),
      market({ marketId: 2 }),
      market({ marketId: 3 }),
    ]
    const { deps, reads, sent } = makeDeps(ladder, DEADLINE + 10)

    const pass = await runKeeperPass(deps)

    expect(reads).toEqual(['BTC/USD'])
    expect(pass.resolved).toEqual([1, 2, 3])
    expect(sent).toHaveLength(3)
  })

  it('does not read the oracle at all for markets that are still open', async () => {
    const { deps, reads } = makeDeps([market()], DEADLINE - 100)
    const pass = await runKeeperPass(deps)
    expect(reads).toEqual([])
    expect(pass.skipped).toHaveLength(1)
  })

  // One market's reverting transaction must not cost every later market in the pass its own
  // 300-second window — that turns one wasted fee into a row of forced voids.
  it('records a failure and keeps going', async () => {
    const { deps } = makeDeps([market({ marketId: 1 }), market({ marketId: 2 })], DEADLINE + 10)
    let first = true
    const failing = {
      ...deps,
      send: async (action: { kind: 'resolve' | 'void'; marketId: number }) => {
        if (first) {
          first = false
          throw new Error('nonce collision')
        }
        void action
      },
    }

    const pass = await runKeeperPass(failing)

    expect(pass.failed).toEqual([{ marketId: 1, reason: expect.stringContaining('nonce collision') }])
    expect(pass.resolved).toEqual([2])
  })

  it('treats an oracle read that throws as a skip rather than a crash', async () => {
    const { deps } = makeDeps([market()], DEADLINE + 10)
    const throwing = {
      ...deps,
      readOracle: async () => {
        throw new Error('rpc down')
      },
    }
    const pass = await runKeeperPass(throwing)
    expect(pass.resolved).toEqual([])
    expect(pass.skipped[0]?.because).toBe('the oracle could not be read')
  })

  it('voids the ones past their timer and resolves the ones in window, in one pass', async () => {
    const markets = [
      market({ marketId: 1, deadline: DEADLINE }),
      market({ marketId: 2, deadline: DEADLINE - VOID_AFTER - 100 }),
    ]
    const { deps } = makeDeps(markets, DEADLINE + 10)
    const pass = await runKeeperPass(deps)
    expect(pass.resolved).toEqual([1])
    expect(pass.voided).toEqual([2])
  })
})
