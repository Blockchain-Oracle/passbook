//
// The send pipeline's vocabulary: stages, deadlines, receipts, the maturity watch, and the
// `SendResult` / `SendFailure` unions every surface renders from.
//
// Five stages: build → prove → relay → mature → confirmed. `mature` is not decoration — a minted
// note is spendable only once it is in pool storage, the pool publishes no maturity view, so the
// pipeline polls `get_note` and reports whether it SAW the note or STOPPED WATCHING.
//

import type { SendStage } from './pipeline-stage.js'
import { noteExists } from './pool.js'
import { POOL_SEES_DISCLOSURE, type FeeRow } from './register.js'
import {
  CONFIRM_TIMEOUT_MS,
  REAL_TIMER,
  RelayDeliveryUnknown,
  assertNotReverted,
  confirmFromReceipt,
  confirmOnChain,
  readReceiptBlockNumber,
  sanitizeBlockNumber,
  withDeadline,
  type DeadlineTimer,
} from './relay.js'
import type { DoorAInvite } from './recipient.js'
import { RelayRefused, RelayerMisconfigured } from './submit.js'

export {
  CONFIRM_TIMEOUT_MS,
  REAL_TIMER,
  assertNotReverted,
  confirmFromReceipt,
  confirmOnChain,
  readReceiptBlockNumber,
  sanitizeBlockNumber,
  withDeadline,
}
export type { DeadlineTimer, FeeRow, SendStage }

// ── Results ───────────────────────────────────────────────────────────────────────────────

/** What a surface needs to offer self-submission after a relayer branch closed. A re-run, never a resubmit. */
export interface SelfSubmitOffer {
  mode: 'self'
  feeRow: FeeRow
  disclosure: string
  gasNotice: string
}

export type SendFailure =
  /** Not an error state: carries the Door-A invite rendered in place of the form. */
  | { kind: 'unregistered-recipient'; recipient: string; door: DoorAInvite }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  | { kind: 'bad-input'; reason: string }
  | { kind: 'lock-unavailable'; reason: string }
  | { kind: 'pool-paused' }
  | { kind: 'pool-upgraded'; pinned: string; onchain: string }
  | { kind: 'insufficient-balance'; token: string; symbol: string; neededWei: bigint; haveWei: bigint; shortfallWei: bigint; notice: string }
  /** Enough of the send token, not enough shielded STRK for the relayer's fee. Self-submission needs none. */
  | { kind: 'insufficient-fee-balance'; token: string; symbol: string; feeWei: bigint; haveWei: bigint; shortfallWei: bigint; notice: string }
  | { kind: 'prover-failed'; reason: string }
  /** The SDK named the mail's recipient note differently from the walk; nothing signed, retry is free. */
  | { kind: 'mail-anchor-mismatch'; reason: string }
  /** The compiled span was not the Earn transaction that was reviewed. Nothing was signed or paid. */
  | { kind: 'earn-span-mismatch'; reason: string }
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  /** Reachable and wired wrong. Waiting fixes nothing; self-submission works now. */
  | { kind: 'relayer-misconfigured'; reason: string; selfSubmit: SelfSubmitOffer }
  /** The fee ROSE between pre-flight and the lock; the folded leg would under-pay. A fall is accepted. */
  | { kind: 'fee-moved'; foldedWei: bigint; currentWei: bigint }
  | { kind: 'send-cap-reached'; notice: string; selfSubmit: SelfSubmitOffer }
  /** The sponsorship budget answered an unflagged send: the relayer meters against the wrong budget. */
  | { kind: 'sponsorship-paused'; notice: string; selfSubmit: SelfSubmitOffer }
  | { kind: 'relayer-down'; notice: string; selfSubmit: SelfSubmitOffer }
  /**
   * This ACCOUNT has spent the transactions we cover — not a budget, not a rate limit.
   *
   * Reachable only since the review sheet let a user ask for one: before that the app never sent
   * `mode: 'relayer'`, so `/submit`'s `allowance-spent` refusal had nowhere to land and fell
   * through to `relay-refused`, which drops both the authored notice and the self-submit offer.
   * The send is not over — it costs the user the pool fee instead of costing us one.
   */
  | { kind: 'allowance-spent'; notice: string; selfSubmit: SelfSubmitOffer }
  /** Refused before anything could be broadcast: nothing signed, retry is free. */
  | { kind: 'relay-refused'; status: number; reason: string }
  /** The user's own wallet was the caller; a failed attempt still cost gas — `gasLine` says so. */
  | { kind: 'self-submit-failed'; reason: string; gasLine: string }
  | { kind: 'reverted'; message: string; transactionHash: string }
  /** A transaction MAY be in flight; notes may be spent; a retry risks a second, reverting send. */
  | { kind: 'confirmation-unknown'; transactionHash: string; reason: string }

