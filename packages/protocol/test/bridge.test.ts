//
// The crossing, held to a transaction that actually happened.
//
// A burn cannot be undone, so the layout these tests check is not checked against a struct
// definition — it is checked against mainnet transaction
// `0x68690c681901270262516eea661fcc510bcb4abc09fd11ff0e6738d9af02db5`, decoded felt by felt. If
// this file passes, this app builds the same eight felts a successful crossing carried.
//
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

import {
  BRIDGE_USDC,
  buyParamsCalldata,
  deliveredWei,
  destinationFor,
  FAST_FINALITY_THRESHOLD,
  feeQuoteUrl,
  fetchForwardFee,
  OUTBOUND_ANONYMIZER,
  parseDestination,
} from '../src/bridge.js'
import { planSend, planToValidatableActions } from '../src/send.js'
import type { BridgeLeg, SendWalletData } from '../src/send.js'
import { CLIENT_ACTION } from '../src/message-book.js'
import { assertActionListValid, assertBalancedActionList } from '../src/actions.js'

// ── The decoded crossing ──────────────────────────────────────────────────────────────────

/**
 * The `InvokeExternal` payload of a real, successful burn, read straight out of the transaction's
 * calldata: `[contract_address, 0x8, ...BuyParams]`.
 *
 * 1.136342 USDC to a Polygon address, 0.065372 of it fee, CCTP Fast.
 */
const REAL = {
  recipient: '0xa89291d2fa60d5d02b711aa9108399963299979d',
  amount: 0x1158d6n,
  maxFee: 0xff5cn,
  calldata: [
    '0xfa60d5d02b711aa9108399963299979d', // mint_recipient.low
    '0xa89291d2', //                         mint_recipient.high
    '0x1158d6', //                           amount.low
    '0x0', //                                amount.high
    '0xff5c', //                             max_fee.low
    '0x0', //                                max_fee.high
    '0x3e8', //                              min_finality_threshold (1000, Fast)
    '0x7', //                                destination_domain (Polygon)
  ],
} as const

describe('the eight felts match a crossing that landed', () => {
  it('splits a 20-byte EVM recipient across the u256 exactly as the real burn did', () => {
    const polygon = destinationFor('polygon')!
    const parsed = parseDestination(REAL.recipient, polygon)
    expect(parsed.state).toBe('ok')
    if (parsed.state !== 'ok') return

    const built = buyParamsCalldata({
      mintRecipient: parsed.mintRecipient,
      amount: REAL.amount,
      maxFeeWei: REAL.maxFee,
      minFinalityThreshold: FAST_FINALITY_THRESHOLD,
      destinationDomain: polygon.domain,
    })
    expect(built.state).toBe('ready')
    if (built.state !== 'ready') return

    expect(built.calldata).toEqual(REAL.calldata)
  })

  it('refuses a fee that is not smaller than the amount — the helper’s AMOUNT_LE_MAX_FEE', () => {
    const built = buyParamsCalldata({
      mintRecipient: BigInt(REAL.recipient),
      amount: REAL.maxFee,
      maxFeeWei: REAL.maxFee,
      minFinalityThreshold: FAST_FINALITY_THRESHOLD,
      destinationDomain: 7,
    })
    expect(built.state).toBe('refused')
  })

  it('says what lands, and says nothing when the fee swallows it', () => {
    expect(deliveredWei(REAL.amount, REAL.maxFee)).toBe(REAL.amount - REAL.maxFee)
    expect(deliveredWei(REAL.maxFee, REAL.maxFee)).toBeNull()
  })
})

// ── The destination ───────────────────────────────────────────────────────────────────────

