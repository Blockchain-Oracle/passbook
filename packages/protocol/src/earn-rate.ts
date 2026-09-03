//
// The Earn arithmetic, with no I/O in it. Every input arrives as a `bigint` read from a contract;
// every output is either an exact `bigint` or a `number` that is explicitly an estimate.
//
// ── WHY THE RATE IS COMPUTED HERE RATHER THAN READ FROM A FEED ────────────────────────────
//
// `api.vesu.xyz/pools` answers 200 and returns identity for all twenty V2 pools — and `stats`,
// `usdPrice` and `risk` are `null` on every single one of them. That is not an outage to wait out.
// So the supply rate is derived from the market's own contract, which publishes the three numbers
// it is made of: the borrow rate per second, the utilization, and the curator's fee share.
//
// Checked against the dated snapshot in the research package on 2026-09-03: Re7 USDC Core 5.12%
// here against 5.13% there, Clearstar 4.42% against 4.68%, and the same ordering across all seven.
//
// ── AND WHY THE DECIMALS ARE A NAMED HAZARD ───────────────────────────────────────────────
//
// A vToken share is 18-decimal and USDC is 6-decimal, so a share count and an asset amount differ
// by about 1e12 before either is a price. Mixing them does not produce a slightly wrong number, it
// produces a number a million times wrong — which is the same family of mistake as the upstream
// `withdraw(assets)` / `redeem(shares)` bug this whole surface was built around. Nothing in this
// file converts between them by scaling; conversion is a CONTRACT READ (`convert_to_assets`),
// because the ratio is the market's share price and only the market knows it.
//

/** Vesu scales its rates and ratios by 1e18. Its own `SCALE`, not a guess. */
export const VESU_SCALE = 10n ** 18n

/**
 * Vesu's year, for turning a per-second rate into an annual one.
 *
 * 360 days, not 365: it is the convention the protocol's own interest-rate model uses, and a
 * figure quoted next to theirs has to be computed the way theirs is or the two disagree for no
 * reason a reader could discover.
 */
export const SECONDS_PER_YEAR = 360n * 86_400n

/** What one market's contract publishes about its rate, exactly as read. */
export interface EarnRateInputs {
  /** `interest_rate(...)` — the BORROW rate, per second, scaled by 1e18. */
  readonly borrowRatePerSecond: bigint
  /** `utilization(asset)` — the fraction borrowed, scaled by 1e18. */
  readonly utilization: bigint
  /** `asset_config.fee_rate` — the curator's cut of interest, scaled by 1e18. */
  readonly feeRate: bigint
}

/**
 * The supply rate a lender actually earns: borrowers pay the borrow rate on the borrowed
 * fraction, and the curator keeps `fee_rate` of it.
 *
 * Returned as a plain fraction (0.0512 is 5.12%) because every consumer formats it, and as an
 * APR — simple, not compounded. `supplyApy` compounds it. Both are estimates about the future
 * built from one instant's reading, and the UI must say so.
 */
export function supplyApr(inputs: EarnRateInputs): number {
  const { borrowRatePerSecond, utilization, feeRate } = inputs
  if (borrowRatePerSecond <= 0n || utilization <= 0n) return 0
  const borrowApr = Number(borrowRatePerSecond * SECONDS_PER_YEAR) / Number(VESU_SCALE)
  const used = Number(utilization) / Number(VESU_SCALE)
  const kept = 1 - Number(feeRate) / Number(VESU_SCALE)
  const apr = borrowApr * used * kept
  return Number.isFinite(apr) && apr > 0 ? apr : 0
}

/** Continuously compounded, which is how a rate accruing every second actually behaves. */
export function supplyApy(inputs: EarnRateInputs): number {
  const apr = supplyApr(inputs)
  return apr === 0 ? 0 : Math.expm1(apr)
}

/** `utilization` as a plain fraction. Its own function because the meter needs it without a rate. */
export function utilizationOf(utilization: bigint): number {
  const used = Number(utilization) / Number(VESU_SCALE)
  return Number.isFinite(used) && used > 0 ? used : 0
}

// ── Fees, and whether a deposit is worth making ───────────────────────────────────────────

export interface BreakEvenInputs {
  /** What is being supplied, in the underlying's own smallest unit. */
  readonly principalWei: bigint
  readonly underlyingDecimals: number
  /** The live pool fee, in STRK wei. Read at call time — never a constant. */
  readonly poolFeeWei: bigint
  /** STRK in the underlying's currency. `null` when the oracle did not answer. */
  readonly strkPrice: number | null
  /** The current supply rate, as a fraction. */
  readonly apy: number
  /**
   * How many pool fees this measures. Two by default, and that default is the honest one: a
   * position you cannot afford to leave is not an investment, so the round trip is the cost.
   */
  readonly legs?: number
}

export type BreakEven =
  /** Enough is known to say it. `days` may be large; that is a finding, not an error. */
  | { readonly state: 'known'; readonly days: number; readonly feeInUnderlying: number }
  /** A required input was missing. The UI renders `—` and says which. */
  | { readonly state: 'unknown'; readonly because: string }

/**
 * How long at the current rate before the yield covers what it cost to get in and out.
 *
 * ── WHY THIS IS ON THE SCREEN AT ALL ──────────────────────────────────────────────────────
 *
 * At a 6 STRK pool fee, a round trip costs the same whether the deposit is $10 or $10,000. On the
 * small one that is months of yield and on the large one it is hours. A surface that shows an APY
 * and hides that has told the user the flattering half of the arithmetic. It is not a warning
 * copy-deck either — the number falls out of figures already being read for the review.
 */
