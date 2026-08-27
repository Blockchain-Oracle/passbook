// Protocol action-list invariants (FR-060 / AD-3) — the non-negotiable rules the DEPLOYED pool
// (tag CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08 / commit 74841caf, never `main`) enforces. Every
// value surface builds its transaction through this module so a list the pool would reject or
// silently revert is caught BEFORE it costs a fee. Variant→phase mapping mirrors the pool's own
// `actions.cairo` enum order (the enum index IS the serde discriminant, see message-book.ts).

import { CLIENT_ACTION } from './message-book.js'

/** The fixed 8-phase order. A list must be non-decreasing in this scale (else ACTIONS_OUT_OF_ORDER). */
export const PHASE = {
  ACCOUNT: 0,     // SetViewingKey
  CHANNEL: 1,     // OpenChannel
  SUBCHANNEL: 2,  // OpenSubchannel
  DEPOSIT: 3,     // Deposit
  USE_NOTES: 4,   // UseNote
  CREATE_NOTES: 5,// CreateEncNote / CreateOpenNote
  WITHDRAW: 6,    // Withdraw
  INVOKE: 7,      // InvokeExternal / ComputeAndInvoke
} as const

const VARIANT_PHASE: Record<number, number> = {
  [CLIENT_ACTION.SetViewingKey]: PHASE.ACCOUNT,
  [CLIENT_ACTION.OpenChannel]: PHASE.CHANNEL,
  [CLIENT_ACTION.OpenSubchannel]: PHASE.SUBCHANNEL,
  [CLIENT_ACTION.Deposit]: PHASE.DEPOSIT,
  [CLIENT_ACTION.UseNote]: PHASE.USE_NOTES,
  [CLIENT_ACTION.CreateEncNote]: PHASE.CREATE_NOTES,
  [CLIENT_ACTION.CreateOpenNote]: PHASE.CREATE_NOTES,
  [CLIENT_ACTION.Withdraw]: PHASE.WITHDRAW,
  [CLIENT_ACTION.InvokeExternal]: PHASE.INVOKE,
  [CLIENT_ACTION.ComputeAndInvoke]: PHASE.INVOKE,
}

/**
 * Minimal action shape the validator needs — carries only the fields the invariants read.
 *
 * The three value-bearing variants that used to be bare markers (`UseNote`, `CreateEncNote`,
 * `Withdraw`) now REQUIRE an amount, because `assertBalancedActionList` cannot check a balance
 * against an action that declines to say how much it moves. Required rather than optional on
 * purpose: an optional amount silently defaults to "nothing moved", which is the one answer that
 * makes an unbalanced list look balanced.
 *
 * `token` is optional here because the phase and companion rules never read it — but
 * `assertBalancedActionList` REFUSES a list that omits it rather than netting two tokens into
 * one bucket. See that function.
 */
export type ValidatableAction =
  | { type: 'SetViewingKey' }
  | { type: 'OpenChannel'; index: number }
  | { type: 'OpenSubchannel' }
  | { type: 'Deposit'; amount: bigint; token?: string }
  | { type: 'UseNote'; amount: bigint; token?: string }
  | { type: 'CreateEncNote'; amount: bigint; token?: string }
  | { type: 'CreateOpenNote'; amount: bigint; token?: string }
  | { type: 'Withdraw'; amount: bigint; token?: string }
  | { type: 'InvokeExternal' }
  | { type: 'ComputeAndInvoke' }

const isInvoke = (t: string) => t === 'InvokeExternal' || t === 'ComputeAndInvoke'

/**
 * True for the actions that write a write-once storage slot, which is the ONLY thing the pool
 * accepts as replay protection.
 *
 * SIX VARIANTS, NOT THREE, and the correction is measured rather than reasoned. The pool sets
 * `has_replay_protection` in `_client_apply_actions` when — and only when — an action it just
 * compiled emitted a `ServerAction::WriteOnce` (privacy.cairo:756-766, at the deployed tag
 * CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08 / commit 74841ca). Six of the ten emit one: the three
 * setup actions write their marker, `use_note` writes its NULLIFIER, and both note creators
 * write the note slot. `Deposit`, `Withdraw` and both invokes write nothing and so protect
 * nothing.
 *
 * This function used to name only the three setup actions, and the rule was also gated behind
 * "only when an invoke is present" — which was wrong in both directions at once. A plain send,
 * `[UseNote, CreateEncNote]`, would have been refused here for lacking a companion it does not
 * need; and `[Deposit, Withdraw]` — no invoke, no write-once — would have passed here and
 * reverted on-chain. Live `compile_actions` on mainnet returns `NO_REPLAY_PROTECTION` for that
 * second list, recorded in ACTION_LIST_EVIDENCE.
 */
