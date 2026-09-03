//
// The send vocabulary and the free pre-flight: kinds, legs, request shapes, and every refusal
// that can be decided from data already in hand — before a prover or a relayer is asked anything.
//
// The SDK builder composes the action list; this module only decides whether to ask it to.
//

import type { PrivateTransfersBuilder, PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'

import { STRK_TOKEN } from './constants.js'
import type { SwapCall } from './quote.js'
import type { EarnLeg } from './send-earn.js'
import type { MailBody } from './mail-body.js'
import { notEnoughShielded, type SendFailure } from './pipeline.js'

export type SubmitMode = 'relayer' | 'self'

export type SendKind =
  | 'transfer'
  | 'mail'
  | 'withdraw'
  | 'swap'
  | 'earn-supply'
  | 'earn-redeem'
  | 'bridge'
  | 'market-create'
  | 'market-bet'
  | 'market-claim'
  | 'market-cashout'
  | 'launch-buy'
  | 'launch-redeem'
  | 'launch-refund'
  | 'gov-ballot'
  | 'gov-join'
  | 'gov-delegate'
  | 'gov-fund'
  | 'gov-reclaim'
  | 'gov-revoke'

/** Value INTO one of our contracts; the contract returns an empty span, so zero open notes. */
const FUNDING_KINDS: readonly string[] = ['market-create', 'market-bet', 'launch-buy', 'gov-ballot', 'gov-delegate', 'gov-fund']
/** Open notes minted for payouts; the contract's deposits fill them. */
const SETTLING_KINDS: readonly string[] = ['market-claim', 'market-cashout', 'launch-redeem', 'launch-refund', 'gov-reclaim', 'gov-revoke']
/** Travel as `ComputeAndInvoke`: the pool injects the per-contract identity handle. */
const COMPUTE_KINDS: readonly string[] = ['gov-ballot', 'gov-join']

export const isFundingKind = (kind: SendKind): boolean => FUNDING_KINDS.includes(kind)
export const isSettlingKind = (kind: SendKind): boolean => SETTLING_KINDS.includes(kind)
export const isComputeKind = (kind: SendKind): boolean => COMPUTE_KINDS.includes(kind)
export const isAppKind = (kind: SendKind): boolean => isFundingKind(kind) || isSettlingKind(kind) || kind === 'gov-join'

/** Both Earn directions. Neither is a funding, settling or compute kind — like `swap`, they are their own shape. */
export const isEarnKind = (kind: SendKind): boolean => kind === 'earn-supply' || kind === 'earn-redeem'

/** The venue leg of a swap. The executor declares `privacy_invoke(buy_token, calls: Span<Call>, note_id)`. */
export interface SwapLeg {
  executor: string
  buyToken: string
  buySymbol: string
  calls: readonly SwapCall[]
  /** Not enforced here — the venue's `multi_route_swap` reverts below it. Carried for copy. */
  minOutWei: bigint
}

/** The crossing leg: the helper burns USDC through CCTP; nothing comes back into the pool. */
export interface BridgeLeg {
  helper: string
  destinationDomain: number
  mintRecipient: bigint
  /** Enforced client-side: the helper's own `AMOUNT_LE_MAX_FEE`, said before the fee is paid. */
  maxFeeWei: bigint
  /** Must be the tier the fee was quoted for. */
  minFinalityThreshold: number
  chainName: string
}

/**
 * The app-contract leg. `openNoteCount` is the field that costs the fee to get wrong: the pool
 * asserts every open note was deposited into, and its free `compile_actions` cannot catch it.
 */
export interface AppInvokeLeg {
  contract: string
  op: number
  /** `[op, payload_len, ...payload]`, already serialised by the calldata builders. */
  calldata: readonly string[]
  /** Indices into `calldata` the open-note ids fill in after the compiler mints them. */
  noteIdSlots: readonly number[]
  openNoteCount: number
  via?: 'invoke' | 'compute'
  /** The payout token; required when `openNoteCount > 0`. */
  payoutToken?: string
}

/**
 * The memo leg of a mail: a transfer that also carries a sealed body to the Mailbox, posted by
 * the pool in the same proved transaction. `recipientPublicKey` arrives from the pre-flight's
 * registration read; `anchor` and `calldata` are filled by `proveSend` once the note is named.
 */
export interface MailLeg {
  body: MailBody
  /** The pool-only Mailbox this deployment posts to. */
  mailbox: string
  recipientPublicKey?: bigint
  /** The recipient note's id, predicted from the walk; the span guard holds the SDK to it. */
  anchor?: bigint
  calldata?: readonly string[]
}

export interface SendRequest {
  kind: SendKind
  /** A shielded account (transfer), a public address (withdraw), or the contract the legs name. */
  recipient: string
  /** The token sent — for a swap the one SOLD; for a settling kind the payout token (informational). */
  token: string
  symbol: string
  amount: bigint
  mode: SubmitMode
  /**
   * True when the relayer is COVERING the pool fee rather than fronting it — so no reimbursement
   * leg is folded into the proof and the user's shielded balance is not touched by the fee.
   *
   * ── WHY THIS IS A FIELD AND NOT `fee === null` ────────────────────────────────────────────
   *
   * Relayer mode with no fee leg has two meanings that must never be confused: "we are paying for
   * this one" and "we failed to read where the reimbursement goes". The second used to be
   * impossible, so `validateCommon` could treat a missing fee in relayer mode as a bug and refuse.
   * Now that the first exists, the intent has to be stated rather than inferred — otherwise a
   * failed `readFeeRecipient` would silently become a free transaction at our expense, which is
   * the exact failure the old guard was written to catch.
   */
  sponsored?: boolean
  swap?: SwapLeg
  earn?: EarnLeg
  bridge?: BridgeLeg
  app?: AppInvokeLeg
  mail?: MailLeg
}

// ── Caller-supplied wallet data (the walk the user is looking at; used for the free refusals) ──

export interface SendNoteData {
  id: bigint
  token: string
  amount: bigint
  witness: { channelKey: bigint; nonce: number; r: bigint }
  sender?: string
}

export interface SendChannelData {
  address: string
  publicKey: bigint
  key?: bigint
  tokens?: { token: string; tokenIndex: number; noteNonce: number }[]
}

export interface SendWalletData {
  channels: SendChannelData[]
  notes: SendNoteData[]
}

export interface SendInput extends SendRequest {
  accountKey: string
  account: PrivateTransfersUser
  wallet: SendWalletData
  appName?: string
  relayerUrl?: string
}

/** The relayer's advertised reimbursement leg; both fields read live. `null` in self mode. */
export interface FeeLeg {
  recipient: string
  feeWei: bigint
}

// ── Felt helpers ──────────────────────────────────────────────────────────────────────────

/** A felt or nothing. `BigInt('')` is `0n`, so blanks are refused before parsing. */
export function feltOrNull(value: unknown): bigint | null {
  try {
    if (typeof value !== 'string' || value.trim() === '') return null
    return BigInt(value)
  } catch {
    return null
  }
}

export const sameFelt = (a: string, b: string): boolean => BigInt(a) === BigInt(b)

// ── The free refusals shared by every kind ────────────────────────────────────────────────

export type Refusal = { ok: true } | { ok: false; failure: SendFailure }

/** One kind's contribution: its free refusals, and how it drives the SDK builder. */
export interface SendLeg {
  validate(request: SendRequest, self: string): Refusal
  /** Adds the kind's actions. Throws (→ `prover-failed`) only from inside SDK callbacks. */
  compose(builder: PrivateTransfersBuilder, request: SendRequest, self: string): void
}
export const bad = (reason: string): Refusal => ({ ok: false, failure: { kind: 'bad-input', reason } })
export const OK: Refusal = { ok: true }

/** Mode, amount, addresses and the fee leg — the rules every kind shares, in evaluation order. */
export function validateCommon(request: SendRequest, self: string, fee: FeeLeg | null): Refusal {
  const { kind, amount, mode } = request
  // A stray mode read as "not relayer" would build a relayer batch with no reimbursement.
  if (mode !== 'relayer' && mode !== 'self') {
    return bad(`refusing submit mode ${JSON.stringify(mode)}: expected 'relayer' or 'self'`)
  }
  if (isSettlingKind(kind) || kind === 'gov-join') {
    if (amount !== 0n) return bad(`a ${kind} sends nothing of yours — so its amount must be 0, and it carried ${amount}`)
  } else if (kind === 'gov-ballot') {
    if (amount < 0n) return bad(`refusing to send ${amount}: an amount must be positive`)
  } else if (amount <= 0n) {
    return bad(`refusing to send ${amount}: an amount must be positive`)
  }
  if (mode === 'relayer') {
    if (request.sponsored) {
      // A covered transaction must carry NO reimbursement leg. One folded in anyway would take the
      // fee out of the user's notes AND leave the relayer paying `collect_fee` — charged twice,
      // once to each party, for a transaction advertised as free.
      if (fee) return bad('a sponsored submission must not carry a reimbursement leg: it would charge the fee twice')
    } else {
      if (!fee) return bad('relayer mode needs the advertised fee recipient and the live fee, and got neither')
      if (fee.feeWei <= 0n) return bad(`the relayer advertised a fee of ${fee.feeWei} wei`)
    }
  }
  const recipient = feltOrNull(request.recipient)
  if (recipient === null) return bad(`the recipient ${JSON.stringify(request.recipient)} is not a felt address`)
  if (request.swap && kind !== 'swap') return bad(`a ${kind} carried a swap leg; it was refused rather than dropped`)
  if (request.earn && !isEarnKind(kind)) return bad(`a ${kind} carried an Earn leg; it was refused rather than dropped`)
  // The symmetric half, and the one that matters more: a supply whose leg went missing somewhere
  // upstream would compose as a bare withdrawal to our helper — value delivered and stranded, with
  // nothing to invoke it back out. `send-preflight.ts` rebuilds the request field by field, which
  // is exactly where a leg has been dropped before.
  if (isEarnKind(kind) && !request.earn) return bad(`a ${kind} carried no Earn leg; it was refused rather than sent as a bare withdrawal`)
  if (request.bridge && kind !== 'bridge') return bad(`a ${kind} carried a bridge leg; it was refused rather than dropped`)
  if (request.app && !isAppKind(kind)) return bad(`a ${kind} carried an app leg; it was refused rather than dropped`)
  if (request.mail && kind !== 'mail') return bad(`a ${kind} carried a mail leg; it was refused rather than dropped`)
  if (kind === 'mail' && !request.mail) return bad('a mail carried no memo; it was refused rather than sent as a bare transfer')
  if (recipient === 0n) return bad('refusing to send to the zero address')
  const token = feltOrNull(request.token)
  if (token === null || token === 0n) return bad(`the token ${JSON.stringify(request.token)} is not a usable token address`)
  const me = feltOrNull(self)
  if (me === null || me === 0n) return bad('the sending account has no usable address')
  if (fee) {
    const feeTo = feltOrNull(fee.recipient)
    if (feeTo === null) return bad(`the relayer advertised a fee recipient that is not a felt address: ${JSON.stringify(fee.recipient)}`)
    if (feeTo === 0n) return bad('the relayer advertised a fee recipient of 0, which would burn the reimbursement')
  }
  return OK
}

/** Sum of the walk's notes for a token. Compared as felts: `0x0403…` and `0x403…` are one token. */
export function shieldedHeld(wallet: SendWalletData, token: string): bigint {
  const want = BigInt(token)
  let sum = 0n
  for (const note of wallet.notes) {
    const t = feltOrNull(note.token)
    if (t !== null && t === want) sum += note.amount
  }
  return sum
}

/**
 * The balance refusals, computed from the walk BEFORE proving. Fee token is always STRK. A short
 * fee balance in relayer mode is its own kind: self-submission fixes it and needs no shielded STRK.
 */
export function shieldedShortfall(request: SendRequest, wallet: SendWalletData, fee: FeeLeg | null): Refusal {
  const owed = new Map<string, bigint>()
  const add = (token: string, wei: bigint) => {
    const key = BigInt(token).toString()
    owed.set(key, (owed.get(key) ?? 0n) + wei)
  }
  if (!isSettlingKind(request.kind)) add(request.token, request.amount)
  if (fee) add(STRK_TOKEN, fee.feeWei)

  for (const [key, needed] of owed) {
    const token = `0x${BigInt(key).toString(16)}`
    const have = shieldedHeld(wallet, token)
    if (have >= needed) continue
    const isStrk = BigInt(key) === BigInt(STRK_TOKEN)
    if (fee && isStrk && !sameFelt(request.token, STRK_TOKEN)) {
      return {
        ok: false,
        failure: {
          kind: 'insufficient-fee-balance',
          token: STRK_TOKEN,
          symbol: 'STRK',
          feeWei: fee.feeWei,
          haveWei: have,
          shortfallWei: needed - have,
          notice: notEnoughShielded('STRK'),
        },
      }
    }
    const symbol = isStrk && !sameFelt(request.token, STRK_TOKEN) ? 'STRK' : request.symbol
    return {
      ok: false,
      failure: {
        kind: 'insufficient-balance',
        token: isStrk ? STRK_TOKEN : request.token,
        symbol,
        neededWei: needed,
        haveWei: have,
        shortfallWei: needed - have,
        notice: notEnoughShielded(symbol),
      },
    }
  }
  return OK
}