describe('an address is checked against the chain it was typed for', () => {
  const base = destinationFor('base')!
  const solana = destinationFor('solana')!

  it('accepts a well-formed EVM address for an EVM chain', () => {
    const out = parseDestination('0xa89291d2fa60d5d02b711aa9108399963299979d', base)
    expect(out).toEqual({ state: 'ok', mintRecipient: BigInt(REAL.recipient) })
  })

  it('accepts a 32-byte base58 account for Solana', () => {
    // Circle's own Solana TokenMessengerMinter program id — a real 32-byte account address.
    const out = parseDestination('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3', solana)
    expect(out.state).toBe('ok')
    if (out.state !== 'ok') return
    // 32 bytes, so it must not fit in the low half alone.
    expect(out.mintRecipient >> 128n).toBeGreaterThan(0n)
  })

  //
  // THE FAILURE THIS SURFACE EXISTS TO FEAR. Both of these strings are perfectly valid addresses.
  // They are just addresses of the wrong kind, and a burn to one is not recoverable — so the
  // refusal names the mismatch rather than saying "invalid address".
  //
  it('refuses a Solana address on an EVM chain, and says which is which', () => {
    const out = parseDestination('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3', base)
    expect(out.state).toBe('refused')
    if (out.state !== 'refused') return
    expect(out.because).toContain('Solana address')
    expect(out.because).toContain('Base')
  })

  it('refuses an EVM address on Solana, and says which is which', () => {
    const out = parseDestination('0xa89291d2fa60d5d02b711aa9108399963299979d', solana)
    expect(out.state).toBe('refused')
    if (out.state !== 'refused') return
    expect(out.because).toContain('EVM address')
  })

  it('refuses the zero address rather than burning to it', () => {
    const out = parseDestination(`0x${'0'.repeat(40)}`, base)
    expect(out.state).toBe('refused')
  })

  it('names the unproven case rather than hiding it', () => {
    expect(destinationFor('solana')!.caveat).toBeTruthy()
    expect(destinationFor('base')!.caveat).toBeNull()
  })

  //
  // THE TRAP THIS MODULE WALKS STRAIGHT INTO. Six of the ten refused claims are bridge sentences —
  // "unlinkable", "fully anonymous", "no path back", "end-to-end encrypted", "timeout and reclaim",
  // "chain abstraction" — and every one of them is the phrase a bridge module reaches for while
  // trying to be helpful. The sweep covers comments too, because a comment is where the first
  // overclaim gets written and the second one gets copied from.
  //
  it('names no refused claim anywhere in the file, comments included', () => {
    const source = readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})

// ── The fee ───────────────────────────────────────────────────────────────────────────────

/** The shape Circle's endpoint actually returns for `?forward=true`, measured 2026-08-27. */
const IRIS_ROWS = [
  { finalityThreshold: 1000, minimumFee: 12, forwardFee: { low: 60794, med: 60873, high: 61456 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 60794, med: 60873, high: 61456 } },
]

describe('the fee is Circle’s, read live and never guessed', () => {
  it('asks the forwarding endpoint for the Starknet→destination route', () => {
    expect(feeQuoteUrl(7)).toBe(
      'https://iris-api.circle.com/v2/burn/USDC/fees/25/7?forward=true',
    )
  })

  it('adds the flat forwarding fee to the protocol bps, ceil-divided', async () => {
    const out = await fetchForwardFee({
      destinationDomain: 7,
      amount: 10_000_000n, // 10 USDC
      fetchJson: async () => IRIS_ROWS,
    })
    expect(out.state).toBe('quoted')
    if (out.state !== 'quoted') return

    // 12 bps of 10 USDC = 12000 base units, exactly.
    expect(out.fee.protocolFeeWei).toBe(12_000n)
    expect(out.fee.forwardFeeWei).toBe(60_873n)
    expect(out.fee.maxFeeWei).toBe(72_873n)
    expect(out.fee.finalityThreshold).toBe(FAST_FINALITY_THRESHOLD)
  })

  it('rounds the protocol fee UP, because Circle’s minimum is a floor', async () => {
    const out = await fetchForwardFee({
      destinationDomain: 7,
      amount: 1n,
      fetchJson: async () => IRIS_ROWS,
    })
    if (out.state !== 'quoted') throw new Error('expected a quote')
    // A floored quote here would be 0 and Iris would demote the transfer to Standard finality.
    expect(out.fee.protocolFeeWei).toBe(1n)
  })

  it('refuses rather than falling through to the other finality tier', async () => {
    const out = await fetchForwardFee({
      destinationDomain: 7,
      amount: 10_000_000n,
      fetchJson: async () => [IRIS_ROWS[1]],
    })
    expect(out.state).toBe('unavailable')
  })

  it('refuses a route with no forwarding fee — nobody would submit the mint', async () => {
    const out = await fetchForwardFee({
      destinationDomain: 7,
      amount: 10_000_000n,
      fetchJson: async () => [{ finalityThreshold: 1000, minimumFee: 12 }],
    })
    expect(out.state).toBe('unavailable')
  })

  it('never throws when the service is unreachable', async () => {
    const out = await fetchForwardFee({
      destinationDomain: 7,
      amount: 10_000_000n,
      fetchJson: async () => {
        throw new Error('offline')
      },
    })
    expect(out.state).toBe('unavailable')
  })
})

// ── The plan ──────────────────────────────────────────────────────────────────────────────

const SELF = '0x0123456789abcdef'
const AMOUNT = 5_000_000n

const leg = (over: Partial<BridgeLeg> = {}): BridgeLeg => ({
  helper: OUTBOUND_ANONYMIZER,
  destinationDomain: 6,
  mintRecipient: BigInt(REAL.recipient),
  maxFeeWei: 60_000n,
  minFinalityThreshold: FAST_FINALITY_THRESHOLD,
  chainName: 'Base',
  ...over,
})

const crossing = (over: Record<string, unknown> = {}) => ({
  kind: 'bridge' as const,
  recipient: OUTBOUND_ANONYMIZER,
  token: BRIDGE_USDC,
  symbol: 'USDC',
  amount: AMOUNT,
  mode: 'self' as const,
  bridge: leg(),
  ...over,
})

/** A wallet holding native USDC, its subchannel already open. */
function wallet(): SendWalletData {
  return {
    channels: [
      {
        address: SELF,
        publicKey: 0x77n,
        key: 0x88n,
        tokens: [{ token: BRIDGE_USDC, tokenIndex: 0, noteNonce: 3 }],
      },
    ],
    notes: [
      {
        id: 1n,
        token: BRIDGE_USDC,
        amount: 20_000_000n,
        witness: { channelKey: 0x55n, nonce: 0, r: 0x66n },
      },
    ],
  }
}

describe('a crossing plans the sandwich with no return leg', () => {
  it('spends, changes, withdraws to the helper and invokes it — and mints no open note', () => {
    const out = planSend(crossing(), wallet(), SELF, null)
    if (!out.ok) throw new Error(`plan refused: ${JSON.stringify(out.failure)}`)

    expect(out.plan.expectedActions.map((a) => a.variant)).toEqual([
      CLIENT_ACTION.UseNote,
      CLIENT_ACTION.CreateEncNote, // change, back to us
      CLIENT_ACTION.Withdraw, //     the USDC, handed to the helper
      CLIENT_ACTION.InvokeExternal, // …and the instruction to burn it
    ])
    // The absence IS the assertion: an open note declares that something comes back, and nothing
    // comes back from a burn.
    expect(out.plan.expectedActions.some((a) => a.variant === CLIENT_ACTION.CreateOpenNote)).toBe(
      false,
    )
  })

  it('withdraws EXACTLY what the burn asks for', () => {
    const out = planSend(crossing(), wallet(), SELF, null)
    if (!out.ok) throw new Error('plan refused')

    const withdraw = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.Withdraw)!
    const invoke = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)!

    // Nothing on chain reconciles these two numbers, and any excess left in the helper is burnable
    // by whoever calls it next. `fields[2]` is the withdraw amount; `fields[4]` is `amount.low`.
    expect(withdraw.fields[2]).toBe(AMOUNT)
    expect(invoke.fields[4]).toBe(AMOUNT)
    expect(withdraw.fields[0]).toBe(BigInt(OUTBOUND_ANONYMIZER))
    expect(invoke.fields[0]).toBe(BigInt(OUTBOUND_ANONYMIZER))
  })

  it('pins every calldata felt — there is no note id to leave open', () => {
    const out = planSend(crossing(), wallet(), SELF, null)
    if (!out.ok) throw new Error('plan refused')

    const invoke = out.plan.expectedActions.find((a) => a.variant === CLIENT_ACTION.InvokeExternal)!
    expect(invoke.fields).toHaveLength(10) // address + length + eight felts
    expect(invoke.fields.every((f) => f !== null)).toBe(true)
  })

  it('satisfies the pool’s own action-list invariants', () => {
    const out = planSend(crossing(), wallet(), SELF, null)
    if (!out.ok) throw new Error('plan refused')

    const actions = planToValidatableActions(out.plan)
    expect(() => assertActionListValid(actions)).not.toThrow()
    expect(() => assertBalancedActionList(actions)).not.toThrow()
  })
})