const isWriteOnceWriter = (t: string) =>
  t === 'SetViewingKey' ||
  t === 'OpenChannel' ||
  t === 'OpenSubchannel' ||
  t === 'UseNote' ||
  t === 'CreateEncNote' ||
  t === 'CreateOpenNote'

/**
 * Throws unless the action list satisfies every FR-060 invariant. Ordered so the message names
 * the first real problem. Each thrown error name matches the pool's own revert class where one
 * exists, so a caught error can be shown with the exact sponsor vocabulary.
 */
export function assertActionListValid(actions: readonly ValidatableAction[]): void {
  if (actions.length === 0) throw new Error('EMPTY_ACTION_LIST')

  // 1. Phases non-decreasing (ACTIONS_OUT_OF_ORDER).
  let lastPhase = -1
  for (const a of actions) {
    const phase = VARIANT_PHASE[CLIENT_ACTION[a.type as keyof typeof CLIENT_ACTION]]
    if (phase < lastPhase) throw new Error(`ACTIONS_OUT_OF_ORDER at ${a.type}`)
    lastPhase = phase
  }

  // 2. At most one invoke-phase action per transaction.
  const invokes = actions.filter((a) => isInvoke(a.type))
  if (invokes.length > 1) throw new Error('MULTIPLE_INVOKE_ACTIONS')

  // 3. No value-bearing action moves zero or less. The pool's own `assert_valid` rejects a zero
  //    `Deposit` and a zero `Withdraw` as ZERO_AMOUNT, and a zero note is one nobody can ever
  //    spend (`ZERO_NOTE_AMOUNT_USAGE`). This lives here as well as in the balance check because
  //    the two are called independently — a caller that only wants the shape rules should still
  //    not be told a zero-amount list is fine.
  //
  //    ONE pass in list order, BEFORE the replay-protection rule, matching the pool's own
  //    ordering rather than a convenient one: `assert_valid` runs inside the compile loop (so
  //    the FIRST offending action in the list is the one named) while `NO_REPLAY_PROTECTION` is
  //    asserted after the loop finishes. Live evidence: `[Deposit(0), Withdraw(0)]` returns
  //    ZERO_AMOUNT, not NO_REPLAY_PROTECTION. Deposits keep their historic ZERO_AMOUNT_DEPOSIT
  //    code so 1-2-era callers keep the name they matched on.
  //
  //    `CreateOpenNote` IS EXEMPT, and that is a correction rather than a loophole. The pool's
  //    `CreateOpenNoteInput` (privacy.cairo:681) is
  //    `{ recipient_addr, recipient_public_key, token, index, random }` — it has NO amount field,
  //    and its `assert_valid` (actions.cairo:135-145) asserts exactly four things non-zero:
  //    recipient_addr, recipient_public_key, token, random. There is no ZERO_AMOUNT check for
  //    this variant because there is no amount to check. An open note is a SLOT whose value a
  //    later deposit writes, which is the same fact `BALANCE_SIGN` records by giving it 0.
  //
  //    Requiring an amount above zero here refused the one list this variant exists for: a swap
  //    plans an open note for the buy token with nothing committed to it, and the executor
  //    deposits the proceeds in afterwards. The rule as first written made that plan unbuildable
  //    while citing a chain error the chain does not raise.
  for (const a of actions) {
    if (a.type === 'CreateOpenNote') continue
    const amount = (a as { amount?: bigint }).amount
    if (amount === undefined || amount > 0n) continue
    if (a.type === 'Deposit') throw new Error(`ZERO_AMOUNT_DEPOSIT at ${a.type}`)
    throw new Error(`ZERO_AMOUNT at ${a.type}`)
  }

  // 4. EVERY transaction carries replay protection — not merely the invoke-bearing ones. The
  //    pool asserts this over the whole list, so `[Deposit, Withdraw]` is refused on-chain
  //    despite having no invoke in it. See `isWriteOnceWriter` for which six actions supply it.
  if (!actions.some((a) => isWriteOnceWriter(a.type))) {
    throw new Error('NO_REPLAY_PROTECTION')
  }

  // 5. Shield + invoke in one transaction is unpinned/unsafe (val-coverage F10): a Deposit that
  //    is a fresh shield must not ride the same tx as an invoke. Withdraw→invoke is the sanctioned
  //    fund-a-helper pattern; Deposit→invoke is not.
  if (invokes.length === 1 && actions.some((a) => a.type === 'Deposit')) {
    throw new Error('SHIELD_WITH_INVOKE')
  }

  // 6. Channels open in strict sequential index order (INDEX_NOT_SEQUENTIAL): the OpenChannel
  //    indices in this list must be contiguous and ascending by exactly 1.
  const chanIndices = actions.filter((a) => a.type === 'OpenChannel').map((a) => (a as { index: number }).index)
  for (let i = 1; i < chanIndices.length; i++) {
    if (chanIndices[i]! !== chanIndices[i - 1]! + 1) throw new Error('INDEX_NOT_SEQUENTIAL')
  }
}