export function breakEven(inputs: BreakEvenInputs): BreakEven {
  const { principalWei, underlyingDecimals, poolFeeWei, strkPrice, apy, legs = 2 } = inputs
  if (strkPrice === null) return { state: 'unknown', because: 'the STRK price could not be read' }
  if (apy <= 0) return { state: 'unknown', because: 'this market is paying nothing right now' }
  if (principalWei <= 0n) return { state: 'unknown', because: 'no amount has been entered yet' }

  const principal = Number(principalWei) / 10 ** underlyingDecimals
  const feeInUnderlying = (Number(poolFeeWei) / 1e18) * strkPrice * legs
  if (!Number.isFinite(principal) || !Number.isFinite(feeInUnderlying) || principal <= 0) {
    return { state: 'unknown', because: 'the amounts are outside the range this can measure' }
  }
  const perDay = (principal * apy) / 365
  if (perDay <= 0) return { state: 'unknown', because: 'this market is paying nothing right now' }
  return { state: 'known', days: feeInUnderlying / perDay, feeInUnderlying }
}

/** Gross yield over `days` at the current rate, in the underlying. An estimate, always. */
export function projectedYield(principalWei: bigint, underlyingDecimals: number, apy: number, days: number): number | null {
  if (apy <= 0 || principalWei <= 0n) return null
  const principal = Number(principalWei) / 10 ** underlyingDecimals
  const out = (principal * apy * days) / 365
  return Number.isFinite(out) ? out : null
}

// ── Redeemable, which is not the same as held ─────────────────────────────────────────────

export type RedeemableLimit = 'available' | 'liquidity-limited' | 'paused' | 'empty'

export interface RedeemableInputs {
  /** What the position is worth, in the underlying, from `convert_to_assets`. */
  readonly valueWei: bigint
  /** `asset_config.reserve` — the underlying sitting in the market, unborrowed. */
  readonly reserveWei: bigint
  readonly paused: boolean
}

export interface Redeemable {
  /** The most that could come out right now, in the underlying. */
  readonly wei: bigint
  readonly limit: RedeemableLimit
}

/**
 * How much of a position could actually be taken out at this moment.
 *
 * A lending market lends its deposits out, so "your position is worth X" and "you can withdraw X
 * today" are different sentences, and a high rate is often exactly the market where they differ
 * most — utilization near the cap is what pays well and what makes exiting hard. So this returns
 * a bound and a REASON, and the surface shows both numbers rather than the flattering one.
 */
export function redeemable(inputs: RedeemableInputs): Redeemable {
  const { valueWei, reserveWei, paused } = inputs
  if (paused) return { wei: 0n, limit: 'paused' }
  if (valueWei <= 0n) return { wei: 0n, limit: 'empty' }
  if (reserveWei < valueWei) return { wei: reserveWei, limit: 'liquidity-limited' }
  return { wei: valueWei, limit: 'available' }
}

// ── Average-cost basis ────────────────────────────────────────────────────────────────────

/** One classified Earn leg, in the order the chain produced it. */
export interface EarnFlow {
  readonly direction: 'supply' | 'redeem'
  /** Underlying in on a supply, underlying out on a redeem. */
  readonly assetsWei: bigint
  /** Shares out on a supply, shares burned on a redeem. */
  readonly sharesWei: bigint
}

export interface CostBasis {
  /** Shares still held, from the flows alone. Compare with the note walk before trusting it. */
  readonly sharesWei: bigint
  /** What those shares cost, in the underlying. */
  readonly basisWei: bigint
  /** Realized gain or loss across every redeem so far. Can be negative. */
  readonly realizedWei: bigint
}

/**
 * Average cost, which is the only method that survives incomplete evidence gracefully.
 *
 * The alternative — matching each redeem to a particular deposit — needs the whole history to be
 * correct, and this history is paginated over a public event stream that can legitimately stop
 * short. Average cost degrades to "we know less than we thought", not to a wrong lot.
 *
 * The caller must not hand this a partial history and render the result as fact:
 * `basisWei` is only meaningful when every flow was found. `earn-history.ts` carries that flag,
 * and the surface renders `—` rather than a number when it is false.
 */
export function costBasis(flows: readonly EarnFlow[]): CostBasis {
  let shares = 0n
  let basis = 0n
  let realized = 0n
  for (const flow of flows) {
    if (flow.direction === 'supply') {
      shares += flow.sharesWei
      basis += flow.assetsWei
      continue
    }
    if (flow.sharesWei <= 0n || shares <= 0n) continue
    // Proportional, in integers, and never more than what is held: a redeem larger than the
    // recorded position means a deposit went unseen, and taking the whole basis is the reading
    // that cannot go negative.
    const burned = flow.sharesWei > shares ? shares : flow.sharesWei
    const removed = (basis * burned) / shares
    realized += flow.assetsWei - removed
    basis -= removed
    shares -= burned
  }
  return { sharesWei: shares, basisWei: basis, realizedWei: realized }
}

/** Value now minus what is still on the books. `null` when the basis is not trustworthy. */
export function unrealized(valueWei: bigint, basis: CostBasis | null): bigint | null {
  return basis === null ? null : valueWei - basis.basisWei
}
