//
// The Earn span guard: what the prover is allowed to have composed for a supply or a redeem.
//
// ── WHY THIS IS THE ONLY THING BOUNDING AN EARN TRANSACTION ───────────────────────────────
//
// The relayer does not decode a pool call. Its allowlist checks that the entrypoint is
// `apply_actions` and stops there — calldata is never read, and it could not read it usefully
// anyway, because the whole point of the pool is that the actions are private. So there is no
// second opinion downstream. Whatever this function lets past is what gets proved and paid for.
//
// It therefore reads the compiled span BEFORE anything is proved, and insists on exactly the three
// actions an Earn transaction is made of. A drift costs nothing to catch here and the pool fee to
// discover on chain.
//
// Field layouts are from the deployed pool's own `actions.cairo`, not inferred:
//
//   Withdraw        [to_addr, token, amount(u128), random]
//   CreateOpenNote  [recipient_addr, recipient_public_key, token, index, random]   ← no amount
//   InvokeExternal  [contract_address, calldata_len, ...calldata]
//
// `CreateOpenNote` carrying no amount is not an omission — an open note's value is decided when
// the invoked contract deposits into it, which is exactly why a lending vault can be called at all.
//

import { decodeClientActions } from './action-span.js'
import { CLIENT_ACTION } from './client-action-index.js'

export interface EarnSpanSubject {
  /** Our deployed helper: both the withdrawal's destination and the invoke's target. */
  readonly helper: bigint
  /** The token being spent — USDC on a supply, the vToken on a redeem. */
  readonly inToken: bigint
  /** Underlying on a supply; an exact share count on a redeem. */
  readonly amount: bigint
  /** The token the open note is for — the mirror of `inToken`. */
  readonly outToken: bigint
  /** `earn-calldata.ts`'s six felts, compared one for one. */
  readonly calldata: readonly string[]
}

/** The SDK composed something other than the reviewed Earn transaction. Nothing was signed. */
export class EarnSpanMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EarnSpanMismatch'
  }
}

/**
 * Exactly one withdrawal to the helper for the reviewed token and amount, exactly one open note for
 * the output token, and exactly one `InvokeExternal` to the helper carrying the calldata verbatim.
 *
 * Everything else in the span is the SDK's own business — notes spent, change, channel setup, the
 * relayer's reimbursement leg — and is left alone. `decodeClientActions` has already refused any
 * tail it could not account for, so "left alone" still means "inspected".
 */
export function assertEarnActionSpan(span: readonly bigint[], subject: EarnSpanSubject): void {
  const actions = decodeClientActions(span, 'earn')

  // ── The withdrawal ────────────────────────────────────────────────────────────────────
  //
  // Scoped by destination AND token, not just counted. A relayer-mode send folds in a second
  // `Withdraw` for the fee reimbursement, so a bare count of one would refuse every sponsored
  // Earn transaction and — worse — a count of "at least one" would accept a second withdrawal
  // going somewhere else entirely.
  const toHelper = actions.filter(
    (a) => a.variant === CLIENT_ACTION.Withdraw && a.fields[0] === subject.helper && a.fields[1] === subject.inToken,
  )
  if (toHelper.length !== 1) {
    throw new EarnSpanMismatch(
      `the compiled transaction makes ${toHelper.length} withdrawals of this token to the Earn helper; it must make exactly one`,
    )
  }
  const withdrawal = toHelper[0]!
  if (withdrawal.fields[2] !== subject.amount) {
    throw new EarnSpanMismatch(`the compiled withdrawal moves ${withdrawal.fields[2]} and the review said ${subject.amount}`)
  }

  // ── The open note ─────────────────────────────────────────────────────────────────────
  //
  // One, for the output token. Two would mean the pool expects two deposits and the helper returns
  // one — which `compile_actions` cannot catch, and which reverts AFTER the fee is taken.
  const openNotes = actions.filter((a) => a.variant === CLIENT_ACTION.CreateOpenNote && a.fields[2] === subject.outToken)
  if (openNotes.length !== 1) {
    throw new EarnSpanMismatch(
      `the compiled transaction opens ${openNotes.length} notes for the output token; the helper deposits into exactly one`,
    )
  }
  const strayOpenNotes = actions.filter((a) => a.variant === CLIENT_ACTION.CreateOpenNote).length - 1
  if (strayOpenNotes > 0) {
    throw new EarnSpanMismatch(
      `the compiled transaction opens ${strayOpenNotes} note(s) for a token the helper will not deposit into, which would revert after the fee`,
    )
  }

  // ── The invoke ────────────────────────────────────────────────────────────────────────
  //
  // `ComputeAndInvoke` is counted here too. It is a different variant with a different payload,
  // and filtering for `InvokeExternal` alone would let one ride along beside a legitimate invoke
  // while the count still read as one.
  const invokes = actions.filter((a) => a.variant === CLIENT_ACTION.InvokeExternal || a.variant === CLIENT_ACTION.ComputeAndInvoke)
  if (invokes.length !== 1 || invokes[0]!.variant !== CLIENT_ACTION.InvokeExternal) {
    throw new EarnSpanMismatch(
      `the compiled transaction carries ${invokes.length} invoke action(s); an Earn transaction carries exactly one InvokeExternal`,
    )
  }
  const invoke = invokes[0]!
  if (invoke.fields[0] !== subject.helper) {
    throw new EarnSpanMismatch(`the compiled transaction invokes ${invoke.fields[0]?.toString(16)}, not the Earn helper`)
  }
  const compiled = invoke.fields.slice(2)
  const expected = subject.calldata.map((f) => BigInt(f))
  if (compiled.length !== expected.length || compiled.some((f, i) => f !== expected[i])) {
    throw new EarnSpanMismatch('the compiled helper calldata is not the reviewed operation verbatim')
  }
}