export type SendResult =
  | {
      ok: true
      stages: SendStage[]
      transactionHash: string
      submittedBy: 'relayer' | 'self'
      /** Present, and `true`, only on a self-submitted send. Permanent. */
      selfSubmitted?: true
      feeRow: FeeRow
      /** The notes this send minted for the sender, once the pool holds them. */
      maturedNoteIds: bigint[]
      sendBlock: number | null
      /** A mail's recipient note id — the key its memo is posted under. */
      mailAnchor?: bigint
    }
  | { ok: false; stages: SendStage[]; failure: SendFailure; selfSubmitted?: true }

// ── Copy owned by the send pipeline ───────────────────────────────────────────────────────

export function notEnoughShielded(symbol: string): string {
  return `Not enough shielded ${symbol}`
}

/**
 * The refusal for a short PUBLIC balance, which is a different fact from a short shielded one and
 * was previously discovered by the sequencer rather than by us. It names the distinction outright
 * because the two balances are shown side by side and only one of them can pay a fee: the note walk
 * says the spend is affordable, and it is — the fee and the gas reserve are not.
 */
export function notEnoughPublicStrk(haveText: string, needText: string): string {
  return `The pool fee and network gas are paid from your PUBLIC STRK, not from your shielded balance. This address holds ${haveText} STRK and a shielded transaction needs ${needText}. Nothing was submitted.`
}

export const SELF_SUBMIT_GAS_LOSS = 'Your wallet paid network gas for the failed attempt.'

export const SELF_SUBMIT_DISCLOSURE =
  `${POOL_SEES_DISCLOSURE} Submitting it yourself puts your own address on it as the sender.`

/** Used only when the relayer's own notice is empty — never render an empty string. */
export const RELAY_FALLBACK_NOTICE =
  'The relayer is not taking this send right now. You can still submit it from your own wallet.'

/** Raw pool revert string → honest copy. Substring match; unknown codes pass through unchanged. */
export function mapSendError(raw: string): string {
  const table: Record<string, string> = {
    NEGATIVE_INTERMEDIATE_BALANCE: 'That send spends more than the notes it uses hold.',
    FINAL_BALANCE_MUST_BE_ZERO: 'That send did not account for every wei it moved — nothing was sent.',
    NOTE_NOT_FOUND: 'One of the notes in this send is no longer in the pool. Refresh and try again.',
    ZERO_NOTE_AMOUNT_USAGE: 'One of the notes in this send is empty and cannot be spent.',
    SUBCHANNEL_NOT_FOUND: 'This account has no channel for that token yet.',
    RECIPIENT_NOT_REGISTERED: 'That address has no account on this protocol yet — send them an invite.',
    INDEX_NOT_SEQUENTIAL: 'Your channel list moved while this was being prepared. Try again.',
    NON_ZERO_VALUE: 'Part of this send has already been written and cannot be written twice.',
    NO_REPLAY_PROTECTION: 'That transaction carried nothing the pool could use to prevent a replay.',
    PROOF_EXPIRED: 'The proof for this send expired before it reached the chain. Try again.',
    ZERO_AMOUNT: 'That send moves an amount of zero, which the pool refuses.',
    SENDER_NOT_REGISTERED: 'This account has no key in the pool yet, so it cannot send.',
  }
  for (const [code, message] of Object.entries(table)) {
    if (raw.includes(code)) return message
  }
  return raw
}

// ── Stage progression ─────────────────────────────────────────────────────────────────────

