//
// The starter drip (Abu's ruling 2026-08-28) — a small amount of REAL STRK, on mainnet, from the
// relayer's own wallet.
//
// ── WHY THIS IS NOT AN ALLOWLIST ENTRY, WHICH IS THE FIRST THING SOMEBODY WILL TRY ────────
//
// The obvious implementation is to permit `STRK.transfer` in `allowlist.ts` and let the client
// build the call. It is also a total loss: that file's own header says every entry is "spending
// authority granted to the network", and a permitted transfer means anyone who can reach the port
// can move the relayer's entire balance to an address they chose, in one request, with the
// relayer signing it. There is no bound to add that fixes this — an amount cap still permits an
// unbounded NUMBER of transfers.
//
// So the drip is a dedicated route with a dedicated policy, and the split is precise: the client
// supplies ONE value, the destination address, and this module supplies everything else. The
// amount is a constant here. The entrypoint is a constant here. The token is a constant here. A
// request body cannot influence any of them, so the worst a hostile caller achieves is a drip to
// an address of their choosing, metered by the counters below.
//
// ── MAINNET MEANS THIS IS MONEY, AND THE CAPS ARE THE ONLY THING BETWEEN IT AND ZERO ──────
//
// `ACTIVE_NETWORK` is `mainnet`, so there is no faucet to proxy and nothing is free. Three
// independent limits, and they fail in different directions on purpose:
//
//   1. ONCE PER ADDRESS, EVER. Burned through the ledger's atomic `tryClaim`. This is the limit
//      that makes the feature honest — a starter amount is for starting, and a second one is a
//      withdrawal.
//   2. Per visitor per day, keyed on the hashed client IP like every other gate here.
//   3. A global daily budget, which is the solvency floor and is never waived.
//
// Addresses are free to mint, so (1) alone stops nothing and (2) is rotatable behind a proxy pool.
// (3) is the one that actually bounds the loss, and it is why the daily number is set in STRK
// rather than in requests: what an operator needs to reason about is how much of their wallet a
// bad day can cost.
//
// ── DRIP FIRST, AND IT STAKES THE WHOLE JOURNEY — THE ONE-SUBSIDY RULE ────────────────────
//
// M8's ruling, verbatim intent: "if we're already giving them money, we cannot then see the
// relayer sponsoring their transaction again." So the drip is the ONLY subsidy, it fires FIRST
// (a plain transfer lands on a counterfactual address), and it is sized to pay for everything
// that follows: the account deploys itself from it, registration runs SELF-PAID (`collect_fee`
// pulls from whoever submits — the user, now holding the drip), and what remains is the starter.
// Sponsored registration demotes to the fallback for when this faucet is off or dry — never a
// locked door, never a second subsidy on top of a drip.
//
// The daily cap is therefore the whole acquisition budget: cap ÷ drip = new users a day.
//
import type { Call } from 'starknet'

import { STRK_TOKEN } from '../../protocol/src/constants.js'
import { asAddress, toFeltHex } from '../../protocol/src/address.js'

/**
 * What a new account is given, in wei — 10 STRK by default, `RELAYER_FAUCET_DRIP_WEI` to retune
 * without a release (the exact number is the operator's call at flip-on).
 *
 * SIZED TO THE JOURNEY, NOT TO A TASTE OF IT: account-deploy gas (~0.5) + the pool's 6 STRK
 * registration fee + approve headroom + a couple of STRK of starter. The old 1 STRK drip left a
 * cold visitor exactly one screen short — funded enough to exist, too poor to register.
 */
export const DRIP_WEI = 10_000_000_000_000_000_000n

/** The refusal a spent per-address claim answers with. */
export const DRIP_ALREADY_CLAIMED =
  'This account has already had its starter STRK. Top it up from any Starknet wallet or exchange.'

/** The refusal a spent daily budget answers with. Names the reset, so waiting is actionable. */
export const DRIP_BUDGET_SPENT =
  'Starter STRK is paused until 00:00 UTC. You can still fund this account from any Starknet ' +
  'wallet or exchange.'

/** The refusal for an address that is not one. */
export const DRIP_BAD_ADDRESS = 'That is not a Starknet address.'

/**
 * The one call the drip makes, built entirely from constants and a validated address.
 *
 * ── THE ADDRESS IS RE-SERIALISED, NEVER PASSED THROUGH ────────────────────────────────────
 *
 * `asAddress` parses to a bigint and `toFeltHex` writes it back out, so what reaches the calldata
 * is a felt this process produced rather than a string the client sent. A parse that fails throws,
 * which is the caller's cue to answer 400. The round trip is what makes "the client supplies one
 * value" true in the strong sense: even that one value is normalised before it is used.
 *
 * `u256` IS TWO FELTS, low then high, and this is the mistake that would silently send nothing.
 * `DRIP_WEI` fits in the low limb, so the high limb is `0x0` — but it must still be PRESENT, or
 * the ERC-20 reads the next calldata slot as the high half and the transfer either reverts or
 * moves an amount nobody intended.
 */
export function dripCall(recipient: string, amountWei: bigint = DRIP_WEI): Call {
  const address = toFeltHex(asAddress(recipient))
  return {
    contractAddress: STRK_TOKEN,
    entrypoint: 'transfer',
    calldata: [
      address,
      toFeltHex(amountWei & 0xffffffffffffffffffffffffffffffffn),
      toFeltHex(amountWei >> 128n),
    ],
  }
}

/**
 * Is this a usable Starknet address?
 *
 * ZERO IS REJECTED SEPARATELY from unparseable, because `asAddress('0x0')` succeeds and a transfer
 * to the zero address is a burn — real STRK, gone, with a 200 response telling the user it worked.
 * That is the one failure mode of this route that costs money and reports success.
 */
export function isDrippableAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    return asAddress(value) !== 0n
  } catch {
    return false
  }
}

