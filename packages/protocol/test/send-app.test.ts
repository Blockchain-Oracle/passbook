//
// The two app-contract shapes, as PLANS.
//
// Seven send kinds ride on two action lists. A FUNDING op (create, bet, buy) is the bridge shape:
// spend, change, withdraw the stake to our contract, invoke it, and get an empty span back — no
// open notes at all. A SETTLING op (claim, cash-out, redeem, refund) is the swap shape generalised
// from one open note to N: mint one per payout, invoke, and the contract's deposits fill them.
//
// The number that costs six STRK to get wrong is the open-note count. The pool asserts every open
// note in a transaction was deposited into, and its free `compile_actions` view CANNOT see a
// mismatch — Day-0 verification found it no-ops the emission, so three unmatched notes compiled
// cleanly and would have reverted on chain after the fee. These tests are where that count is held.
//
import { describe, expect, it } from 'vitest'

import { planSend, planToValidatableActions } from '../src/send.js'
import type { AppInvokeLeg, SendWalletData } from '../src/send.js'
import { STRK_TOKEN } from '../src/constants.js'
import { CLIENT_ACTION } from '../src/message-book.js'
import { assertActionListValid, assertBalancedActionList } from '../src/actions.js'
import { MARKET_OP, SIDE_UP, betPayload, claimPayload } from '../src/market-calldata.js'

const FEE_WEI = 6_000_000_000_000_000_000n
const SELF = '0x0123456789abcdef'
const MARKETS = '0x750ec8f6c6c96f1e66129f84ac8ca798973bb3e5fd9384269706a7e079f4388'
/** A launch token: an address that did not exist when this wallet last synced. */
const LAUNCH_TOKEN = '0x0abcdef0123456789'

const ready = (r: ReturnType<typeof betPayload>) => {
  if (r.state !== 'ready') throw new Error(`builder refused: ${r.because}`)
  return r
}

/** A three-rung ladder, built by the real builder rather than hand-written felts. */
const LADDER = ready(
  betPayload([
    { marketId: 0, side: SIDE_UP, amount: 20n, commitment: '0xa1' },
    { marketId: 1, side: SIDE_UP, amount: 20n, commitment: '0xa2' },
    { marketId: 2, side: SIDE_UP, amount: 20n, commitment: '0xa3' },
  ]),
)

/** The settlement of that ladder: three secrets, three notes. */
const CLAIM = ready(
  claimPayload([
    '0x51',
    '0x52',
    '0x53',
  ]),
)

const fundingLeg = (over: Partial<AppInvokeLeg> = {}): AppInvokeLeg => ({
  contract: MARKETS,
  op: MARKET_OP.bet,
  calldata: LADDER.calldata,
  noteIdSlots: LADDER.noteIdSlots,
  openNoteCount: 0,
  ...over,
})

const settlingLeg = (over: Partial<AppInvokeLeg> = {}): AppInvokeLeg => ({
  contract: MARKETS,
  op: MARKET_OP.claim,
  calldata: CLAIM.calldata,
  noteIdSlots: CLAIM.noteIdSlots,
  openNoteCount: 3,
  payoutToken: STRK_TOKEN,
  ...over,
})

const bet = (over: Record<string, unknown> = {}) => ({
  kind: 'market-bet' as const,
  recipient: MARKETS,
  token: STRK_TOKEN,
  symbol: 'STRK',
  amount: 3n * FEE_WEI,
  mode: 'self' as const,
  app: fundingLeg(),
  ...over,
})

const claim = (over: Record<string, unknown> = {}) => ({
  kind: 'market-claim' as const,
  recipient: MARKETS,
  token: STRK_TOKEN,
  symbol: 'STRK',
  // A settling send moves nothing of the user's; the payout is arriving.
  amount: 0n,
  mode: 'self' as const,
  app: settlingLeg(),
  ...over,
})

function wallet(over: Partial<SendWalletData> = {}): SendWalletData {
  return {
    channels: [
      {
        address: SELF,
        publicKey: 0x77n,
        key: 0x88n,
        tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }],
      },
    ],
    notes: [
      { id: 1n, token: STRK_TOKEN, amount: 20n * FEE_WEI, witness: { channelKey: 0x55n, nonce: 0, r: 0x66n } },
    ],
    ...over,
  }
}

const variants = (plan: { expectedActions: readonly { variant: number }[] }) =>
  plan.expectedActions.map((a) => a.variant)

