//
// The sponsor's outbound helper: its pinned addresses, and the eight felts `privacy_invoke` takes.
//
// `starknet_getClassAt` against mainnet on 2026-08-27:
//
//     privacy_invoke(params: BuyParams) -> Span<OpenNoteDeposit>
//     BuyParams { mint_recipient: u256, amount: u256, max_fee: u256,
//                 min_finality_threshold: u32, destination_domain: u32 }
//
// A struct passed by value serialises flat and a `u256` is two felts, so the calldata is exactly
// eight felts in that order. It returns an EMPTY span — nothing comes back into the pool, which is
// why a crossing mints no open note where a swap does. `bridge.test.ts` pins the layout against
// mainnet tx `0x68690c68…db5`.
//
// Browser-safe: `BigInt` only, no `starknet` import — a surface imports this eagerly.
//

/**
 * The sponsor's live outbound helper. 165 lines of Cairo, zero storage beyond three
 * constructor-baked addresses, and exactly three revert paths: `CALLER_NOT_POOL`, `ZERO_AMOUNT`,
 * `AMOUNT_LE_MAX_FEE`. No owner and no upgrade path — nothing here can be revoked mid-flight.
 */
export const OUTBOUND_ANONYMIZER =
  '0x009067f35d2cab3cb933f3d78793660402026f8fa31e041ca2cab4a8e9a49092'

/**
 * The ONE token this helper can burn — and it is NOT the USDC most Starknet apps mean.
 *
 * AVNU's list carries two: `USDC` at `0x033068f6…` (Circle's native issuance) and `USDC.e` at
 * `0x053c9125…` (the StarkGate one). Only the native one is minted by the TokenMessengerMinter
 * that CCTP burns through, and the helper has it baked in — the caller cannot pass a token.
 * Pinned rather than resolved from the token list, because "whichever entry is called USDC" is
 * precisely the lookup that picks the wrong one. Read from mainnet tx `0x68690c68…db5`.
 */
export const BRIDGE_USDC =
  '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'

/** Confirmed against the contract's own `decimals()`, not read off a list. */
export const BRIDGE_USDC_DECIMALS = 6

export const BRIDGE_USDC_SYMBOL = 'USDC'

/**
 * CCTP Fast: soft finality, seconds rather than minutes, and a protocol fee in basis points.
 * Standard (2000) quotes 0 bps and takes ~13-19 minutes; Fast is what StarkWare's own deployment
 * declares on every one of its live burns.
 */
export const FAST_FINALITY_THRESHOLD = 1000

/** Starknet's own CCTP domain. The source half of every fee quote. */
export const STARKNET_CCTP_DOMAIN = 25

// ── The eight felts ───────────────────────────────────────────────────────────────────────

export type BuyParamsResult =
  | { readonly state: 'ready'; readonly calldata: readonly string[] }
  | { readonly state: 'refused'; readonly because: string }

const U128_MAX = (1n << 128n) - 1n
const U32_MAX = 0xffffffffn

/** A felt as the chain wants it: `0x`-prefixed lowercase hex. */
const felt = (value: bigint) => `0x${value.toString(16)}`

/**
 * Serialise `BuyParams` for `privacy_invoke`.
 *
 * Every felt is bounds-checked: a value that overflows its `u128` half or `u32` does not fail at
 * the boundary — it becomes a DIFFERENT number, and every number here is money or where it lands.
 * Refuses rather than throws, because a person is standing on the surface that calls this.
 */
export function buyParamsCalldata(input: {
  mintRecipient: bigint
  amount: bigint
  maxFeeWei: bigint
  minFinalityThreshold: number
  destinationDomain: number
}): BuyParamsResult {
  const refused = (because: string): BuyParamsResult => ({ state: 'refused', because })

  const { mintRecipient, amount, maxFeeWei } = input
  if (mintRecipient <= 0n || mintRecipient > (1n << 256n) - 1n) {
    return refused('The destination address is not a value CCTP can mint to.')
  }
  if (amount <= 0n || amount > U128_MAX) {
    // The helper's own `ZERO_AMOUNT`, and the top half of a u256 the pool's `u128` balances could
    // never have held anyway.
    return refused('The amount is not a value this bridge can burn.')
  }
  if (maxFeeWei < 0n || maxFeeWei >= amount) {
    // `AMOUNT_LE_MAX_FEE`, spelled as the thing a person can act on.
    return refused('The fee is not smaller than the amount, so nothing would arrive.')
  }

  const finality = BigInt(input.minFinalityThreshold)
  const domain = BigInt(input.destinationDomain)
  if (finality <= 0n || finality > U32_MAX) return refused('The finality tier is out of range.')
  if (domain < 0n || domain > U32_MAX) return refused('The destination chain is out of range.')

  return {
    state: 'ready',
    calldata: [
      felt(mintRecipient & U128_MAX),
      felt(mintRecipient >> 128n),
      felt(amount),
      felt(0n),
      felt(maxFeeWei),
      felt(0n),
      felt(finality),
      felt(domain),
    ],
  }
}
