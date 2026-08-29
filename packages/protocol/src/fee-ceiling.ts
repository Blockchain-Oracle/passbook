//
// How much STRK a submission may approve the pool to pull.
//
// THIS LIVES IN `protocol` SO THERE IS EXACTLY ONE FORMULA. Two sides depend on it and
// they must not drift: the client BUILDS the approve with headroom (`register.ts`), and
// the relayer REFUSES one above the ceiling (`allowlist.ts`, which re-exports all three
// of these). If the client approved more than the server tolerates, our own gate would
// refuse every real submission; if it approved exactly the fee, a fee raise between the
// build and the submit would revert a transaction we had already paid gas for.
//
// Moved here verbatim from allowlist.ts, reasoning intact — it was derived there.
//

/**
 * How much more than one fee an approve may authorise. This multiple IS the blast
 * radius, so it is derived rather than picked — do not widen it without redoing this:
 *
 *   - What is actually needed is 1x. `collect_fee` pulls exactly one fee per submission.
 *   - Headroom exists for one reason only: the pool's fee is mutable with ZERO upgrade
 *     delay, so it can change between our read and the execution.
 *   - It is sized against precedent, not imagination. The largest fee change in this
 *     pool's history is 4 -> 6 STRK, or 1.5x. Two covers a repeat of the worst observed
 *     jump, with margin, and nothing beyond it.
 *   - The failure directions are asymmetric, which is what settles the number. Too
 *     tight and the transaction reverts, costing gas. Too loose and a funded wallet
 *     carries standing spend authority. Bias toward the revert.
 *
 * What makes this a ceiling rather than a per-request rate limit: ERC-20 `approve`
 * SETS the allowance, it does not add to it. Separate requests therefore overwrite one
 * another and cannot accumulate.
 *
 * That is true ACROSS requests and false WITHIN one, which is the distinction an earlier
 * version of this comment blurred — and blurring it is what hid a real bug. A single
 * batch of `[approve, apply_actions, approve, apply_actions, …]` re-sets the allowance
 * between pulls, so N approves in one signed transaction cost N times the fee no matter
 * what this multiple says. `assertSubmittable` therefore refuses any batch carrying more
 * than one approve, and that rule is what makes this number mean what it claims.
 */
export const APPROVE_FEE_MULTIPLE = 2n

/**
 * A hard ceiling that depends on nobody else's number.
 *
 * `APPROVE_FEE_MULTIPLE` bounds us to twice the LIVE fee — but `get_fee_amount()` is set
 * by a pool admin outside this repository, at zero upgrade delay. That is the same
 * mutability the multiple exists to absorb, so on its own the bound reads "twice whatever
 * a third party currently says", which is not a bound at all.
 *
 * 20 STRK, derived — and the first reason is the one most likely to be forgotten by
 * someone later wondering why it is not higher:
 *
 *   - A CAP ONLY MEANS ANYTHING IF IT SITS BELOW THE FUNDED BALANCE. This wallet holds
 *     roughly what the gate work needs — about three fees plus gas, so on the order of
 *     30 STRK. A cap above that can never bind before the balance does, which makes it
 *     decorative. 20 binds first. That is the entire point of having it.
 *   - It is still far above anything observed. The only measured fee is 6 STRK and the
 *     only other known historical value is 4, so the largest real change is 1.5x.
 *     20 permits a 3.3x rise over the measured fee before it binds.
 *   - Above that, refusing loudly beats paying. A fee that high is a protocol event a
 *     human should look at, not something to auto-approve.
 *
 * The effective ceiling is the LOWER of this and the fee-derived bound, so once the fee
 * passes 10 STRK our exposure stops tracking it and reverts begin instead — the correct
 * direction to fail when the number is not ours to trust.
 *
 * If the relayer is ever funded with materially more, revisit this: the first bullet
 * stops holding, and the cap quietly becomes decoration again.
 */
export const ABSOLUTE_MAX_APPROVE_WEI = 20_000_000_000_000_000_000n

/** The effective ceiling: whichever of the two bounds binds first. */
export function approveCeiling(liveFeeWei: bigint): bigint {
  const derived = liveFeeWei * APPROVE_FEE_MULTIPLE
  return derived < ABSOLUTE_MAX_APPROVE_WEI ? derived : ABSOLUTE_MAX_APPROVE_WEI
}

/** Bigints, not hex strings: `ResourceBoundsBN` is what `execute` consumes; hex throws before signing. */
export interface ResourceBounds {
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint }
}

/** The latest block's prices, in fri. Read live — a bound priced under the block is refused. */
export interface GasPrices {
  l1GasFri: bigint
  l2GasFri: bigint
  l1DataGasFri: bigint
}

/**
 * Units a proven pool transaction may consume. Measured, not guessed: recent mainnet pool proofs
 * used 81–101M l2 gas, 0 l1 gas and ≤ 1.9k l1 data gas (receipts, 2026-08-29); l2 keeps ~20 %.
 */
export const GAS_UNITS = { l2_gas: 120_000_000n, l1_gas: 5_000n, l1_data_gas: 30_000n } as const

/** Price headroom over the block: the L2 price moved < 2 % across the blocks read; a refused bound costs nothing. */
export const GAS_PRICE_HEADROOM_PERCENT = 25n

/** Fee estimation cannot see a proof, so the bounds are built here: measured units × the live price plus headroom. */
export function resourceBoundsFor(prices: GasPrices): ResourceBounds {
  const price = (fri: bigint) => (fri * (100n + GAS_PRICE_HEADROOM_PERCENT)) / 100n
  return {
    l2_gas: { max_amount: GAS_UNITS.l2_gas, max_price_per_unit: price(prices.l2GasFri) },
    l1_gas: { max_amount: GAS_UNITS.l1_gas, max_price_per_unit: price(prices.l1GasFri) },
    l1_data_gas: { max_amount: GAS_UNITS.l1_data_gas, max_price_per_unit: price(prices.l1DataGasFri) },
  }
}

/** The STRK a sender must HOLD for the bounds to be accepted by the mempool; only what is used is charged. */
export function gasBoundWei(bounds: ResourceBounds): bigint {
  return (
    bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit +
    bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit +
    bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
  )
}

/**
 * What public STRK a self-paid pool write must hold: one live fee plus the live gas bound. The
 * approve ceiling above is allowance, not balance — a fee jump between read and execution
 * reverts rather than demanding a second fee parked forever.
 */
export function feeFloor(liveFeeWei: bigint, prices: GasPrices): bigint {
  return liveFeeWei + gasBoundWei(resourceBoundsFor(prices))
}
