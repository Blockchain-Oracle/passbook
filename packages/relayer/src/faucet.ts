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
// ── THE DRIP BUYS EXACTLY ONE THING: THE ACCOUNT DEPLOY ───────────────────────────────────
//
// This used to be the ONLY subsidy — M8's one-subsidy rule, "if we're already giving them money,
// we cannot then see the relayer sponsoring their transaction again" — and it was sized to pay for
// the whole journey: deploy, then a SELF-PAID registration out of what was left.
//
// THAT RULE WAS BUILT ON A COST MODEL THE RECEIPTS DO NOT SUPPORT, so it is retired here rather
// than left to argue with the code around it. Three measurements, all from mainnet:
//
//   - A self-paid pool write must HOLD `feeFloor` — the 6 STRK fee plus the gas bound, ~11.7 STRK
//     (protocol `fee-ceiling.ts`). The old 10 STRK drip was BELOW that floor, so every account it
//     funded was refused before a transaction was built. Funded enough to exist, too poor to act:
//     exactly the failure the 10 STRK was chosen to fix, reintroduced one rung higher up.
//   - `collect_fee` pulls one 6 STRK fee PER SUBMISSION, and in relayer mode the proof carries a
//     reimbursement leg that withdraws it straight back out of the user's own shielded notes
//     (protocol `send-prove.ts`). Verified on tx 0x84a596…71d4: 6 STRK out to the pool, 6 STRK
//     back to us, in one transaction. So a sponsored action costs this wallet GAS ALONE.
//   - The drip and the sponsorship were therefore never two payments for one thing. The drip buys
//     an account deploy. The sponsorship buys gas. The pool fee comes from the user's balance.
//
// So the drip is now sized to ONE job — letting a counterfactual account deploy itself — and
// everything after it is sponsored. What a visitor who leaves takes with them drops from a whole
// journey's funding to the price of a deploy.
//
// The daily cap is still the acquisition budget: cap × drip is what a bad day costs in transfers,
// though the sponsorship budget beside it is now the larger number.
//
import type { Call } from 'starknet'

import { STRK_TOKEN } from '../../protocol/src/constants.js'
import { asAddress, toFeltHex } from '../../protocol/src/address.js'

/**
 * What a new account is given, in wei — 2 STRK by default, `RELAYER_FAUCET_DRIP_WEI` to retune
 * without a release.
 *
 * SIZED TO THE DEPLOY, AND DELIBERATELY NOT TO THE JOURNEY. A measured `deployAccount` costs
 * 0.059 STRK (evidence/account-deployment.json). Two STRK is that, a failed attempt, and a second
 * try, with room for a gas spike — and nothing beyond it, because everything past the deploy is
 * sponsored and a visitor who wanders off should cost us a deploy rather than a wallet.
 *
 * DO NOT RAISE THIS TO LET SOMEONE SELF-PAY A POOL WRITE. That needs `feeFloor` — ~11.7 STRK held,
 * not spent — and a drip sized for it hands every passer-by the price of an onboarding. The
 * self-paid path stays open for anyone who funds their own account; it is not what this buys.
 */
export const DRIP_WEI = 2_000_000_000_000_000_000n

/** The refusal a spent per-address claim answers with. */
export const DRIP_ALREADY_CLAIMED =
  'This account has already had its starter STRK. Top it up from any Starknet wallet or exchange.'

/** The refusal a spent daily budget answers with. Names the reset, so waiting is actionable. */
export const DRIP_BUDGET_SPENT =
  'Starter STRK is paused until 00:00 UTC. You can still fund this account from any Starknet ' +
  'wallet or exchange.'

/**
 * The refusal a spent PER-VISITOR allocation answers with. Names no reset, because there is none.
 *
 * The drip is once per address forever AND once per connection forever. This is the second of
 * those — a different address on a connection that already took one — and it is the sentence that
 * used to promise a midnight that never applied.
 */
export const DRIP_VISITOR_SPENT =
  'This connection has had its starter STRK. You can still fund this account from any Starknet ' +
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