describe('the refusals that cost nothing', () => {
  const refusal = (over: Record<string, unknown>) => {
    const out = planSend(crossing(over), wallet(), SELF, null)
    expect(out.ok).toBe(false)
    return out.ok ? '' : (out.failure as { reason: string }).reason
  }

  it('refuses the bridged USDC.e — the helper can only burn Circle’s native issuance', () => {
    const usdce = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'
    expect(refusal({ token: usdce, symbol: 'USDC.e' })).toContain(BRIDGE_USDC)
  })

  it('refuses a withdraw and an invoke that name different contracts', () => {
    expect(refusal({ recipient: '0x1234' })).toContain('same contract')
  })

  it('refuses a fee that leaves nothing to arrive', () => {
    expect(refusal({ bridge: leg({ maxFeeWei: AMOUNT }) })).toContain('nothing')
  })

  it('refuses a finality tier the fee was not quoted for', () => {
    expect(refusal({ bridge: leg({ minFinalityThreshold: 2000 }) })).toContain('2000')
  })

  it('refuses a destination domain nobody here has checked', () => {
    expect(refusal({ bridge: leg({ destinationDomain: 9 }) })).toContain('9')
  })

  it('refuses a bridge leg riding on any other kind', () => {
    const out = planSend(
      { ...crossing(), kind: 'withdraw' as const },
      wallet(),
      SELF,
      null,
    )
    expect(out.ok).toBe(false)
  })

  it('refuses a crossing with no leg at all', () => {
    const out = planSend(
      { ...crossing(), bridge: undefined },
      wallet(),
      SELF,
      null,
    )
    expect(out.ok).toBe(false)
  })
})
