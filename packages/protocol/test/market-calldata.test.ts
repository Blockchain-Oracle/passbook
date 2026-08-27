import { describe, it, expect } from 'vitest'

import {
  MARKET_OP,
  MAX_BATCH,
  SIDE_DOWN,
  SIDE_UP,
  betPayload,
  cashoutPayload,
  claimPayload,
  createPayload,
  expectedOpenNotes,
} from '../src/market-calldata.js'

//
// THE OTHER HALF OF THE CAIRO TESTS.
//
// `contracts/tests/test_markets.cairo` asserts what the CONTRACT does with a payload. This asserts
// what the CLIENT puts in one. Between them the shape is pinned from both ends, which matters
// because nothing on chain will tell us we got it wrong in a way we can afford: a malformed
// payload reverts `apply_actions` after the six-STRK fee has already been taken.
//
// The vectors below are the same numbers the Cairo suite uses, deliberately — a reader comparing
// the two files should see the same market.
//

const felts = (r: ReturnType<typeof createPayload>): readonly string[] => {
  if (r.state !== 'ready') throw new Error(`expected ready, got refused: ${r.because}`)
  return r.calldata
}

const because = (r: { state: string; because?: string }): string => {
  if (r.state !== 'refused') throw new Error('expected a refusal')
  return r.because!
}

describe('the op codes are the contract’s', () => {
  it('matches markets.cairo', () => {
    // OP_CREATE=1, OP_BET=2, OP_CASHOUT=3, OP_CLAIM=4. Transcribed, and pinned so a renumbering
    // in Cairo that is not mirrored here fails in Node rather than on mainnet.
    expect(MARKET_OP).toEqual({ create: 1, bet: 2, cashout: 3, claim: 4 })
  })

  it('caps a batch where batch.cairo caps it', () => {
    expect(MAX_BATCH).toBe(64)
  })
})

describe('creating a market', () => {
  it('serialises the seven felts in the contract’s order', () => {
    const out = felts(
      createPayload({
        pairId: '0x4254432f555344', // 'BTC/USD'
        strike: 8_000_000_000_000n, // $80,000 at Pragma's 8 decimals
        deadline: 1_700_003_600,
        token: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
        seed: 200n,
        seederCommitment: '0x3c59f105b752b7c08f5e220f7346db44bb77350acb6eae614a451d884c265b9',
      }),
    )

    // [op, len, pair, strike, deadline, token, seed, commitment, experimental]
    expect(out).toEqual([
      '0x1',
      '0x7',
      '0x4254432f555344',
      '0x746a5288000',
      '0x6553ff10',
      '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      '0xc8',
      '0x3c59f105b752b7c08f5e220f7346db44bb77350acb6eae614a451d884c265b9',
      '0x0',
    ])
  })

  // The contract refuses a sub-hour market WITHOUT this flag and a sub-fifteen-minute one with it.
  // The flag is what makes the void-and-refund rule advertised rather than a surprise, so it has
  // to survive serialisation as a distinct value.
  it('carries the experimental flag as its own felt', () => {
    const out = felts(
      createPayload({
        pairId: '0xbadc0de',
        strike: 1n,
        deadline: 1,
        token: '0x1',
        seed: 1n,
        seederCommitment: '0x2',
        experimental: true,
      }),
    )
    expect(out.at(-1)).toBe('0x1')
  })

  it('refuses a market with no seed, because there would be nothing to price against', () => {
    const r = createPayload({
      pairId: '0xbadc0de',
      strike: 1n,
      deadline: 1,
      token: '0x1',
      seed: 0n,
      seederCommitment: '0x2',
    })
    expect(because(r)).toMatch(/seed/i)
  })

  it('refuses a seeder commitment of zero, which nothing could ever claim', () => {
    const r = createPayload({
      pairId: '0xbadc0de',
      strike: 1n,
      deadline: 1,
      token: '0x1',
      seed: 1n,
      seederCommitment: 0n,
    })
    expect(because(r)).toMatch(/commitment/i)
  })

  it('refuses a strike that would not fit the u128 the contract reads it as', () => {
    const r = createPayload({
      pairId: '0xbadc0de',
      strike: 1n << 128n,
      deadline: 1,
      token: '0x1',
      seed: 1n,
      seederCommitment: '0x2',
    })
    expect(because(r)).toMatch(/strike/i)
  })
})

