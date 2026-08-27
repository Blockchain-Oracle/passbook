import { describe, it, expect } from 'vitest'

import {
  MARKET_ACTIVE,
  MARKET_FIELD,
  createChainKeeperDeps,
  decodeMarket,
  decodeOracle,
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// The chain adapter
// ─────────────────────────────────────────────────────────────────────────────────────────

//
// THE DECODE IS WHERE A SILENT BUG WOULD HIDE. `Market.k` is a u256 and therefore TWO felts, so
// every field after it sits one place further along than a naive reading suggests. Get that wrong
// and `collateral` is read as `state`: every market looks already-settled, the keeper does nothing
// forever, and nothing errors. This is a hand-built struct in the contract's own field order.
//
describe('decoding a Market off the chain', () => {
  const struct = [
    '0x4254432f555344',        //  0 pair_id  'BTC/USD'
    '0x746a5288000',           //  1 strike
    '0x6553ff10',              //  2 deadline
    '0xabc',                   //  3 token
    '0xb6',                    //  4 up
    '0xdc',                    //  5 down
    '0x9c40',                  //  6 k.low   ← u256, so it takes
    '0x0',                     //  7 k.high  ← TWO felts
    '0xc8',                    //  8 seed
    '0xdc',                    //  9 collateral
    '0x1',                     // 10 state = MARKET_ACTIVE
    '0xff',                    // 11 winner = WINNER_UNSET
    '0x0',                     // 12 experimental
  ]

  it('reads the three fields the keeper acts on', () => {
    expect(decodeMarket(7, struct)).toEqual({
      marketId: 7,
      pairId: '0x4254432f555344',
      deadline: 0x6553ff10,
      state: MARKET_ACTIVE,
    })
  })

  // If the u256 were miscounted, `state` would land on `collateral` (0xdc = 220) — which is not
  // MARKET_ACTIVE, so every market would read as settled and the keeper would go quietly dead.
  it('does not mistake collateral for state', () => {
    expect(decodeMarket(0, struct).state).not.toBe(0xdc)
    expect(MARKET_FIELD.state).toBe(10)
  })
})

describe('decoding a Pragma reading', () => {
  it('reads price, decimals and the timestamp the guard is about', () => {
    // price, decimals, last_updated_timestamp, num_sources_aggregated
    expect(decodeOracle(['0x74a4bdd6045', '0x8', '0x6553ff10', '0xa'])).toEqual({
      price: 0x74a4bdd6045n,
      decimals: 8,
      lastUpdatedTimestamp: 0x6553ff10,
    })
  })
})

describe('the chain adapter', () => {
  const MARKETS = '0x750ec8'
  const PRAGMA = '0x2a85bd'

  const market = (deadline: number, state = MARKET_ACTIVE) => [
    ' 0x4254432f555344'.trim(), '0x1', `0x${deadline.toString(16)}`, '0xabc',
    '0xb6', '0xdc', '0x9c40', '0x0', '0xc8', '0xdc',
    `0x${state.toString(16)}`, '0xff', '0x0',
  ]

  const io = (count: number, states: number[] = []) => {
    const calls: string[] = []
    const sent: { entrypoint: string; calldata: string[] }[] = []
    return {
      calls,
      sent,
      deps: createChainKeeperDeps({
        markets: MARKETS,
        pragma: PRAGMA,
        now: () => DEADLINE + 10,
        call: async (contractAddress, entrypoint, calldata) => {
          calls.push(`${entrypoint}(${calldata.join(',')})`)
          if (entrypoint === 'market_count') return [`0x${count.toString(16)}`]
          if (entrypoint === 'get_market') {
            const id = Number(BigInt(calldata[0]!))
            return market(DEADLINE, states[id] ?? MARKET_ACTIVE)
          }
          if (entrypoint === 'get_data_median') return ['0x1', '0x8', `0x${DEADLINE.toString(16)}`, '0xa']
          throw new Error(`unexpected ${entrypoint}`)
        },
        send: async (contractAddress, entrypoint, calldata) => {
          sent.push({ entrypoint, calldata })
        },
      }),
    }
  }

  // Ids are assigned sequentially from zero by `op_create`, so the count IS the enumeration —
  // no block-range pagination, no `from_block` to persist across restarts, and no missed page
  // silently meaning a market never gets settled.
  it('enumerates every market from the count', async () => {
    const { deps } = io(3)
    expect(await deps.markets()).toHaveLength(3)
  })

  it('asks Pragma for the SpotEntry variant, which is the recorded calldata shape', async () => {
    const { deps, calls } = io(1)
    await deps.readOracle('0x4254432f555344')
    expect(calls).toContain('get_data_median(0x0,0x4254432f555344)')
  })

  // A resolved or voided market can never go back to active, so re-reading it every minute is one
  // wasted RPC call per market this contract has ever held, forever.
  it('reads a settled market once and caches it', async () => {
    const { deps, calls } = io(2, [2, MARKET_ACTIVE]) // market 0 is RESOLVED
    await deps.markets()
    await deps.markets()

    const reads = calls.filter((c) => c.startsWith('get_market'))
    expect(reads.filter((c) => c === 'get_market(0x0)')).toHaveLength(1)
    // The still-active one is re-read, because its state can still change.
    expect(reads.filter((c) => c === 'get_market(0x1)')).toHaveLength(2)
  })

  it('sends resolve and void against the Markets contract by market id', async () => {
    const { deps, sent } = io(1)
    await deps.send({ kind: 'resolve', marketId: 7 })
    await deps.send({ kind: 'void', marketId: 9 })
    expect(sent).toEqual([
      { entrypoint: 'resolve', calldata: ['0x7'] },
      { entrypoint: 'void', calldata: ['0x9'] },
    ])
  })

  it('drives a whole pass end to end against the fake chain', async () => {
    const { deps, sent } = io(2)
    const pass = await runKeeperPass(deps)
    expect(pass.resolved).toEqual([0, 1])
    expect(sent.map((s) => s.entrypoint)).toEqual(['resolve', 'resolve'])
  })
})

// The pass-level failure the SERVER's `.catch` exists for. A per-market failure is absorbed by
// `runKeeperPass` itself (above); a chain that cannot be enumerated at all rejects the whole pass,
// and an unhandled rejection inside a timer takes the relayer down — which has nothing to do with
// its actual job of submitting other people's transactions. `server.ts` catches this by name.
describe('when the chain itself cannot be reached', () => {
  it('rejects the pass rather than pretending there are no markets', async () => {
    const deps = {
      markets: async () => {
        throw new Error('rpc unreachable')
      },
      readOracle: async () => null,
      send: async () => {},
      now: () => DEADLINE,
    }
    await expect(runKeeperPass(deps)).rejects.toThrow(/rpc unreachable/)
  })
})