export interface StageTracker {
  stages: SendStage[]
  reach(stage: SendStage): void
}

/** Records reached stages; an observer that throws is warned about and ignored — it watches, it does not vote. */
export function makeStages(onStage?: (stage: SendStage) => void): StageTracker {
  const stages: SendStage[] = []
  return {
    stages,
    reach(stage) {
      stages.push(stage)
      try {
        onStage?.(stage)
      } catch (e) {
        console.warn(`send: onStage(${stage}) observer threw and was ignored: ${String(e)}`)
      }
    },
  }
}

// ── Maturity ──────────────────────────────────────────────────────────────────────────────

/** `true` once the pool holds every note; `false` once we stopped watching. `false` is NOT failure. */
export type ConfirmNoteMature = (noteIds: readonly bigint[]) => Promise<boolean>

/** A watching budget, not a ripening window — the pool publishes none. Same length as the confirm budget. */
export const MATURE_TIMEOUT_MS = CONFIRM_TIMEOUT_MS
export const MATURE_POLL_MS = 5_000

/** Polls `get_note` until the pool holds every id, or until the budget runs out. */
export function makeNoteMatureWatcher(
  read: (noteId: bigint) => Promise<boolean> = noteExists,
  timer: DeadlineTimer = REAL_TIMER,
  pollMs: number = MATURE_POLL_MS,
  budgetMs: number = MATURE_TIMEOUT_MS,
  now: () => number = Date.now,
): ConfirmNoteMature {
  return async (noteIds) => {
    if (noteIds.length === 0) return true
    const deadline = now() + budgetMs
    for (;;) {
      try {
        // Each round is deadlined with what is left: a hung RPC must not park the submit lock.
        const roundMs = Math.max(1, deadline - now())
        const present = await withDeadline(Promise.all(noteIds.map((id) => read(id))), roundMs, timer)
        if (present.every(Boolean)) return true
      } catch (e) {
        // A broken or hung read is not a missing note; keep watching until the budget is spent.
        console.warn(`send: a maturity read failed and was retried: ${String(e)}`)
      }
      if (now() >= deadline) return false
      await new Promise<void>((resolve) => {
        timer.setTimeout(resolve, pollMs)
      })
    }
  }
}

// ── Classifying what the submitters throw ─────────────────────────────────────────────────

/** A revert thrown by any confirm implementation: ours (`RegistrationReverted`) or an injected one. */
export function revertReasonOf(e: unknown): string | null {
  const reason = (e as { revertReason?: unknown } | null)?.revertReason
  return typeof reason === 'string' ? reason : null
}

/** What a thrown relayer submission means for the send. Nothing signed unless it says otherwise. */
export function relayFailureFrom(e: unknown, offer: SelfSubmitOffer): SendFailure {
  const notice = (advertised: string | undefined) => advertised?.trim() || RELAY_FALLBACK_NOTICE
  if (e instanceof RelayDeliveryUnknown) {
    return { kind: 'confirmation-unknown', transactionHash: '', reason: String(e.message) }
  }
  if (e instanceof RelayerMisconfigured) {
    return { kind: 'relayer-misconfigured', reason: String(e), selfSubmit: offer }
  }
  if (e instanceof RelayRefused) {
    if (e.status === 403 && e.reason === 'send-cap-reached') {
      return { kind: 'send-cap-reached', notice: notice(e.notice), selfSubmit: offer }
    }
    if (e.status === 403 && e.reason === 'sponsorship-paused') {
      return { kind: 'sponsorship-paused', notice: notice(e.notice), selfSubmit: offer }
    }
    if (e.status === 503 && e.reason === 'relayer-down') {
      return { kind: 'relayer-down', notice: notice(e.notice), selfSubmit: offer }
    }
    if (e.status === 403 && e.reason === 'allowance-spent') {
      return { kind: 'allowance-spent', notice: notice(e.notice), selfSubmit: offer }
    }
    return { kind: 'relay-refused', status: e.status, reason: e.error ?? e.notice ?? 'the relayer refused the submission' }
  }
  return { kind: 'relay-refused', status: 0, reason: String(e) }
}
