//
// The six felts our Vesu helper's `privacy_invoke` declares, and every refusal that can be decided
// before one is written.
//
// ── THE ONE LINE THAT COST SOMEBODY MONEY ─────────────────────────────────────────────────
//
// `amount` means two different things depending on `operation`, and getting it wrong is not a
// rounding error. On `Supply` it is UNDERLYING (USDC, 6 decimals). On `Redeem` it is an exact
// SHARE COUNT (vToken, 18 decimals). The published `PRIVACY-0.14.3-RC.0` helper called Vesu's
// `withdraw(assets)` on exit; the corrected source calls `redeem(shares)`, and the SDK README
// STILL shows an exit passing an underlying amount two lines after discovering a share balance.
// Those numbers differ by roughly the share price times 1e12.
//
// No arithmetic here can tell the two apart — 50000000 is a plausible amount of either — so this
// module does not try to guess. What it does instead is make the pairing structural: `direction`
// alone decides which token is spent and which is received (`earnTokens`), so a caller cannot
// assemble a redeem that spends USDC even by accident. The check that the amount matches the token
// happens where it can be real: `send-earn.ts` refuses a request whose `token` is not the one the
// direction spends, and the balance test upstream then weighs it against the right notes.
// See `contracts/src/vesu_earn.cairo`.
//
// Layout, from the contract's own signature — `privacy_invoke(operation, in_token, out_token,
// amount: u256, note_id: felt252)`:
//
//   [operation, in_token, out_token, amount_lo, amount_hi, note_id]
//
// `operation` is a Cairo enum and serialises as its variant index: Supply 0, Redeem 1.
//

import type { EarnMarketDefinition } from './earn-markets.js'

/** Matches `EarnOperation` in the contract. The numbers are the wire format, not a convention. */
export const EARN_OPERATION = { supply: 0, redeem: 1 } as const

export type EarnDirection = keyof typeof EARN_OPERATION

/** `[operation, in_token, out_token, amount_lo, amount_hi, note_id]`. The helper's own arity. */
export const EARN_CALLDATA_FELTS = 6

/** Refuse-don't-throw, like `swap-calldata.ts`: a bad plan is a sentence, not an exception. */
export type EarnCalldata =
  | { readonly state: 'ready'; readonly calldata: readonly string[] }
  | { readonly state: 'refused'; readonly because: string }

export interface EarnCalldataInput {
  readonly direction: EarnDirection
  readonly market: EarnMarketDefinition
  /** Underlying on a supply; an exact share count on a redeem. */
  readonly amount: bigint
  /** The open note the helper deposits its output into. */
  readonly openNoteId: bigint
}

const felt = (value: bigint | string | number): string => `0x${BigInt(value).toString(16)}`

const U128 = (1n << 128n) - 1n

/**
 * The pair of tokens for a direction: what leaves this contract for the vault, and what comes back.
 *
 * Naming them here rather than at the call site is deliberate — the two directions are mirror
 * images, and a surface that assembled the pair itself would eventually assemble it backwards.
 */
export function earnTokens(input: { direction: EarnDirection; market: EarnMarketDefinition }): { inToken: string; outToken: string } {
  const { direction, market } = input
  return direction === 'supply'
    ? { inToken: market.underlying, outToken: market.vToken }
    : { inToken: market.vToken, outToken: market.underlying }
}

export function earnInvokeCalldata(input: EarnCalldataInput): EarnCalldata {
  const { direction, market, amount, openNoteId } = input
  if (amount <= 0n) return { state: 'refused', because: `refusing to ${direction} ${amount}: an amount must be positive` }
  if (amount > U128) {
    // The helper narrows the RECEIVED amount to `u128` for the open-note deposit, so a figure this
    // large could not be handed back even if the vault accepted it.
    return { state: 'refused', because: `refusing to ${direction} ${amount}: it does not fit the amount the pool can credit` }
  }
  if (openNoteId <= 0n) return { state: 'refused', because: 'the open note has no id, so the helper would have nowhere to deposit' }

  const { inToken, outToken } = earnTokens({ direction, market })
  let a: bigint
  let b: bigint
  try {
    a = BigInt(inToken)
    b = BigInt(outToken)
  } catch {
    return { state: 'refused', because: 'this market names a token that is not a felt address' }
  }
  if (a === 0n || b === 0n) return { state: 'refused', because: 'this market names the zero address as a token' }
  // The contract asserts this too, but the assert costs the pool fee and this costs nothing.
  if (a === b) return { state: 'refused', because: 'the input and output tokens are the same, which is not a lending operation' }

  return {
    state: 'ready',
    calldata: [
      felt(EARN_OPERATION[direction]),
      felt(inToken),
      felt(outToken),
      felt(amount & U128),
      felt(amount >> 128n),
      felt(openNoteId),
    ],
  }
}
