//
// The swap sandwich, as a PLAN.
//
// A swap is the one send that hands real value to a contract this app does not control. The
// safety of that rests on a single structural fact: the transaction that withdraws to the
// executor also contains the instruction to give the proceeds back, and both name the same
// contract. These tests hold that structure down, plus the refusals that stop a malformed swap
// before a 6 STRK fee is spent on a batch the pool will reject.
//
import { describe, expect, it } from 'vitest'

import { planSend, planToValidatableActions, expectedSpanFelts } from '../src/send.js'
import type { SendWalletData, SwapLeg } from '../src/send.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { generateIdentity } from '../src/identity.js'
import { CLIENT_ACTION } from '../src/message-book.js'
import { assertActionListValid, assertBalancedActionList } from '../src/actions.js'
import type { SwapCall } from '../src/quote.js'

const FEE_WEI = 6_000_000_000_000_000_000n
const SELF = '0x0123456789abcdef'
const ACCOUNT_KEY = generateIdentity().privateKey
const USDC = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'

/**
 * AVNU's live privacy executor.
 *
 * Its ABI was read from mainnet on 2026-08-27 and declares exactly one entrypoint,
 * `privacy_invoke(buy_token, calls: Span<Call>, note_id)` — which is why this app serialises a
 * `Span<Call>` and not the four flat felts the SDK's own `simple-private-transfers.ts` sends to a
 * different executor.
 */
const EXECUTOR = '0x426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e'

const AVNU_EXCHANGE = '0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f'

/** A route shaped like the one measured live: approve, then the swap itself. */
const CALLS: readonly SwapCall[] = [
  { contractAddress: STRK_TOKEN, entrypoint: 'approve', calldata: ['0x1', '0x0'] },
  { contractAddress: AVNU_EXCHANGE, entrypoint: 'multi_route_swap', calldata: ['0x2', '0x3', '0x4'] },
]

const swapLeg = (over: Partial<SwapLeg> = {}): SwapLeg => ({
  executor: EXECUTOR,
  buyToken: USDC,
  buySymbol: 'USDC',
  calls: CALLS,
  minOutWei: 1_000_000n,
  ...over,
})

const swap = (over: Record<string, unknown> = {}) => ({
  kind: 'swap' as const,
  recipient: EXECUTOR,
  token: STRK_TOKEN,
  symbol: 'STRK',
  amount: 2n * FEE_WEI,
  mode: 'self' as const,
  swap: swapLeg(),
  ...over,
})

/** A wallet holding STRK, with the USDC subchannel NOT yet open — the ordinary first swap. */
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
    notes: [{ id: 1n, token: STRK_TOKEN, amount: 10n * FEE_WEI, witness: { channelKey: 0x55n, nonce: 0, r: 0x66n } }],
    ...over,
  }
}

const variants = (plan: { expectedActions: readonly { variant: number }[] }) =>
  plan.expectedActions.map((a) => a.variant)