/**
 * How each variant moves a token balance: `+1` puts value in, `-1` takes value out, `0` moves
 * none. Mirrors which pool handler calls `add_balance` / `subtract_balance` (privacy.cairo).
 */
const BALANCE_SIGN: Record<string, 1 | -1 | 0> = {
  SetViewingKey: 0,
  OpenChannel: 0,
  OpenSubchannel: 0,
  Deposit: 1,
  UseNote: 1,
  CreateEncNote: -1,
  // A CreateOpenNote leaves its amount open on-chain — it is filled by whatever the invoke leg
  // deposits into it later, so it moves nothing at compile time. It carries an `amount` in this
  // module only for the zero-amount rule above; counting it here would make every open-note list
  // look unbalanced by exactly the amount nobody has committed to yet.
  //
  // SOURCE-DERIVED, NOT PROBED. `create_open_note` (privacy.cairo:674) takes no `token_balances`
  // argument at all and never adjusts one, unlike `create_enc_note` immediately above it, which
  // does `token_balances.subtract_balance(:token, :amount)`. There is no ACTION_LIST_EVIDENCE row
  // for an open note — the shape only means anything with an invoke leg, which is epic 3's path
  // rather than this story's.
  CreateOpenNote: 0,
  Withdraw: -1,
  InvokeExternal: 0,
  ComputeAndInvoke: 0,
}

/**
 * Throws unless every token in the list balances EXACTLY, checked the way the pool checks it.
 *
 * The pool keeps one running `u128` per token while it compiles (`TokenBalances`, objects.cairo)
 * and applies two separate rules to it. Both are reproduced here, in list order, because they
 * fail at different times and mean different things:
 *
 *   - NEGATIVE_INTERMEDIATE_BALANCE — a subtraction that would go below zero AT THAT POINT. It
 *     is a `checked_sub` on an unsigned counter, so this is order-sensitive: the same actions
 *     rearranged can pass. That is why this walks the list rather than summing it.
 *   - FINAL_BALANCE_MUST_BE_ZERO — a token left with anything on it once the list is done.
 *     Not "inputs cover outputs": a send that spends a 10-note to move 3 must create a 7 change
 *     note, or the pool refuses the whole transaction. Surplus is as fatal as shortfall.
 *
 * Both were confirmed against the deployed mainnet class through free `compile_actions` calls —
 * see ACTION_LIST_EVIDENCE's send group for the rows.
 *
 * A value-bearing action with no usable `token` is REFUSED rather than bucketed together with
 * every other one. Netting two different tokens into one counter would report a multi-token list
 * as balanced whenever the errors happened to cancel, which is precisely the arithmetic this
 * exists to catch — and a blank string is the sharpest version of that trap, because `BigInt('  ')`
 * is `0n`, so whitespace and the zero address would silently share a bucket.
 *
 * ONE CHECK HERE IS NOT THE POOL'S: the zero-amount refusal. The pool has no rule named for a
 * zero-amount `CreateEncNote` — the shape reverts as FINAL_BALANCE_MUST_BE_ZERO, which is the row
 * banked in ACTION_LIST_EVIDENCE — so this is a deliberate earlier, narrower failure that names
 * the actual defect instead of its arithmetic consequence. Everything else here mirrors the
 * pool's own two rules.
 */
