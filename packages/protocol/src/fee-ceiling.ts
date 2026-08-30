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
 * THE FALLBACK units a proven pool transaction may consume, when nothing better is available.
 *
 * Measured rather than guessed — recent mainnet pool proofs used 81–101M l2 gas, 0 l1 gas and
 * ≤ 1.9k l1 data gas (receipts, 2026-08-29) — but measured ONCE, in this file, on a day that is
 * already in the past. It over-provisions l2 by ~40 % against the ~85M a pool transaction actually
 * burns, and that inflation is not free: it is what lifts `feeFloor` to ~11.7 STRK and refuses
 * accounts holding 10 for a transaction that would have cost 8.9 and succeeded.
 *
 * So it is the FLOOR OF LAST RESORT, not the normal path. `resourceBoundsFor` takes measured units
 * when the caller has them; this is what it falls back to when nobody could measure.
 */
export const GAS_UNITS = { l2_gas: 120_000_000n, l1_gas: 5_000n, l1_data_gas: 30_000n } as const

/** Price headroom over the block: the L2 price moved < 2 % across the blocks read; a refused bound costs nothing. */
export const GAS_PRICE_HEADROOM_PERCENT = 25n

/**
 * Headroom over MEASURED units. Wider than the price headroom because it absorbs a different risk:
 * a proof that compiles a few more actions than the one we measured, not a price that moved.
 */
export const GAS_UNITS_HEADROOM_PERCENT = 30n

/** Units a proven transaction is expected to burn, from wherever we could actually observe them. */
export interface MeasuredGas {
  l2Gas: bigint
  l1Gas: bigint
  l1DataGas: bigint
}

/**
 * The bounds a proven pool transaction is submitted with.
 *
 * Fee estimation traditionally could not see a proof — so these were built by hand from a constant.
 * `measured` is the way out of that: units observed from a live estimate that DID carry the proof,
 * or calibrated from recent receipts. Given them, the bound tracks what the pool currently costs
 * instead of what it cost the day somebody wrote the constant down.
 *
 * A measured value is never trusted BELOW the observed floor it came from: `max` against the
 * constant is deliberate on the l1 lanes, where the measured numbers are small and noisy and the
 * constant is already tiny — there is nothing to win by shaving them and a refused bound costs a
 * whole transaction. The l2 lane is where the money is, so that one follows the measurement down.
 */
export function resourceBoundsFor(prices: GasPrices, measured?: MeasuredGas): ResourceBounds {
  const price = (fri: bigint) => (fri * (100n + GAS_PRICE_HEADROOM_PERCENT)) / 100n
  const pad = (units: bigint) => (units * (100n + GAS_UNITS_HEADROOM_PERCENT)) / 100n
  const l2 = measured ? pad(measured.l2Gas) : GAS_UNITS.l2_gas
  const l1 = measured ? bigger(pad(measured.l1Gas), GAS_UNITS.l1_gas) : GAS_UNITS.l1_gas
  const l1d = measured ? bigger(pad(measured.l1DataGas), GAS_UNITS.l1_data_gas) : GAS_UNITS.l1_data_gas
  return {
    l2_gas: { max_amount: l2, max_price_per_unit: price(prices.l2GasFri) },
    l1_gas: { max_amount: l1, max_price_per_unit: price(prices.l1GasFri) },
    l1_data_gas: { max_amount: l1d, max_price_per_unit: price(prices.l1DataGasFri) },
  }
}

const bigger = (a: bigint, b: bigint) => (a > b ? a : b)

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
export function feeFloor(liveFeeWei: bigint, prices: GasPrices, measured?: MeasuredGas): bigint {
  return liveFeeWei + gasBoundWei(resourceBoundsFor(prices, measured))
}

// ── What a balance can actually do, in three bands ────────────────────────────────────────

/**
 * `clear` — above the bound, nothing to say. `tight` — above what the transaction is expected to
 * cost but below the padded bound, so it will probably work and might not. `short` — it cannot.
 */
export type FundingBand = 'clear' | 'tight' | 'short'

/**
 * Which band a public STRK balance falls in for one proven pool write.
 *
 * ── THE MIDDLE BAND IS THE POINT, AND IT USED TO BE A REFUSAL ─────────────────────────────
 *
 * The old test was a single boolean against `feeFloor`, and `feeFloor` is a deliberate CEILING —
 * padded units at a padded price. A balance between the expected cost and that ceiling was refused
 * outright, which is a refusal of transactions that would have succeeded. Roughly half of them: the
 * pad is 30 % on units and 25 % on price, and the fee itself is exact.
 *
 * So the bands are drawn where the facts change, not where the caution does:
 *   - below one fee, nothing can happen — `collect_fee` cannot even be collected.
 *   - above fee + EXPECTED gas, the transaction is affordable at today's prices.
 *   - above fee + the BOUND, it is affordable at the worst price the bound admits.
 *
 * Only the middle one is a judgement call, and it belongs to the user: warn, name the numbers, and
 * let them decide. `expected` comes from the measured units where we have them; without a
 * measurement the middle band is narrower, which is the honest consequence of knowing less.
 */
export function fundingBand(
  balanceWei: bigint,
  liveFeeWei: bigint,
  prices: GasPrices,
  measured?: MeasuredGas,
): FundingBand {
  if (balanceWei < liveFeeWei) return 'short'
  if (balanceWei >= feeFloor(liveFeeWei, prices, measured)) return 'clear'
  return balanceWei >= liveFeeWei + expectedGasWei(prices, measured) ? 'tight' : 'short'
}

/** What the gas is expected to cost at today's prices — the measurement, unpadded. */
export function expectedGasWei(prices: GasPrices, measured?: MeasuredGas): bigint {
  const units = measured ?? { l2Gas: 85_000_000n, l1Gas: 0n, l1DataGas: 2_000n }
  return units.l2Gas * prices.l2GasFri + units.l1Gas * prices.l1GasFri + units.l1DataGas * prices.l1DataGasFri
}