describe('a swap plans the sandwich, in the compiler’s phase order', () => {
  it('opens the buy subchannel, spends, changes, opens a note, withdraws, invokes', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    if (!out.ok) throw new Error(`plan refused: ${JSON.stringify(out.failure)}`)

    expect(variants(out.plan)).toEqual([
      // The USDC subchannel — nothing has ever arrived in it, so this swap opens it.
      CLIENT_ACTION.OpenSubchannel,
      CLIENT_ACTION.UseNote,
      // Change from the sell token, back to us.
      CLIENT_ACTION.CreateEncNote,
      // The slot the executor deposits the proceeds into. Emitted AFTER the change note because
      // both are in the `createNotes` phase and the buy builder is driven second.
      CLIENT_ACTION.CreateOpenNote,
      // The sell amount, handed to the executor.
      CLIENT_ACTION.Withdraw,
      // …and the instruction to give it back, in the same transaction.
      CLIENT_ACTION.InvokeExternal,
    ])
  })

  it('withdraws to the executor, for the sell amount, in the sell token', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const withdraw = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.Withdraw)
    // THE LEG THAT MOVES REAL VALUE OUT. Every felt of it is pinned, so a compiler that rewrote
    // the destination or inflated the amount is caught before the proof binds it.
    expect(withdraw?.fields).toEqual([BigInt(EXECUTOR), BigInt(STRK_TOKEN), 2n * FEE_WEI, null])
  })

  it('opens the note for the BUY token, with no amount to commit', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const open = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.CreateOpenNote)
    // { recipient_addr, recipient_public_key, token, index, salt } — and no amount field at all.
    expect(open?.fields).toEqual([BigInt(SELF), 0x77n, BigInt(USDC), null, null])
  })

  it('pins every calldata felt except the note id, which only the compiler knows', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const invoke = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)
    expect(invoke).toBeDefined()
    const fields = invoke!.fields

    // [contract_address, calldata_len, ...calldata]
    expect(fields[0]).toBe(BigInt(EXECUTOR))
    expect(fields[1]).toBe(BigInt(fields.length - 2))
    // The route, as `swap-calldata.ts` lays it out: buy token, call count, then each call.
    expect(fields[2]).toBe(BigInt(USDC))
    expect(fields[3]).toBe(2n)
    expect(fields).toContain(BigInt(AVNU_EXCHANGE))

    // EXACTLY ONE `null`, and it is the last felt. A second one would be a value nobody is
    // checking; an earlier one would mean a call target or a selector went unpinned.
    expect(fields.filter((f) => f === null)).toHaveLength(1)
    expect(fields[fields.length - 1]).toBeNull()
  })

  it('the planned width matches what the span will actually occupy', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const invoke = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)!
    // variant tag + contract + length prefix + calldata. `plannedWidth` computes this as
    // `fields.length + 1`, and a mismatch is how a variable-width action smuggles felts past a
    // fixed-width walker.
    const calldataLen = Number(invoke.fields[1])
    expect(invoke.fields.length + 1).toBe(calldataLen + 3)
    expect(expectedSpanFelts(out.plan.expectedActions)).toBeGreaterThan(calldataLen)
  })

  it('satisfies both protocol invariants — including the token that arrives from nowhere', () => {
    const out = planSend(swap(), wallet(), SELF, null)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const actions = planToValidatableActions(out.plan)
    expect(() => assertActionListValid(actions)).not.toThrow()
    // THE ONE THAT COULD EASILY BE WRONG. The buy token has an action and no inflow, and it still
    // balances — because an open note commits nothing at compile time. Recording the expected
    // proceeds on it instead would make USDC appear out of thin air and fail here.
    expect(() => assertBalancedActionList(actions)).not.toThrow()
  })

  it('does not open a subchannel that already exists', () => {
    const already = wallet({
      channels: [
        {
          address: SELF,
          publicKey: 0x77n,
          key: 0x88n,
          tokens: [
            { token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 },
            { token: USDC, tokenIndex: 1, noteNonce: 0 },
          ],
        },
      ],
    })
    const out = planSend(swap(), already, SELF, null)
    expect(out.ok).toBe(true)
    expect(out.ok && variants(out.plan)).not.toContain(CLIENT_ACTION.OpenSubchannel)
  })
})