export function assertBalancedActionList(actions: readonly ValidatableAction[]): void {
  const balances = new Map<string, bigint>()

  for (const a of actions) {
    const sign = BALANCE_SIGN[a.type]
    if (sign === undefined) throw new Error(`UNKNOWN_ACTION at ${a.type}`)
    if (sign === 0) continue

    const { token, amount } = a as { token?: string; amount: bigint }
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error(
        `MISSING_TOKEN at ${a.type}: a value-bearing action must name its token, or the ` +
          'balance check would net two tokens into one counter',
      )
    }
    if (amount <= 0n) throw new Error(`ZERO_AMOUNT at ${a.type}`)
    // The pool's balances are `u128` (objects.cairo), and a `CreateEncNote` amount is a u128
    // field. A value at or above 2^128 does not overflow into a large number, it fails to
    // serialise — so it is refused here where the message can say why.
    if (amount >= U128_CEILING) {
      throw new Error(
        `AMOUNT_TOO_LARGE at ${a.type}: ${amount} does not fit the pool's u128 token balances`,
      )
    }

    // Felts are canonical, string spellings are not: `0x0403…` and `0x403…` are one token.
    const key = tokenKey(token, a.type)
    const next = (balances.get(key) ?? 0n) + BigInt(sign) * amount
    if (next < 0n) {
      throw new Error(
        `NEGATIVE_INTERMEDIATE_BALANCE at ${a.type}: token ${token} would go ${next} at this point`,
      )
    }
    balances.set(key, next)
  }

  for (const [token, balance] of balances) {
    // ONE DIRECTION ONLY, and deliberately so. A negative running total is impossible by the time
    // this loop runs: `NEGATIVE_INTERMEDIATE_BALANCE` above refuses the subtraction that would
    // produce one, exactly as the pool's `checked_sub` does. So the surplus is the only thing
    // left to report, and phrasing it as a two-way choice would imply a branch nothing reaches.
    if (balance !== 0n) {
      throw new Error(
        `FINAL_BALANCE_MUST_BE_ZERO: token 0x${token} is left holding ${balance} — ` +
          'the surplus needs a change note',
      )
    }
  }
}

/** The pool's token balances are u128; every amount has to fit one. */
const U128_CEILING = 1n << 128n

/** One token, one counter, whatever hex spelling it arrived in. Throws on anything unusable. */
function tokenKey(token: string, at: string): string {
  let felt: bigint
  try {
    felt = BigInt(token)
  } catch {
    // Its own message: a present-but-malformed address is a caller bug of a different kind from
    // an omitted one, and collapsing the two sends the reader looking in the wrong place.
    throw new Error(`MALFORMED_TOKEN at ${at}: ${JSON.stringify(token)} is not a felt address`)
  }
  if (felt === 0n) {
    throw new Error(
      `MISSING_TOKEN at ${at}: the zero address is not a token, and bucketing under it would ` +
        'merge every action that failed to name one',
    )
  }
  return felt.toString(16)
}

export interface OpenNoteDeposit {
  noteId: bigint
  token: string
  amount: bigint
}

/**
 * Decodes a helper's return value as a **bare `Span<OpenNoteDeposit>`** — `[len, (note_id, token,
 * amount)×len]`, 3 felts per item (AD-3: the HEAD tuple signature reverts on the deployed class,
 * so the return is a bare span, not `(Span<..>, ..)`). Throws if the length prefix disagrees with
 * the felts that follow — the same mis-parse guard `buildInvokeCalldata` applies on the way out.
 */
export function decodeOpenNoteDeposits(felts: readonly string[]): OpenNoteDeposit[] {
  if (felts.length === 0) throw new Error('EMPTY_RETURN')
  const len = Number(BigInt(felts[0]!))
  const body = felts.slice(1)
  if (body.length !== len * 3) {
    throw new Error(`span length ${len} does not match ${body.length} felts (expected ${len * 3})`)
  }
  const out: OpenNoteDeposit[] = []
  for (let i = 0; i < len; i++) {
    out.push({
      noteId: BigInt(body[i * 3]!),
      token: body[i * 3 + 1]!,
      amount: BigInt(body[i * 3 + 2]!),
    })
  }
  return out
}