describe('betting', () => {
  it('serialises one bet as [1, market, side, amount, commitment]', () => {
    const out = felts(betPayload([{ marketId: 0, side: SIDE_UP, amount: 20n, commitment: '0xabc' }]))
    expect(out).toEqual(['0x2', '0x5', '0x1', '0x0', '0x1', '0x14', '0xabc'])
  })

  // THE HEADLINE SHAPE: a three-strike ladder is one payload, one transaction, one fee. Nothing in
  // the protocol's history has ever batched like this, so the layout is worth reading literally.
  it('serialises a three-rung ladder as one payload', () => {
    const out = felts(
      betPayload([
        { marketId: 0, side: SIDE_UP, amount: 20n, commitment: '0xa1' },
        { marketId: 1, side: SIDE_UP, amount: 20n, commitment: '0xa2' },
        { marketId: 2, side: SIDE_DOWN, amount: 20n, commitment: '0xa3' },
      ]),
    )
    expect(out).toEqual([
      '0x2',
      '0xd', // 1 + 3×4 felts of payload
      '0x3',
      '0x0', '0x1', '0x14', '0xa1',
      '0x1', '0x1', '0x14', '0xa2',
      '0x2', '0x0', '0x14', '0xa3',
    ])
  })

  it('refuses a side that is neither up nor down', () => {
    // Side 2 is SIDE_SEED, which is the contract's to assign and never a caller's to claim.
    expect(because(betPayload([{ marketId: 0, side: 2, amount: 1n, commitment: '0x1' }]))).toMatch(
      /up or down|neither/i,
    )
  })

  it('refuses a stake of nothing', () => {
    expect(because(betPayload([{ marketId: 0, side: SIDE_UP, amount: 0n, commitment: '0x1' }]))).toMatch(
      /stakes nothing/i,
    )
  })

  // The contract refuses this as COMMITMENT_USED, after the fee. Refusing here is the same
  // decision taken for free — and the consequence is worth stating: the second bet's money would
  // have had no way back out.
  it('refuses two bets that share a commitment', () => {
    const r = betPayload([
      { marketId: 0, side: SIDE_UP, amount: 1n, commitment: '0xd0d0' },
      { marketId: 1, side: SIDE_UP, amount: 1n, commitment: '0xd0d0' },
    ])
    expect(because(r)).toMatch(/share a commitment/i)
  })

  it('refuses an empty batch and one past the contract’s ceiling', () => {
    expect(because(betPayload([]))).toMatch(/no bets/i)
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      marketId: 0,
      side: SIDE_UP,
      amount: 1n,
      commitment: `0x${(i + 1).toString(16)}`,
    }))
    expect(because(betPayload(many))).toMatch(/limit is 64/)
  })
})

describe('claiming', () => {
  it('serialises a batch as [n, (secret, note) × n]', () => {
    const out = felts(
      claimPayload([
        '0x51',
        '0x52',
      ]),
    )
    // The note ids are placeholders: they are minted by the compiler at proof time, so a payload
    // built now cannot know them. `noteIdSlots` is how the planner learns which felts to leave
    // unpinned and `proveSend` learns which to fill.
    expect(out).toEqual(['0x4', '0x5', '0x2', '0x51', '0x0', '0x52', '0x0'])
  })

  // The contract writes a position closed INSIDE its loop, so the second copy of a secret meets a
  // closed position and reverts the whole batch — every other settlement in it included.
  it('refuses the same secret twice in one batch', () => {
    const r = claimPayload([
      '0x51',
      '0x51',
    ])
    expect(because(r)).toMatch(/already being settled/i)
  })

  // Two payouts into one note is the pool's own INDEX_NOT_SEQUENTIAL / NON_ZERO_VALUE revert.
  // A caller can no longer cause it: ids are not an input, and the compiler mints one per open
  // note. What IS asserted is that every entry gets its own slot to be filled.
  it('reserves one distinct note slot per settlement', () => {
    const r = claimPayload(['0x51', '0x52', '0x53'])
    if (r.state !== 'ready') throw new Error('expected ready')
    expect(r.noteIdSlots).toEqual([4, 6, 8])
    expect(new Set(r.noteIdSlots).size).toBe(3)
    for (const slot of r.noteIdSlots) expect(r.calldata[slot]).toBe('0x0')
  })
})

describe('cashing out', () => {
  it('serialises [secret, note, min_out]', () => {
    const out = felts(cashoutPayload({ secret: '0x5', minOut: 26n }))
    expect(out).toEqual(['0x3', '0x3', '0x5', '0x0', '0x1a'])
  })

  it('accepts a floor of zero, which means “any price”', () => {
    const out = felts(cashoutPayload({ secret: '0x5', minOut: 0n }))
    expect(out.at(-1)).toBe('0x0')
  })

  // The note id is a placeholder the compiler fills, so the only thing a caller can get wrong
  // here is the secret — and a cash-out with no secret proves no position.
  it('refuses a cash-out with no secret to prove the position', () => {
    expect(because(cashoutPayload({ secret: 0n, minOut: 0n }))).toMatch(/secret/i)
  })

  it('reserves the note-id slot for the compiler rather than asking for one', () => {
    const r = cashoutPayload({ secret: '0x5', minOut: 0n })
    if (r.state !== 'ready') throw new Error('expected ready')
    expect(r.noteIdSlots).toEqual([3])
    expect(r.calldata[3]).toBe('0x0')
  })
})

//
// THE INVARIANT THE POOL CANNOT CHECK FOR US.
//
// Day-0 verification found that `compile_actions` — the free view this repo validates every action
// list against — no-ops the open-note emission, so three unmatched open notes COMPILE CLEANLY and
// revert on chain at `UNDEPOSITED_OPEN_NOTES`, after the fee. The client is the only party that can
// count these, which makes this function's correctness worth six STRK a mistake.
//
describe('the open-note count the pool cannot check', () => {
  it('is zero for money going in', () => {
    expect(expectedOpenNotes(MARKET_OP.create, 1)).toBe(0)
    expect(expectedOpenNotes(MARKET_OP.bet, 3)).toBe(0)
  })

  it('is one per claim, so an n-claim batch mints exactly n notes', () => {
    expect(expectedOpenNotes(MARKET_OP.claim, 1)).toBe(1)
    expect(expectedOpenNotes(MARKET_OP.claim, 3)).toBe(3)
  })

  it('is exactly one for a cash-out, which sells one whole position', () => {
    expect(expectedOpenNotes(MARKET_OP.cashout, 1)).toBe(1)
  })
})