describe('a swap is refused before anything is spent', () => {
  const refusal = (over: Record<string, unknown>) => {
    const out = planSend(swap(over) as never, wallet(), SELF, null)
    expect(out.ok).toBe(false)
    return out.ok ? '' : out.failure.kind === 'bad-input' ? out.failure.reason : out.failure.kind
  }

  it('when the withdraw and the invoke name different contracts', () => {
    // THE REFUSAL THAT MATTERS MOST. Withdrawing to one contract and instructing another delivers
    // the sell amount somewhere nothing is going to call — an irreversible loss that looks like a
    // successful transaction.
    expect(refusal({ recipient: `0x${'b'.repeat(40)}` })).toMatch(/must be the same contract/)
  })

  it('when the executor is address 0', () => {
    expect(refusal({ recipient: '0x0', swap: swapLeg({ executor: '0x0' }) })).toMatch(/burn the sell amount/)
  })

  it('when the buy token is the token being sold', () => {
    expect(refusal({ swap: swapLeg({ buyToken: STRK_TOKEN }) })).toMatch(/which does nothing/)
  })

  it('when the route accepts no minimum', () => {
    // A floor of zero is a route that may return nothing and still succeed.
    expect(refusal({ swap: swapLeg({ minOutWei: 0n }) })).toMatch(/no floor at all/)
  })

  it('when the route names an entrypoint this app has not verified', () => {
    // The closed-selector property, reaching all the way into the plan: an unknown entrypoint
    // against a contract holding withdrawn funds is refused rather than executed.
    const sneaky = swapLeg({
      calls: [{ contractAddress: AVNU_EXCHANGE, entrypoint: 'transfer_ownership', calldata: [] }],
    })
    expect(refusal({ swap: sneaky })).toMatch(/has not verified/)
  })

  it('when a swap carries no swap leg at all', () => {
    expect(refusal({ swap: undefined })).toMatch(/carried none/)
  })

  it('when a NON-swap carries a swap leg, rather than quietly dropping it', () => {
    const out = planSend(
      { ...swap(), kind: 'withdraw' as const, recipient: `0x${'c'.repeat(40)}` },
      wallet(),
      SELF,
      null,
    )
    expect(out.ok).toBe(false)
    expect(out.ok || (out.failure.kind === 'bad-input' && out.failure.reason)).toMatch(
      /refused rather than dropped/,
    )
  })
})

describe('the executor address this app ships is the one that was read from chain', () => {
  it('is not the pool, and not an ERC-20', () => {
    // A guard against the copy-paste that would send a route to the pool itself.
    expect(BigInt(EXECUTOR)).not.toBe(BigInt(NET.pool))
    expect(BigInt(EXECUTOR)).not.toBe(BigInt(STRK_TOKEN))
  })
})

describe('the swap leg survives the sendShielded boundary', () => {
  it('reaches the prover as an InvokeExternal, rather than a bare withdraw to the executor', async () => {
    // THE REGRESSION THIS EXISTS FOR. `sendShielded` rebuilds its `SendRequest` field by field
    // rather than spreading `input`, which keeps stray keys out of a plan — and means a new field
    // is dropped in silence until it is named. Dropping THIS one turns a swap into a plain
    // withdraw to the executor: the sell amount handed over with no instruction to give anything
    // back, and a transaction that succeeds while losing the funds.
    const { sendShielded } = await import('../src/send.js')

    let plannedVariants: number[] = []
    const result = await sendShielded(
      {
        accountKey: ACCOUNT_KEY,
        account: { address: SELF, signer: {} as never },
        ...swap(),
        wallet: wallet(),
      },
      {
        acquireSubmitLock: async () => () => {},
        readHealth: async () => ({
          state: 'ok',
          feeWei: FEE_WEI,
          proofValidityBlocks: 100,
          blockNumber: 1_000_000,
        }),
        readBlockNumber: async () => 1_000_000,
        readChannelCount: async () => 1,
        prove: async (input) => {
          plannedVariants = input.plan.expectedActions.map((a) => a.variant)
          // Stopping here is the point: the plan is what this test is about, and going further
          // would need a real compiler and a real prover.
          throw new Error('stop after planning')
        },
      },
    )

    expect(plannedVariants).toContain(CLIENT_ACTION.InvokeExternal)
    expect(plannedVariants).toContain(CLIENT_ACTION.CreateOpenNote)
    // And it did not silently succeed as something else.
    expect(result.ok).toBe(false)
  })
})