const planned = (request: ReturnType<typeof bet> | ReturnType<typeof claim>, w = wallet(), fee = null) => {
  const out = planSend(request as never, w, SELF, fee)
  if (!out.ok) throw new Error(`plan refused: ${JSON.stringify(out.failure)}`)
  return out.plan
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The funding shape
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('a ladder bet plans the bridge shape', () => {
  it('spends, changes, withdraws the stake to Markets, and invokes it', () => {
    expect(variants(planned(bet()))).toEqual([
      CLIENT_ACTION.UseNote,
      CLIENT_ACTION.CreateEncNote,
      CLIENT_ACTION.Withdraw,
      CLIENT_ACTION.InvokeExternal,
    ])
  })

  // THE OPEN-NOTE INVARIANT, funding side. A bet is paid nothing back — the contract returns an
  // empty deposit span — so any open note in this transaction is an unmatched one, and an
  // unmatched open note reverts on chain after the fee with `compile_actions` unable to see it.
  it('creates no open notes at all', () => {
    expect(variants(planned(bet()))).not.toContain(CLIENT_ACTION.CreateOpenNote)
  })

  it('refuses a funding op that asks for open notes anyway', () => {
    const out = planSend(bet({ app: fundingLeg({ openNoteCount: 1, noteIdSlots: [2] }) }) as never, wallet(), SELF, null)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect((out.failure as { reason: string }).reason).toMatch(/must create no open notes/)
  })

  it('withdraws the whole stake to the contract it invokes', () => {
    const plan = planned(bet())
    const withdraw = plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.Withdraw)
    expect(withdraw?.fields).toEqual([BigInt(MARKETS), BigInt(STRK_TOKEN), 3n * FEE_WEI, null])
  })

  // A funding payload has no note ids in it, so there is nothing the compiler fills — which makes
  // a bet as completely pinned as a crossing is, and more pinned than a swap.
  it('pins every felt of the invoke, with no blanks', () => {
    const plan = planned(bet())
    const invoke = plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)
    expect(invoke?.fields.some((f) => f === null)).toBe(false)
    expect(invoke?.fields[0]).toBe(BigInt(MARKETS))
    expect(invoke?.fields[1]).toBe(BigInt(LADDER.calldata.length))
    // The op itself is pinned, so a compiler that redirected a bet into a claim is caught here.
    expect(invoke?.fields[2]).toBe(BigInt(MARKET_OP.bet))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// The settling shape — the generalisation from one open note to N
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('a three-strike claim plans N open notes', () => {
  it('mints exactly one open note per payout, and no withdraw of its own', () => {
    // Self mode, so there is no fee leg and no note to spend for one: the whole list is the three
    // slots the payouts land in, plus the instruction that fills them. `create_open_note` is one
    // of the six actions that produce a `WriteOnce`, so this list still carries replay protection.
    expect(variants(planned(claim()))).toEqual([
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.InvokeExternal,
    ])
  })

  it('spends a note only to cover the relayer’s fee, and withdraws only that', () => {
    const plan = planned(claim({ mode: 'relayer' }), wallet(), {
      recipient: '0xfee',
      feeWei: FEE_WEI,
    } as never)
    expect(variants(plan)).toEqual([
      CLIENT_ACTION.UseNote,
      CLIENT_ACTION.CreateEncNote, // change from the fee note
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.CreateOpenNote,
      CLIENT_ACTION.Withdraw, // the fee, and nothing else
      CLIENT_ACTION.InvokeExternal,
    ])
    const withdraws = plan.expectedActions.filter((a) => a.variant === CLIENT_ACTION.Withdraw)
    expect(withdraws).toHaveLength(1)
    expect(withdraws[0]?.fields[2]).toBe(FEE_WEI)
  })

  it('opens each note for the payout token, committing no amount', () => {
    const plan = planned(claim())
    const opens = plan.expectedActions.filter((a) => a.variant === CLIENT_ACTION.CreateOpenNote)
    expect(opens).toHaveLength(3)
    for (const open of opens) {
      // { recipient_addr, recipient_public_key, token, index, salt } — no amount field at all.
      expect(open.fields).toEqual([BigInt(SELF), 0x77n, BigInt(STRK_TOKEN), null, null])
    }
  })

  // THE GENERALISATION ITSELF: a swap pins every felt but the last; a claim pins every felt but
  // the n the builder named. Everything else — the secrets, the count, the op — is compared.
  it('blanks exactly the note-id slots and pins everything else', () => {
    const plan = planned(claim())
    const invoke = plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)!
    // fields = [contract, calldata_len, ...calldata], so calldata index i is at fields[i + 2].
    const blanks = invoke.fields
      .map((f, i) => (f === null ? i - 2 : -1))
      .filter((i) => i >= 0)
    expect(blanks).toEqual([...CLAIM.noteIdSlots])
    expect(blanks).toHaveLength(3)
    // The secrets sit beside the blanked ids and are pinned, so a payload that swapped one out
    // between the plan and the proof is caught.
    expect(invoke.fields[2 + 3]).toBe(BigInt('0x51'))
  })

  it('refuses a settling op with nowhere for its payout to land', () => {
    const out = planSend(claim({ app: settlingLeg({ openNoteCount: 0, noteIdSlots: [] }) }) as never, wallet(), SELF, null)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect((out.failure as { reason: string }).reason).toMatch(/nowhere for its payout/)
  })

  // A batch that mints three notes and blanks two slots is a payload with a stale id in it, which
  // the contract would deposit into somebody else's note.
  it('refuses a count and a slot list that disagree', () => {
    const out = planSend(
      claim({ app: settlingLeg({ openNoteCount: 2 }) }) as never,
      wallet(),
      SELF,
      null,
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect((out.failure as { reason: string }).reason).toMatch(/must be the same number/)
  })
})

//
// A LAUNCH REDEMPTION IS PAID IN A TOKEN THAT DID NOT EXIST WHEN THE LAUNCH OPENED — `graduate()`
// deploys it. The pool has no token allowlist anywhere in its deposit path (proven live on Day 0
// against a phantom token at an address with no contract), but it does require an `OpenSubchannel`
// for the token in the same transaction, which is what this checks.
//
describe('a payout in a token this wallet has never held', () => {
  it('opens the subchannel for it in the same transaction', () => {
    const request = claim({
      token: LAUNCH_TOKEN,
      app: settlingLeg({ payoutToken: LAUNCH_TOKEN, openNoteCount: 3 }),
    })
    const plan = planned(request)
    expect(variants(plan)[0]).toBe(CLIENT_ACTION.OpenSubchannel)
    const sub = plan.expectedActions[0]!
    // { recipient_addr, recipient_public_key, channel_key, index, token, salt }
    expect(sub.fields[4]).toBe(BigInt(LAUNCH_TOKEN))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
// The refusals that cost nothing here and six STRK on chain
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('refusals', () => {
  const refusal = (request: unknown) => {
    const out = planSend(request as never, wallet(), SELF, null)
    if (out.ok) throw new Error('expected a refusal')
    return (out.failure as { reason: string }).reason
  }

  // The same two-address rule the swap and bridge legs carry: withdrawing to one contract and
  // instructing another strands the stake in something nothing is going to call.
  it('refuses a stake withdrawn to one contract and an op sent to another', () => {
    expect(refusal(bet({ recipient: '0xdead' }))).toMatch(/must be the same contract/)
  })

  // Before the deploy lands there is no address, and an absent one arriving as 0 would withdraw
  // the stake to nowhere. This is the refusal a surface renders as its coming-state.
  it('refuses an app contract that has not been deployed yet', () => {
    expect(refusal(bet({ recipient: '0x0', app: fundingLeg({ contract: '0x0' }) }))).toMatch(
      /no deployed address yet/,
    )
  })

  it('refuses a leg whose declared op disagrees with its calldata', () => {
    expect(refusal(bet({ app: fundingLeg({ op: MARKET_OP.claim }) }))).toMatch(
      /must be the same operation/,
    )
  })

  it('refuses a note-id slot outside the calldata', () => {
    expect(
      refusal(claim({ app: settlingLeg({ noteIdSlots: [3, 5, 999] }) })),
    ).toMatch(/outside the/)
  })

  it('refuses a payout token that disagrees with the request’s token', () => {
    expect(refusal(claim({ token: LAUNCH_TOKEN }))).toMatch(/must be the same token/)
  })

  // A settling send has no amount by construction. Requiring callers to invent one would mean a
  // `Withdraw` could be built out of the invention.
  it('refuses a settling send carrying an amount', () => {
    expect(refusal(claim({ amount: 1n }))).toMatch(/must be 0/)
  })

  it('refuses an app leg on a kind that is not an app kind', () => {
    expect(
      refusal({
        kind: 'transfer',
        recipient: SELF,
        token: STRK_TOKEN,
        symbol: 'STRK',
        amount: 1n,
        mode: 'self',
        app: fundingLeg(),
      }),
    ).toMatch(/carried an app leg/)
  })

  it('refuses an app kind carrying no leg', () => {
    expect(refusal({ ...bet(), app: undefined })).toMatch(/needs a contract, an op and a payload/)
  })
})

//
// Both protocol invariants, on both shapes. The balance one is the substantive check: the pool
// demands every token close at exactly zero, and an open note contributes nothing to that because
// its value is written by a deposit that has not happened at compile time.
//
describe('both shapes satisfy the protocol invariants', () => {
  it('a funding op is valid and balanced', () => {
    const actions = planToValidatableActions(planned(bet()))
    expect(() => assertActionListValid(actions)).not.toThrow()
    expect(() => assertBalancedActionList(actions)).not.toThrow()
  })

  it('a settling op is valid and balanced with three zero-amount open notes', () => {
    const actions = planToValidatableActions(planned(claim()))
    expect(actions.filter((a) => a.type === 'CreateOpenNote')).toHaveLength(3)
    expect(() => assertActionListValid(actions)).not.toThrow()
    expect(() => assertBalancedActionList(actions)).not.toThrow()
  })
})
