//
// Send — a shielded transfer or a withdraw, end to end and headless (FR-016, story 1.16).
//
// This is the module that turns "the user wants to move value" into a transaction somebody has
// broadcast and the chain has accepted. It owns FIVE stages — build, prove, relay, mature,
// confirmed — and it is the only place the five are sequenced.
//
// THE FIFTH STAGE IS THE DIFFERENCE FROM REGISTRATION, and it is a protocol fact rather than
// decoration. A registration mints nothing, so there is nothing to wait for and `register.ts`
// correctly has four stages. A send mints notes, and a note is not spendable the instant the
// relayer's request returns: it has to be in pool storage, and the proving service works from
// blocks it has already ingested. So the pipeline watches for the note. It does NOT wait out a
// published duration, because there is no such duration to wait out — the deployed pool has no
// maturity view at all — it polls `get_note` until the note is there or until we stop watching,
// and says which of the two happened (FR-052).
//
// TWO SUBMIT MODES, CHOSEN BEFORE THE PROOF. In `relayer` mode the fee is reimbursed by a
// `Withdraw` leg naming the relayer, folded into the action list BEFORE it is proven — the proof
// binds the list, so only the prover's caller can add that leg, and the relayer cannot verify it
// afterwards (it never inspects `apply_actions` calldata). In `self` mode there is no
// reimbursement leg at all: the user's own account is the caller, so `collect_fee` pulls from
// their public STRK through their own in-batch approve, and their address is the sender in the
// public record. The two batches therefore differ, which is why switching modes is a re-prove
// and not a resubmit.
//
// No DOM, no React, no copy rendering. Epic 6 renders the pipeline, the Door-A transform, the
// retry ladder and the trust-boundary modal; everything here is typed data those surfaces read.
//
// Reuse is by EXPORT, not by refactor: the helpers this shares with `register.ts` are imported
// from it rather than moved into a common module. `register.ts` is a finished, reviewed story
// and extracting a shared pipeline would churn its provenance for no behaviour gain.
//

import { CallData, cairo, constants, type Call } from 'starknet'
import {
  AddressMap,
  Channel,
  // The marker for a note whose amount a later deposit writes. A symbol rather than a number so
  // it can never be confused with an amount of zero — see the swap leg in `proveSend`.
  Open,
  Witness,
  createPrivateTransfers,
  type DiscoveryProviderInterface,
  type Note,
  type PrivateRegistry,
  type PrivateTransfersUser,
  type Proof,
} from '@starkware-libs/starknet-privacy-sdk'
import { NET, STRK_TOKEN } from './constants.js'
import type { SendStage } from './pipeline-stage.js'
import { deriveViewingKey } from './identity.js'
import { CLIENT_ACTION } from './message-book.js'
import { approveCeiling } from './fee-ceiling.js'
import { invokeCalldata } from './swap-calldata.js'
import type { SwapCall } from './quote.js'
import { getNumOfChannels, getPublicKey, noteExists, readPoolHealth, type PoolHealth } from './pool.js'
import { assertBalancedActionList, assertActionListValid, type ValidatableAction } from './actions.js'
import { withFallback } from './rpc.js'
import type { FeeRecipientBody, SubmitBody } from './relayer-wire.js'
import {
  CONFIRM_TIMEOUT_MS,
  DEFAULT_APP_NAME,
  DEFAULT_RELAYER_URL,
  POOL_SEES_DISCLOSURE,
  PROVING_BLOCK_LAG,
  REAL_TIMER,
  RelayDeliveryUnknown,
  RegistrationReverted,
  assembleRegistrationCalls,
  proofBlobFrom,
  confirmFromReceipt,
  extractClientActionSpan,
  formatStrk,
  postSubmitToRelayer,
  withDeadline,
  type DeadlineTimer,
  type FeeRow,
  type RelayResponse,
} from './register.js'

// ── Stages, results, failures ─────────────────────────────────────────────────────────────

/**
 * The five stages a send passes through, in order. Five, exhaustively — and `mature` is the one
 * `RegistrationStage` does not have. See the header for why that asymmetry is a protocol fact.
 *
 * DECLARED IN `pipeline-stage.ts` AND RE-EXPORTED HERE, so that a renderer can import the union
 * without importing this module — which reaches the privacy SDK. Every existing `SendStage`
 * importer keeps working unchanged; see that file's header for the 268 kB reason.
 */
export type { SendStage } from './pipeline-stage.js'

/** Who put the transaction on chain. Both are first-class outcomes; neither is a fallback. */
export type SubmitMode = 'relayer' | 'self'

/**
 * What is being moved.
 *
 * A transfer stays shielded; a withdraw leaves the pool to a public address; a SWAP does both and
 * comes back — the sell token is withdrawn to a venue's executor, the executor is invoked, and it
 * deposits the buy token into an open note this same transaction minted. One transaction, and the
 * value never sits anywhere the user does not control.
 */
export type SendKind = 'transfer' | 'withdraw' | 'swap'

/**
 * The venue leg of a swap: where the sell token goes, and what to tell it to do.
 *
 * ── THE EXECUTOR'S SHAPE IS READ FROM THE CHAIN, NOT ASSUMED ─────────────────────────────
 *
 * `0x426dcd1a…dbe5e` declares exactly one entrypoint, confirmed against mainnet on 2026-08-27:
 *
 *     privacy_invoke(buy_token: ContractAddress, calls: Span<Call>, note_id: felt252)
 *
 * That matters because the SDK ships a DIFFERENT swap recipe in
 * `simple-private-transfers.ts`, whose executor takes four flat felts
 * `[fromToken, toToken, amount, noteId]` and does its own routing. Copying that shape onto this
 * executor would serialise a `Span<Call>` position as a token address. `swap-calldata.ts` builds
 * the layout this contract actually declares.
 */
export interface SwapLeg {
  /** The venue's privacy executor. The sell token is withdrawn HERE, not to the exchange. */
  executor: string
  /** What comes back. An open note is minted for it and the executor deposits into that note. */
  buyToken: string
  /** How the buy token is named in copy. A parameter for the same reason `symbol` is. */
  buySymbol: string
  /**
   * The route as the venue returned it, un-serialised.
   *
   * BOTH `planSend` AND `proveSend` SERIALISE IT, and that is deliberate rather than wasteful.
   * The open note's id is minted inside `createProofInvocation`, so the finished calldata cannot
   * exist at plan time — but everything BEFORE the note id can, and pinning it is what lets
   * `assertSendSpan` catch a route that changed between the plan and the proof. The plan holds
   * every felt with `null` in the note id's place; the prover fills it in.
   */
  calls: readonly SwapCall[]
  /**
   * The floor the route was quoted against, in the buy token's smallest unit.
   *
   * NOT ENFORCED HERE — the venue's own `multi_route_swap` carries the minimum and reverts below
   * it, which is the only enforcement that binds the actual swap. Carried so the receipt can say
   * what was promised, and so a surface can refuse a quote that moved.
   */
  minOutWei: bigint
}

/** Why a send stopped. Every branch is data a surface can render without inventing a sentence. */
export type SendFailure =
  /**
   * The recipient has no key in the pool, so a shielded transfer to them is impossible — the
   * pool rejects it, and no amount of retrying changes that. NOT AN ERROR STATE: it carries the
   * invite data the Door-A transform renders in place of the form.
   */
  | { kind: 'unregistered-recipient'; recipient: string; door: DoorAInvite }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  /** The inputs, not the chain: a malformed key, a zero amount, notes that do not add up. */
  | { kind: 'bad-input'; reason: string }
  /** The submit lock could not be taken. Another tab may be mid-send. */
  | { kind: 'lock-unavailable'; reason: string }
  | { kind: 'pool-paused' }
  /** The deployed class moved out from under the pin. Nothing here can be trusted across that. */
  | { kind: 'pool-upgraded'; pinned: string; onchain: string }
  /**
   * Not enough shielded balance of the token being sent. `shortfallWei` is what is missing, so
   * a surface can say the number rather than "insufficient funds".
   */
  | { kind: 'insufficient-balance'; token: string; symbol: string; neededWei: bigint; haveWei: bigint; shortfallWei: bigint; notice: string }
  /**
   * SEPARATE FROM THE ABOVE, and the separation is the point: the user has enough of what they
   * are sending and not enough shielded STRK to reimburse the relayer's fee. Same shape,
   * different sentence — and a different fix, because self-submission pays the fee from their
   * public wallet instead and needs none of this.
   */
  | { kind: 'insufficient-fee-balance'; token: string; symbol: string; feeWei: bigint; haveWei: bigint; shortfallWei: bigint; notice: string }
  | { kind: 'prover-failed'; reason: string }
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  /**
   * The relayer is reachable and wired wrong — no advertised fee recipient, a zero one, or a URL
   * that is not a submit endpoint. NOT `blocked-rpc-unknown`: nothing here is going to get
   * better by waiting, so the honest next step is self-submission, not a retry ladder.
   */
  | { kind: 'relayer-misconfigured'; reason: string; selfSubmit: SelfSubmitOffer }
  /**
   * The pool's fee rose between the pre-flight read and the moment the lock was held, so the
   * reimbursement leg already folded into the plan would under-pay the relayer. Re-proving is
   * the fix, and it is a fresh call rather than a resubmit.
   */
  | { kind: 'fee-moved'; foldedWei: bigint; currentWei: bigint }
  /** The relayer's cap on plain submissions is spent. Never a dead end — see `selfSubmit`. */
  | { kind: 'send-cap-reached'; notice: string; selfSubmit: SelfSubmitOffer }
  /**
   * The SPONSORSHIP budget answered, on a submission that never asked for sponsorship. It means
   * the relayer is metering this send against the wrong budget — a deployment mismatch — and it
   * is carried as its own branch so a send surface never renders registration copy.
   */
  | { kind: 'sponsorship-paused'; notice: string; selfSubmit: SelfSubmitOffer }
  /** The relayer cannot pay right now. Carries ITS notice verbatim, never a paraphrase. */
  | { kind: 'relayer-down'; notice: string; selfSubmit: SelfSubmitOffer }
  /** Refused BEFORE anything could have been broadcast: nothing signed, retrying is free. */
  | { kind: 'relay-refused'; status: number; reason: string }
  /**
   * Self-submission threw. The user's own wallet was the caller, so the attempt may still have
   * cost them gas — `gasLine` is the sentence that says so, and it is not optional politeness.
   */
  | { kind: 'self-submit-failed'; reason: string; gasLine: string }
  /** The chain accepted the transaction and the pool reverted it. `message` is mapped copy. */
  | { kind: 'reverted'; message: string; transactionHash: string }
  /**
   * A TRANSACTION MAY BE IN FLIGHT AND WE CANNOT ACCOUNT FOR IT. Distinct from every refusal:
   * this one means the notes may already be spent, so a retry risks a second, reverting send.
   * Also where a `mature` watch that ran out of patience lands — we stopped watching, which is
   * not the same as it having failed.
   */
  | { kind: 'confirmation-unknown'; transactionHash: string; reason: string }

/** What a surface needs to offer self-submission after a relayer branch closed. */
export interface SelfSubmitOffer {
  /** Always `'self'`: the re-run is a fresh call in the other mode, never a resubmit. */
  mode: 'self'
  /** The fee the user would pay from their PUBLIC wallet instead of reimbursing from notes. */
  feeRow: FeeRow
  /** What their address becomes visible as. Stated up front, not discovered afterwards. */
  disclosure: string
  /** Byte-exact: what a failed self-submission costs even when nothing moves. */
  gasNotice: string
}

export type SendResult =
  | {
      ok: true
      stages: SendStage[]
      transactionHash: string
      submittedBy: SubmitMode
      /** Present, and `true`, only on a self-submitted send. Permanent — see `sendShielded`. */
      selfSubmitted?: true
      feeRow: FeeRow
      /** The notes this send minted for the sender, once the pool holds them. */
      maturedNoteIds: bigint[]
      /** The block the send landed in, off the confirm receipt, or `null` if unreadable. */
      sendBlock: number | null
    }
  | { ok: false; stages: SendStage[]; failure: SendFailure; selfSubmitted?: true }

// ── Copy constants (epic 6 renders these; this story only ships them) ─────────────────────

/**
 * The Door-A transform's copy, byte-exact.
 *
 * It is a TRANSFORM, not an error: the form becomes an invitation rather than turning red,
 * because the user did nothing wrong and the recipient is reachable — just not yet here. The
 * sentence names the protocol as the thing refusing, which is true and is the only framing that
 * does not read as our bug.
 */
export interface DoorAInvite {
  message: string
  primaryAction: string
  secondaryAction: string
}

export const DOOR_A_INVITE: DoorAInvite = {
  message:
    'This address has no account on this protocol. Private funds cannot reach it — ' +
    'the protocol rejects transfers to an unregistered key.',
  primaryAction: 'Send them an invite',
  secondaryAction: 'we pay their registration',
}

/**
 * The balance relabel. "Insufficient funds" is a bank's sentence and it is wrong here twice: the
 * user may hold plenty of public {SYMBOL}, and what is short is specifically the SHIELDED side.
 * Naming the token is what lets a surface distinguish "not enough shielded STRK for the fee"
 * from "not enough shielded USDC to send".
 */
export function notEnoughShielded(symbol: string): string {
  return `Not enough shielded ${symbol}`
}

/**
 * The one sentence a failed self-submission owes the user, byte-exact.
 *
 * A relayer refusal costs the user nothing — that is the whole service. A self-submitted attempt
 * that reverts or is rejected has still been broadcast from their own account, and Starknet
 * charges for a failed execution. Leaving that unsaid is the difference between a product that
 * is honest about a tradeoff the user chose and one that quietly bills them for it.
 */
export const SELF_SUBMIT_GAS_LOSS = 'Your wallet paid network gas for the failed attempt.'

/**
 * What self-submission exposes, said before the user chooses it.
 *
 * The pool disclosure is unchanged and shared with the relayer path — the pool sees the
 * transaction either way. What self-submission adds is the sender slot in the public record.
 */
export const SELF_SUBMIT_DISCLOSURE =
  `${POOL_SEES_DISCLOSURE} Submitting it yourself puts your own address on it as the sender.`

// ── Caller-supplied wallet data (1.9 discovery is NOT a dependency) ────────────────────────

/**
 * One note the caller is offering to spend.
 *
 * DATA, NOT DISCOVERY. Story 1.9 will find these; until then whoever calls this hands them over,
 * and this module never reaches for an indexer to fill a gap — see `SEND_DISCOVERY` for what
 * happens if the SDK tries.
 */
export interface SendNoteData {
  /** The note id, as the pool stores it. */
  id: bigint
  token: string
  amount: bigint
  /** `channelKey` is the SENDER's channel to us; `nonce` is the note's index inside it. */
  witness: { channelKey: bigint; nonce: number; r: bigint }
  /** Who sent it. Carried into the registry for completeness; the compiler does not read it. */
  sender?: string
}

/** One channel the caller knows about, ours or a recipient's. */
export interface SendChannelData {
  /** The address this channel points at. Our own address for the self-channel. */
  address: string
  /** The recipient's registered public key. Required: opening a channel needs it. */
  publicKey: bigint
  /** The channel key, when the channel is already open. Absent means "this needs opening". */
  key?: bigint
  /**
   * The per-token subchannel state, EXACTLY as the pool has it. Absent tokens are ones without
   * a subchannel yet, which the plan will open.
   *
   * `noteNonce` is not decoration: a `CreateEncNote` is written at that index, and the SDK
   * defaults a missing entry to `{tokenIndex: 0, noteNonce: 0}` — which for an existing
   * subchannel is a note index that is already taken.
   */
  tokens?: { token: string; tokenIndex: number; noteNonce: number }[]
}

export interface SendWalletData {
  channels: SendChannelData[]
  notes: SendNoteData[]
}

// ── Recipient pre-flight (Door A) ─────────────────────────────────────────────────────────

/** Where a recipient address routes, decided for free before anything is built. */
export type RecipientRoute =
  | { route: 'registered'; publicKey: bigint }
  | { route: 'unregistered'; door: DoorAInvite }
  | { route: 'blocked-rpc-unknown'; reason: string }

/**
 * The free gate in front of a shielded transfer. Routes; never proves, never posts.
 *
 * FAILS CLOSED. A read that did not land is its own route and must never collapse into either
 * answer: calling it `registered` builds a note nobody can decrypt, and calling it
 * `unregistered` shows a stranger the invite screen for an account they already have.
 *
 * Not called for a WITHDRAW. A withdraw names a public address and the pool transfers to it
 * directly; requiring registration there would refuse the one send that works for anybody.
 */
export async function preflightRecipient(
  recipient: string,
  read: (address: string) => Promise<bigint> = getPublicKey,
): Promise<RecipientRoute> {
  let publicKey: bigint
  try {
    publicKey = await read(recipient)
  } catch (e) {
    return { route: 'blocked-rpc-unknown', reason: String(e) }
  }
  return publicKey === 0n
    ? { route: 'unregistered', door: DOOR_A_INVITE }
    : { route: 'registered', publicKey }
}

// ── The plan (pure: what the action list will be, before anything is built) ────────────────

export interface SendRequest {
  kind: SendKind
  /**
   * A shielded account for a transfer; any public address for a withdraw.
   *
   * FOR A SWAP THIS IS THE EXECUTOR, and it is required to equal `swap.executor`. Two fields
   * naming one address is redundancy on purpose: the withdraw leg reads `recipient` and the
   * invoke leg reads `swap.executor`, so letting them differ would withdraw to one contract and
   * instruct another — funds delivered somewhere nothing is going to call. `planSend` refuses
   * that rather than trusting the caller to keep them in step.
   */
  recipient: string
  /** For a swap, the token being SOLD. */
  token: string
  /** How the token is named in copy. A parameter: reading a symbol costs a call nobody needs. */
  symbol: string
  /** For a swap, the amount being SOLD. What comes back is the venue's business. */
  amount: bigint
  mode: SubmitMode
  /** Required when `kind` is `'swap'`, and refused on every other kind. */
  swap?: SwapLeg
}

/** The relayer's advertised reimbursement leg. Both fields are read live, never assumed. */
export interface FeeLeg {
  recipient: string
  feeWei: bigint
}

/**
 * One action the compiled span must contain, and the field values it must carry.
 *
 * `fields` runs in ABI order after the variant tag. A `null` is a field whose value the plan
 * cannot know — the compiler generates its own randomness and salts, and a note index depends on
 * nonce arithmetic inside the pool simulator. Everything else is pinned, because a variant
 * sequence alone is not a check on what will actually move: a compiler that kept the planned
 * shape and rewrote a `Withdraw` recipient, or inflated an amount, would pass a variants-only
 * assertion and pay out to the wrong address.
 */
export interface ExpectedSendAction {
  variant: number
  fields: (bigint | null)[]
}

export interface SendPlan {
  request: SendRequest
  /** `null` in self mode: there is no reimbursement leg to fold. */
  fee: FeeLeg | null
  /** Notes to spend, grouped by token in the order the builder will be given them. */
  spend: { token: string; notes: SendNoteData[] }[]
  /** Recipients whose channel this transaction opens, in emit order. */
  openChannels: string[]
  /** (recipient, token) subchannels this transaction opens, in emit order. */
  openSubchannels: { recipient: string; token: string }[]
  /** Per-token change coming back to the sender, in emit order. One `CreateEncNote` each. */
  change: { token: string; amount: bigint }[]
  /** The exact action sequence, with values, the compiled span must equal. */
  expectedActions: ExpectedSendAction[]
}

/** The planned variant sequence, for a caller that only wants the shape. */
export function plannedVariants(plan: SendPlan): number[] {
  return plan.expectedActions.map((a) => a.variant)
}

export type PlanOutcome =
  | { ok: true; plan: SendPlan }
  | { ok: false; failure: SendFailure }

/**
 * How many notes one send will spend.
 *
 * Every input note is a `UseNote` in the proven list and a nullifier the pool writes, so a batch
 * of them is real calldata and real proving work — and the relayer's allowlist caps a submission
 * at eight CALLS, which says nothing about how many actions ride inside one `apply_actions`.
 * Sixteen is chosen to be comfortably more than any ordinary send needs while refusing the
 * pathological case out loud rather than discovering it as a prover timeout. A wallet that
 * genuinely holds more dust than this needs to consolidate first — a self-transfer that spends
 * many notes and creates one — which is a send this pipeline can already make.
 */
export const MAX_INPUT_NOTES = 16

/** Felts compared as numbers: `0x0403…` and `0x403…` are one address. */
const same = (a: string, b: string) => BigInt(a) === BigInt(b)

/** A felt or nothing. Used where a malformed value must become a typed refusal, not a throw. */
function feltOrNull(value: string): bigint | null {
  try {
    // `BigInt('  ')` is 0n and `BigInt('')` is 0n, so a blank has to be refused before parsing
    // or it silently becomes the zero address.
    if (typeof value !== 'string' || value.trim() === '') return null
    return BigInt(value)
  } catch {
    return null
  }
}

/**
 * Works out the exact action list a send will compile to, and refuses — for free, before any
 * prover is called — every send that cannot work.
 *
 * PURE. It reads nothing; every live number it needs (the fee, the fee recipient, the channel
 * state, the notes) is an argument. That is what makes the whole pre-flight testable without a
 * chain, and it is why the balance refusals below can be trusted to have cost nothing.
 *
 * THE OUTPUT ORDERING IS THE SDK COMPILER'S, and it is phase-grouped rather than token-grouped.
 * `transformToClientActions` initialises one bucket per phase (`internal/compiler.js:154-164`) and
 * fills them bucket by bucket — `setViewingKey` at `:192`, `openChannels` at `:203`, `deposits` at
 * `:254`, `useNotes` at `:277`, `createNotes` at `:295`, `withdraws` at `:331` — then flattens them
 * in that declared order at `:377-379`. So driving the builder `.with(tokenA)….with(tokenB)` does
 * NOT produce a tokenA-then-tokenB span; it produces all the OpenChannels, then all the
 * OpenSubchannels, then all the UseNotes, and so on, exactly as planned here. WITHIN a phase the
 * order is builder insertion order, which `proveSend` drives in this plan's order.
 *
 * `assertSendSpan` compares the compiled span against exactly this, values included, so a plan and
 * a span that disagree stop the pipeline rather than being reconciled.
 */
export function planSend(
  request: SendRequest,
  wallet: SendWalletData,
  self: string,
  fee: FeeLeg | null,
): PlanOutcome {
  const bad = (reason: string): PlanOutcome => ({ ok: false, failure: { kind: 'bad-input', reason } })

  // A mode outside the union is not merely a type error at runtime — read as "not relayer", it
  // would build a relayer batch with no reimbursement leg, which the relayer pays for and cannot
  // detect. Refuse the value rather than letting a default decide.
  if (request.mode !== 'relayer' && request.mode !== 'self') {
    return bad(`refusing submit mode ${JSON.stringify(request.mode)}: expected 'relayer' or 'self'`)
  }
  if (request.amount <= 0n) return bad(`refusing to send ${request.amount}: an amount must be positive`)
  if (request.mode === 'relayer' && !fee) {
    return bad('relayer mode needs the advertised fee recipient and the live fee, and got neither')
  }
  if (fee && fee.feeWei <= 0n) return bad(`the relayer advertised a fee of ${fee.feeWei} wei`)

  const recipientFelt = feltOrNull(request.recipient)
  if (recipientFelt === null) return bad(`${JSON.stringify(request.recipient)} is not a felt address`)

  // ── The swap leg, checked before anything is grouped ────────────────────────────────────
  //
  // A swap leg on a non-swap kind is refused rather than ignored. An ignored field is a caller
  // who believes something is happening that is not, and here that belief is "my funds are being
  // routed somewhere" — the one misunderstanding this module must never leave standing.
  if (request.kind !== 'swap' && request.swap !== undefined) {
    return bad(`a ${request.kind} carried a swap leg; it was refused rather than dropped`)
  }
  const swap = request.kind === 'swap' ? request.swap : undefined
  if (request.kind === 'swap') {
    if (!swap) return bad('a swap needs an executor, a buy token and a route, and carried none')
    const executorFelt = feltOrNull(swap.executor)
    if (executorFelt === null) {
      return bad(`the swap executor ${JSON.stringify(swap.executor)} is not a felt address`)
    }
    if (executorFelt === 0n) {
      return bad('the swap executor is address 0, which would burn the sell amount')
    }
    // THE TWO ADDRESSES MUST AGREE. See `SendRequest.recipient`: the withdraw reads one and the
    // invoke reads the other, so a mismatch delivers the funds somewhere nothing will call.
    if (executorFelt !== recipientFelt) {
      return bad(
        `this swap withdraws to ${request.recipient} and invokes ${swap.executor}. Those must be ` +
          'the same contract — withdrawing to one and instructing another strands the sell amount.',
      )
    }
    const buyFelt = feltOrNull(swap.buyToken)
    if (buyFelt === null) {
      return bad(`the buy token ${JSON.stringify(swap.buyToken)} is not a felt address`)
    }
    if (buyFelt === 0n) return bad('the buy token is address 0')
    // Selling a token for itself is not a swap; it is a withdraw to a contract that has been
    // handed a route with nothing to route. Caught here rather than by the venue, after the fee.
    //
    // COMPARED AS FELTS, not through `canonical`, which returns UNPREFIXED hex — `BigInt()` of
    // it throws a raw SyntaxError from the middle of a planner whose whole contract is to return
    // typed refusals. Two addresses are the same address when their numbers match, whatever
    // padding or prefix either one was written with, and that is what `feltOrNull` answers.
    const sellFelt = feltOrNull(request.token)
    if (sellFelt === null) {
      return bad(`the sell token ${JSON.stringify(request.token)} is not a felt address`)
    }
    if (buyFelt === sellFelt) {
      return bad(`this swap sells ${request.symbol} for ${request.symbol}, which does nothing`)
    }
    if (swap.minOutWei <= 0n) {
      // A floor of zero is a route that may return nothing at all and still succeed. `quote.ts`
      // already refuses to compute one; this refuses to execute one that arrived anyway.
      return bad(`this swap accepts a minimum of ${swap.minOutWei}, which is no floor at all`)
    }
  }
  if (recipientFelt === 0n) return bad('refusing to send to the zero address')

  const sendTokenFelt = feltOrNull(request.token)
  if (sendTokenFelt === null) return bad(`${JSON.stringify(request.token)} is not a felt token address`)
  if (sendTokenFelt === 0n) return bad('refusing to send the zero token address')

  const selfFelt = feltOrNull(self)
  if (selfFelt === null || selfFelt === 0n) return bad(`${JSON.stringify(self)} is not a felt address`)

  const feeLeg = request.mode === 'relayer' ? fee : null
  const feeToken = STRK_TOKEN

  // The reimbursement recipient gets the SAME scrutiny as the user's recipient, and for a
  // stronger reason: it is not something the user typed and checked, it is an address a remote
  // service advertised, and it is about to be named in an irreversible `Withdraw`.
  let feeRecipientFelt: bigint | null = null
  if (feeLeg) {
    feeRecipientFelt = feltOrNull(feeLeg.recipient)
    if (feeRecipientFelt === null) {
      return bad(`the relayer advertised a fee recipient that is not a felt address: ${JSON.stringify(feeLeg.recipient)}`)
    }
    if (feeRecipientFelt === 0n) {
      return bad('the relayer advertised a fee recipient of 0, which would burn the reimbursement')
    }
  }

  // Every caller-supplied felt is parsed HERE, where a malformed one becomes a typed refusal.
  // Left to the compiler it would surface as a raw TypeError from inside a prove call.
  for (const n of wallet.notes) {
    if (feltOrNull(n.token) === null) {
      return bad(`a supplied note carries a token that is not a felt address: ${JSON.stringify(n.token)}`)
    }
  }
  for (const c of wallet.channels) {
    if (feltOrNull(c.address) === null) {
      return bad(`supplied channel data carries an address that is not a felt: ${JSON.stringify(c.address)}`)
    }
    for (const t of c.tokens ?? []) {
      if (feltOrNull(t.token) === null) {
        return bad(`supplied channel data carries a token that is not a felt: ${JSON.stringify(t.token)}`)
      }
    }
  }

  // Duplicate ids are not a harmless repeat: the same note spent twice balances as if the wallet
  // held twice the value, and the pool refuses the second nullifier write — after the fee.
  const seen = new Set<string>()
  for (const n of wallet.notes) {
    const id = n.id.toString()
    if (seen.has(id)) return bad(`note ${id} was supplied more than once; a note can only be spent once`)
    seen.add(id)
  }

  // What each token owes, and to whom. The fee is STRK whatever the send token is, so a
  // non-STRK send in relayer mode moves two tokens and needs notes for both.
  const owed = new Map<string, bigint>()
  const add = (token: string, amount: bigint) =>
    owed.set(canonical(token), (owed.get(canonical(token)) ?? 0n) + amount)
  add(request.token, request.amount)
  if (feeLeg) add(feeToken, feeLeg.feeWei)

  // Notes, grouped in the order the token builders will be created: the send token first, then
  // STRK if the fee is a second token. That order decides the emit order of everything that
  // follows, so it is fixed here rather than left to whatever the caller's array happened to be.
  const tokenOrder = [canonical(request.token)]
  if (feeLeg && !tokenOrder.includes(canonical(feeToken))) tokenOrder.push(canonical(feeToken))

  const spend: { token: string; notes: SendNoteData[] }[] = []
  const change: { token: string; amount: bigint }[] = []

  for (const key of tokenOrder) {
    const token = key === canonical(request.token) ? request.token : feeToken
    const available = wallet.notes.filter((n) => canonical(n.token) === key)
    const have = available.reduce((sum, n) => sum + n.amount, 0n)
    const need = owed.get(key) ?? 0n
    if (have < need) {
      const shortfallWei = need - have
      const isFee = feeLeg !== null && key === canonical(feeToken) && key !== canonical(request.token)
      // Two distinct failures, and never collapsed: "you cannot afford what you are sending" and
      // "you cannot afford the relayer's fee" have different fixes, and the second one is fixed
      // by self-submitting, which needs no shielded STRK at all.
      return {
        ok: false,
        failure: isFee
          ? {
              kind: 'insufficient-fee-balance',
              token: feeToken,
              symbol: 'STRK',
              feeWei: feeLeg!.feeWei,
              haveWei: have,
              shortfallWei,
              notice: notEnoughShielded('STRK'),
            }
          : {
              kind: 'insufficient-balance',
              token: request.token,
              symbol: request.symbol,
              neededWei: need,
              haveWei: have,
              shortfallWei,
              notice: notEnoughShielded(request.symbol),
            },
      }
    }
    // GREEDY, LARGEST FIRST, AND ONLY AS MANY AS THE AMOUNT NEEDS. Spending every note the
    // wallet holds would make each send a full consolidation: fifty dust notes become fifty
    // `UseNote`s, fifty nullifier writes and one enormous proof, for a transfer of three STRK.
    // Largest-first is the SDK's own strategy (`internal/compiler.js:537-540`) and it is chosen
    // there for a reason worth keeping: taking the smallest first is what lets someone raise the
    // cost of every future send by mailing a wallet dust.
    const notes: SendNoteData[] = []
    let taken = 0n
    for (const n of [...available].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))) {
      if (taken >= need) break
      notes.push(n)
      taken += n.amount
    }
    if (notes.length > MAX_INPUT_NOTES) {
      return bad(
        `this send would spend ${notes.length} notes and the limit is ${MAX_INPUT_NOTES}. ` +
          'Consolidate first — a transfer to yourself spends many notes and creates one — then ' +
          'send from the note that leaves.',
      )
    }
    spend.push({ token, notes })
    if (taken > need) change.push({ token, amount: taken - need })
  }

  // Which setup this transaction has to carry. A missing channel or subchannel is not an error —
  // it is an action, and the pool charges the same fee for the batch either way.
  const openChannels: string[] = []
  const openSubchannels: { recipient: string; token: string }[] = []

  // Every `CreateEncNote` this send emits, in the order the compiler emits them: the explicit
  // recipient note first (the token builder queued it), then the change notes the surplus
  // resolution appends, one per token in `tokenOrder`. The amount rides along rather than being
  // recovered by index arithmetic later — the index that would take is exactly the kind of
  // off-by-one that puts the wrong number in an irreversible note.
  const noteRecipients: { address: string; token: string; amount: bigint }[] = []
  if (request.kind === 'transfer') {
    noteRecipients.push({ address: request.recipient, token: request.token, amount: request.amount })
  }
  for (const c of change) noteRecipients.push({ address: self, token: c.token, amount: c.amount })

  /**
   * Every (recipient, token) pair this transaction mints a note into, INCLUDING the swap's open
   * note — which is not in `noteRecipients` because it is not a `CreateEncNote`.
   *
   * The distinction is why this is a second list rather than an extra entry in the first. Both
   * kinds of note need their channel and subchannel to exist, and only one of them contributes a
   * `CreateEncNote` to the span; folding the open note into `noteRecipients` would put a
   * `CreateEncNote` in the plan for a note the compiler emits as `CreateOpenNote`, and
   * `assertSendSpan` would refuse the send it just planned.
   */
  const noteChannels: { address: string; token: string }[] = noteRecipients.map((r) => ({
    address: r.address,
    token: r.token,
  }))
  if (swap) noteChannels.push({ address: self, token: swap.buyToken })

  /** The public key each note recipient is registered under, in `noteRecipients` order. */
  const noteRecipientKeys: bigint[] = []
  for (const [index, { address, token }] of noteChannels.entries()) {
    const channel = wallet.channels.find((c) => same(c.address, address))
    if (!channel) {
      return bad(
        `no channel data was supplied for ${address}; a note cannot be created without the ` +
          "recipient's public key and channel state",
      )
    }
    if (channel.publicKey === 0n) {
      return bad(`the channel data for ${address} carries a public key of 0`)
    }
    // KEYED BY INDEX AGAINST `noteRecipients`, not by push order. The swap's open note rides in
    // `noteChannels` for its channel setup and contributes no `CreateEncNote`, so pushing
    // unconditionally would append a key that belongs to no note. It happens to be harmless while
    // the open note is last — which is exactly the kind of accident that stops being true.
    if (index < noteRecipients.length) noteRecipientKeys.push(channel.publicKey)
    if (channel.key === undefined && !openChannels.some((a) => same(a, address))) {
      openChannels.push(address)
    }
    const hasSubchannel =
      channel.key !== undefined && (channel.tokens ?? []).some((t) => same(t.token, token))
    if (!hasSubchannel && !openSubchannels.some((s) => same(s.recipient, address) && same(s.token, token))) {
      openSubchannels.push({ recipient: address, token })
    }
  }

  // The expected span, VALUES INCLUDED, in the compiler's phase order. Field lists run in ABI
  // order after the variant tag; `null` marks a field only the compiler can know — its own
  // randomness and salts, and a note index that depends on nonce arithmetic inside the pool
  // simulator. Everything a plan can know is pinned, so a compiler that keeps the shape and
  // rewrites a recipient or an amount is caught here rather than on chain.
  const expectedActions: ExpectedSendAction[] = []

  // OpenChannelInput { recipient_addr, index, random, salt }. The index is checked separately
  // against the LIVE channel count by `assertChannelIndices`, which is the number that matters.
  openChannels.forEach((address) => {
    expectedActions.push({ variant: CLIENT_ACTION.OpenChannel, fields: [BigInt(address), null, null, null] })
  })
  // OpenSubchannelInput { recipient_addr, recipient_public_key, channel_key, index, token, salt }.
  // The channel key and the token index are the compiler's arithmetic; the parties and the token
  // are ours.
  openSubchannels.forEach(({ recipient, token }) => {
    const channel = wallet.channels.find((c) => same(c.address, recipient))
    expectedActions.push({
      variant: CLIENT_ACTION.OpenSubchannel,
      fields: [BigInt(recipient), channel?.publicKey ?? null, null, null, BigInt(token), null],
    })
  })
  // UseNoteInput { channel_key, token, index }. All three come off the note's own witness, so
  // all three are pinned: this is what stops a compiler substituting a different note.
  for (const s of spend) {
    for (const n of s.notes) {
      expectedActions.push({
        variant: CLIENT_ACTION.UseNote,
        fields: [n.witness.channelKey, BigInt(s.token), BigInt(n.witness.nonce)],
      })
    }
  }
  // CreateEncNoteInput { recipient_addr, recipient_public_key, token, amount, index, salt }.
  noteRecipients.forEach(({ address, token, amount }, i) => {
    expectedActions.push({
      variant: CLIENT_ACTION.CreateEncNote,
      fields: [BigInt(address), noteRecipientKeys[i]!, BigInt(token), amount, null, null],
    })
  })
  // CreateOpenNoteInput { recipient_addr, recipient_public_key, token, index, salt }.
  //
  // NO AMOUNT FIELD, and that absence is the whole mechanism: an open note is a slot whose value
  // is written by whatever deposits into it later. Here that is the executor, which is handed this
  // note's id and pays the swap proceeds straight in. `actions.ts` gives the variant a balance
  // sign of 0 for the same reason — nothing has been committed at compile time.
  //
  // EMITTED AFTER the change notes because both are in the compiler's `createNotes` phase and
  // within a phase the order is builder insertion order — `proveSend` drives the sell token's
  // builder first and reaches `.with(buyToken)` after it.
  if (swap) {
    const buyChannel = wallet.channels.find((c) => same(c.address, self))
    expectedActions.push({
      variant: CLIENT_ACTION.CreateOpenNote,
      fields: [BigInt(self), buyChannel?.publicKey ?? null, BigInt(swap.buyToken), null, null],
    })
  }
  // WithdrawInput { to_addr, token, amount, random }. The user's leg first, then the relayer's
  // reimbursement — the order `proveSend` drives the builder in.
  //
  // A SWAP WITHDRAWS TOO, and to the executor. This is the leg that puts real value in a contract
  // this app does not control, which is why `recipientFelt` is pinned here and cross-checked
  // against `swap.executor` above: the whole safety of the sandwich is that the same transaction
  // that hands the funds over also contains the instruction to give them back.
  if (request.kind === 'withdraw' || request.kind === 'swap') {
    expectedActions.push({
      variant: CLIENT_ACTION.Withdraw,
      fields: [recipientFelt, BigInt(request.token), request.amount, null],
    })
  }
  if (feeLeg) {
    expectedActions.push({
      variant: CLIENT_ACTION.Withdraw,
      fields: [feeRecipientFelt!, BigInt(feeToken), feeLeg.feeWei, null],
    })
  }
  // InvokeExternalInput { contract_address, calldata_len, ...calldata }.
  //
  // EVERY FELT IS PINNED EXCEPT THE LAST. The route is known now; only the open note's id is the
  // compiler's, so it is the one `null`. That means a venue or a compiler that rewrote a call
  // target, a selector or an amount between the plan and the proof is caught by `assertSendSpan`
  // before a fee is paid — which matters more here than anywhere else in this file, because these
  // are the felts that decide what a contract holding real withdrawn funds is told to do.
  //
  // Serialised through the same `invokeCalldata` the prover uses, with a placeholder note id, so
  // the two cannot disagree about layout. Its refusals are the closed-selector safety property:
  // an entrypoint this app has not verified never reaches a plan at all.
  if (swap) {
    const shape = invokeCalldata({
      buyToken: swap.buyToken,
      calls: swap.calls,
      // A stand-in purely to make the array the right length. Its VALUE is discarded below —
      // the felt it occupies becomes `null`, which is what tells `assertSendSpan` not to compare.
      openNoteId: '0x0',
    })
    if (shape.state === 'refused') return bad(shape.because)

    const felts: (bigint | null)[] = shape.calldata.map((felt) => BigInt(felt))
    // The note id, blanked. `pop`-then-push rather than index arithmetic: `invokeCalldata`
    // guarantees it is last and nothing here should re-derive where "last" is.
    felts[felts.length - 1] = null

    expectedActions.push({
      variant: CLIENT_ACTION.InvokeExternal,
      fields: [BigInt(swap.executor), BigInt(shape.calldata.length), ...felts],
    })
  }

  const plan: SendPlan = {
    request,
    fee: feeLeg,
    spend,
    openChannels,
    openSubchannels,
    change,
    expectedActions,
  }

  // The same list, in the vocabulary `actions.ts` checks, run through both protocol invariants
  // before a prover is paid any attention. The balance one is the substantive check: the pool
  // demands every token close at exactly zero (FINAL_BALANCE_MUST_BE_ZERO), so a plan whose
  // change note is a wei out is a batch we would pay a fee to have rejected.
  try {
    const validatable = planToValidatableActions(plan)
    assertActionListValid(validatable)
    assertBalancedActionList(validatable)
  } catch (e) {
    return bad(String(e))
  }

  return { ok: true, plan }
}

/** One token, one bucket, whatever hex spelling it arrived in. */
function canonical(token: string): string {
  return BigInt(token).toString(16)
}

/**
 * The plan in `actions.ts`'s vocabulary, so the protocol invariants can be run against it.
 *
 * Written out in the SDK's emit order rather than the plan's field order, because the phase rule
 * and the intermediate-balance rule are both order-sensitive — checking a differently-ordered
 * copy would be checking a list nobody is going to build.
 */
export function planToValidatableActions(plan: SendPlan): ValidatableAction[] {
  const { request, fee, spend, openChannels, openSubchannels, change } = plan
  const out: ValidatableAction[] = []
  // The index each channel opens at is checked live in `proveSend`, against the pool's own
  // count; here they only have to be sequential, which is the invariant `actions.ts` holds.
  openChannels.forEach((_, i) => out.push({ type: 'OpenChannel', index: i }))
  openSubchannels.forEach(() => out.push({ type: 'OpenSubchannel' }))
  for (const s of spend) {
    for (const n of s.notes) out.push({ type: 'UseNote', token: s.token, amount: n.amount })
  }
  if (request.kind === 'transfer') {
    out.push({ type: 'CreateEncNote', token: request.token, amount: request.amount })
  }
  for (const c of change) out.push({ type: 'CreateEncNote', token: c.token, amount: c.amount })
  // Amount ZERO, and it has to be. An open note commits nothing at compile time — the executor
  // writes its value later — so `actions.ts` gives the variant a balance sign of 0 and its
  // zero-amount rule expects exactly this. Putting the expected proceeds here instead would make
  // the buy token look like it arrived out of nowhere and fail the balance invariant.
  if (request.kind === 'swap' && request.swap) {
    out.push({ type: 'CreateOpenNote', token: request.swap.buyToken, amount: 0n })
  }
  if (request.kind === 'withdraw' || request.kind === 'swap') {
    out.push({ type: 'Withdraw', token: request.token, amount: request.amount })
  }
  if (fee) out.push({ type: 'Withdraw', token: STRK_TOKEN, amount: fee.feeWei })
  if (request.kind === 'swap') out.push({ type: 'InvokeExternal' })
  return out
}

// ── The discovery shim and the hand-assembled registry ────────────────────────────────────

/**
 * Discovery that answers ONE question from caller data and refuses the rest.
 *
 * The SDK reaches for discovery in exactly one situation this path creates: opening a channel
 * needs the recipient's public key AND the sender's outgoing-channel count, and the compiler
 * asks the discovery provider for both (`internal/compiler.js:430-441`). Story 1.9 has not
 * shipped, so the answer comes from what the caller handed us plus one free pool view.
 *
 * `discoverNotes` and `discoverRequirement` THROW. A silently empty stub would let the compiler
 * decide it had found nothing and carry on building a different transaction than the one that
 * was planned — the failure would be a wrong list, not a missing service.
 *
 * A TRAP WORTH NAMING: the compiler drops the channel count whenever every recipient it asked
 * about already has an open channel (`compiler.js:432-434`), and a dropped count becomes a
 * `PoolSimulator` seeded at index 0 — which is `INDEX_NOT_SEQUENTIAL` on the first send from any
 * account that has ever opened a channel. This shim cannot prevent that; what protects against
 * it is that a channel we are OPENING has no key, so the drop cannot trigger, plus the explicit
 * index check in `proveSend` that compares the compiled index against the live count.
 */
export function makeSendDiscovery(
  wallet: SendWalletData,
  channelCount: number,
): DiscoveryProviderInterface {
  return {
    discoverNotes: async () => {
      throw new Error(
        'a send must not reach discovery: discoverNotes was called, but notes are caller-supplied data',
      )
    },
    discoverChannels: async (_address, _viewingKey, recipients) => {
      const channels = new AddressMap<Channel>()
      // `'total-only'` asks for the count and nothing else; `'all'` asks for every outgoing
      // channel, which for this shim is every one the caller supplied. Answering `'all'` with
      // an empty map would be a silent wrong answer rather than a missing service — the same
      // trap `discoverNotes` throws to avoid.
      const wanted =
        recipients === 'total-only'
          ? []
          : recipients === 'all'
            ? wallet.channels.map((c) => BigInt(c.address))
            : [...recipients]
      for (const r of wanted) {
        const found = wallet.channels.find((c) => same(c.address, String(r)))
        if (found) channels.set(r, toSdkChannel(found))
      }
      // `total` is the sender's live outgoing-channel count, which IS the index a new channel
      // must take. Reported on every answer so the compiler never has to ask twice.
      return { timestamp: 'latest' as const, channels, total: channelCount }
    },
    discoverRequirement: async () => {
      throw new Error(
        'a send must not reach discovery: discoverRequirement was called, but the setup a send ' +
          'needs is decided by planSend from caller data',
      )
    },
  }
}

/** One caller-supplied channel as the SDK's own `Channel`, nonces included. */
export function toSdkChannel(data: SendChannelData): Channel {
  return new Channel(
    data.publicKey,
    data.key,
    // Supplied explicitly, never defaulted. `Channel.tokens` hands out
    // `{tokenIndex: 0, noteNonce: 0}` for a token it does not know, and using that for a
    // subchannel that already holds notes writes the new note at an index that is taken.
    (data.tokens ?? []).map((t) => [t.token, { tokenIndex: t.tokenIndex, noteNonce: t.noteNonce }]),
  )
}

/**
 * The registry the compiler resolves context from — hand-assembled from the SDK's root exports.
 *
 * WHAT IS DELIBERATELY LEFT OUT: any channel the plan is going to OPEN. Leaving it out is what
 * routes the compiler through `makeSendDiscovery`, which is the only path that also carries the
 * channel count; putting it in makes the compiler short-circuit before discovery is ever asked
 * and seed the new channel's index at zero.
 *
 * Notes are not put in either. They ride in through `.inputs()`, and the compiler adopts an
 * explicit note it does not recognise (`compiler.js:287-290`) rather than refusing it.
 */
export function buildSendRegistry(wallet: SendWalletData, opening: readonly string[]): PrivateRegistry {
  const channels = new AddressMap<Channel>()
  for (const c of wallet.channels) {
    if (opening.some((a) => same(a, c.address))) continue
    if (c.key === undefined) continue   // an unopened channel is context the compiler cannot use
    channels.set(c.address, toSdkChannel(c))
  }
  return { channels, notes: new AddressMap<Note[]>(() => []) }
}

/** One caller-supplied note as the SDK's own `Note`. */
export function toSdkNote(data: SendNoteData, self: string): Note {
  return {
    id: data.id,
    amount: data.amount,
    witness: new Witness(data.witness.channelKey, data.witness.nonce, data.witness.r),
    sender: data.sender ?? self,
  }
}

// ── Span assertions ───────────────────────────────────────────────────────────────────────

/**
 * How many felts each `ClientAction` variant occupies, the variant tag included.
 *
 * Read off the deployed pool's ABI (`privacy::actions::*Input`), where every member — felt252,
 * ContractAddress, u32 and u128 alike — is exactly one felt. The two invoke variants carry a
 * `Span<felt252>` and so have no fixed width; they are absent on purpose, and reaching one is
 * refused rather than measured, because a send never carries an invoke.
 */
export const CLIENT_ACTION_FELTS: Record<number, number> = {
  [CLIENT_ACTION.SetViewingKey]: 2,
  [CLIENT_ACTION.OpenChannel]: 5,
  [CLIENT_ACTION.OpenSubchannel]: 7,
  [CLIENT_ACTION.CreateEncNote]: 7,
  [CLIENT_ACTION.CreateOpenNote]: 6,
  [CLIENT_ACTION.Deposit]: 3,
  [CLIENT_ACTION.UseNote]: 4,
  [CLIENT_ACTION.Withdraw]: 5,
}

const VARIANT_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(CLIENT_ACTION).map(([name, index]) => [index, name]),
)

const describeVariant = (v: number) => VARIANT_NAME[v] ?? `variant ${v}`

/** The felt width of one variant, or a throw naming why it has none. ONE lookup, both callers. */
function variantWidth(variant: number): number {
  const width = CLIENT_ACTION_FELTS[variant]
  if (width === undefined) {
    throw new Error(
      `refusing a compiled span carrying ${describeVariant(variant)}: it has no fixed felt width, ` +
        'and a send never carries one',
    )
  }
  return width
}

/**
 * The width of the action starting at `at`, READ OUT OF THE SPAN rather than looked up.
 *
 * ── WHY A SECOND WIDTH FUNCTION EXISTS AT ALL ─────────────────────────────────────────────
 *
 * Every action the send pipeline used to carry has a fixed width, so a table was enough and
 * anything absent from it was refused — correctly, because a send never carried an invoke.
 *
 * A SWAP DOES. `InvokeExternal` is `[variant, contract_address, calldata_len, ...calldata]`, whose
 * width depends on a value inside itself. That is not a hole in the table that a new row could
 * fill; it is a different kind of measurement, and it needs the span in hand.
 *
 * ── THE TABLE IS STILL THE AUTHORITY FOR EVERYTHING ELSE ──────────────────────────────────
 *
 * Fixed variants still go through `variantWidth`, so an unknown variant is still refused rather
 * than guessed at, and a serde change to any existing action still fails loudly. The only variant
 * this adds is the one whose length prefix is self-describing.
 */
function actionWidthAt(span: readonly bigint[], at: number): number {
  const variant = Number(span[at]!)
  if (variant !== CLIENT_ACTION.InvokeExternal) return variantWidth(variant)

  // `[variant, contract_address, calldata_len, ...calldata]` — the prefix is at `at + 2`.
  const declared = span[at + 2]
  if (declared === undefined) {
    throw new Error(
      'refusing a compiled span whose InvokeExternal ends before its calldata length: there is ' +
        'nothing to measure the rest of the action against',
    )
  }
  // A hostile or corrupt length would otherwise walk the cursor past the end of the span, or into
  // a negative index, and every subsequent action would be read from the wrong offset.
  if (declared < 0n || declared > BigInt(span.length)) {
    throw new Error(
      `refusing a compiled InvokeExternal declaring ${declared} calldata felt(s) in a span of ` +
        `${span.length}: the length prefix is what the rest of the walk depends on`,
    )
  }
  return 3 + Number(declared)
}

/**
 * The felts these actions must occupy in a compiled span, the leading count felt included.
 *
 * `assertSendSpan` walks the span with the same `variantWidth`, so there is one width
 * implementation rather than two that could disagree about what a serde change means.
 */
export function expectedSpanFelts(actions: readonly (ExpectedSendAction | number)[]): number {
  return actions.reduce<number>((n, a) => n + plannedWidth(a), 1)
}

/**
 * The width one PLANNED action will occupy.
 *
 * For a fixed variant this is the table. For `InvokeExternal` the plan itself carries every felt —
 * contract address, length prefix and calldata — so its width is self-describing, and that is what
 * makes a variable-width action checkable at all: the plan states the length, and the span is held
 * to it.
 *
 * A bare variant number cannot describe an invoke (there are no fields to count), so that combination
 * is refused rather than assumed.
 */
function plannedWidth(action: ExpectedSendAction | number): number {
  if (typeof action === 'number') return variantWidth(action)
  if (action.variant !== CLIENT_ACTION.InvokeExternal) return variantWidth(action.variant)
  return action.fields.length + 1
}

/**
 * Throws unless the compiled span is EXACTLY the action list that was planned — the values in it
 * included.
 *
 * This is the check that makes the plan mean something. Between `planSend` and the prover sits
 * the SDK's compiler, which will silently add actions when it is asked to: `autoRegister`
 * appends a `SetViewingKey`, `autoSetup` appends an `OpenChannel`, `autoSelectNotes` appends
 * `UseNote`s of its own choosing. None of those options are set here — and "none of those
 * options are set" is a claim about a call site, whereas this is a measurement of what came out.
 *
 * THREE THINGS, and the third is the one a variant-only check misses. The sequence catches an
 * action that should not be there at all. The felt count catches an action of the right kind
 * carrying the wrong number of fields, which is what a serde change looks like and is otherwise
 * invisible until the pool rejects the calldata. And the FIELD VALUES catch the case that costs
 * money without changing the shape: a `Withdraw` whose recipient was rewritten, or an amount
 * inflated between the plan and the proof. `null` fields are the ones only the compiler can know
 * — its randomness, its salts, a note index that depends on nonce arithmetic — and those are the
 * only felts inside a planned action that go unchecked.
 */
export function assertSendSpan(
  span: readonly bigint[],
  expected: readonly ExpectedSendAction[],
): void {
  const declared = span[0]
  if (declared === undefined) {
    throw new Error('refusing an empty compiled span: there is no action count in it')
  }
  if (declared !== BigInt(expected.length)) {
    throw new Error(
      `refusing a compiled span of ${declared} action(s): the send was planned as ` +
        `${expected.length} — [${expected.map((a) => describeVariant(a.variant)).join(', ')}]`,
    )
  }

  let at = 1
  for (let i = 0; i < expected.length; i++) {
    const plannedAction = expected[i]!
    const actual = span[at]
    if (actual === undefined) {
      throw new Error(
        `refusing a compiled span that ends mid-action: expected ` +
          `${describeVariant(plannedAction.variant)} at felt ${at}`,
      )
    }
    const variant = Number(actual)
    if (variant !== plannedAction.variant) {
      throw new Error(
        `refusing a compiled span whose action ${i} is ${describeVariant(variant)}: the send was ` +
          `planned to have ${describeVariant(plannedAction.variant)} there`,
      )
    }
    // Measured out of the span for a variable-width action, looked up for every other. The two are
    // then required to AGREE with what the plan described — which is what stops a compiler from
    // lengthening an invoke's calldata between the plan and the proof.
    const width = actionWidthAt(span, at)
    const planned = plannedWidth(plannedAction)
    if (width !== planned) {
      throw new Error(
        `refusing a compiled ${describeVariant(variant)} at action ${i} occupying ${width} felt(s): ` +
          `the send was planned with ${planned}`,
      )
    }
    if (plannedAction.fields.length !== width - 1) {
      // A plan that describes a different number of fields than the ABI has is a bug in this
      // module, not in the compiler — say so rather than silently checking a prefix.
      throw new Error(
        `the plan describes ${plannedAction.fields.length} field(s) for ` +
          `${describeVariant(variant)}, but its ABI has ${width - 1}`,
      )
    }
    for (let f = 0; f < plannedAction.fields.length; f++) {
      const wanted = plannedAction.fields[f]!
      if (wanted === null) continue
      const got = span[at + 1 + f]
      if (got !== wanted) {
        throw new Error(
          `refusing a compiled ${describeVariant(variant)} at action ${i}: field ${f} is ${got}, ` +
            `and the send was planned with ${wanted} there`,
        )
      }
    }
    at += width
  }

  if (at !== span.length) {
    throw new Error(
      `refusing a compiled span of ${span.length} felts: the planned actions account for ${at}, ` +
        `so ${span.length - at} felt(s) went uninspected`,
    )
  }
}

/**
 * Serde `Option::None`. Cairo writes an `Option` as a variant index followed by the payload, and
 * `None` is index 1 with nothing after it.
 */
const OPTION_NONE = 1n

/**
 * Throws unless the proven call is the `apply_actions` this pipeline expects, screening suffix
 * and all.
 *
 * THREE THINGS, and the first one is what makes the other two sound:
 *
 *   - The proof's payload begins with the class hash of the pool it was compiled against
 *     (`send_message_to_server` in the pool's own `utils.cairo`), so comparing it to the pinned
 *     hash is how we learn the pool did not change under us between the pin and this proof.
 *   - A screening-capable pool takes a trailing `Option<ScreeningAttestation>` and the SDK
 *     appends one whenever the class hash is not on its pre-screening list. The pinned class is
 *     not on that list, so exactly one trailing felt is expected — and if the class hash check
 *     above passed, that expectation is about a known contract rather than a guess.
 *   - It must be `None`. The pool asserts `screening.is_none()` on any batch with no deposit in
 *     it (`UNEXPECTED_SCREENING`), and a send never deposits. An attestation riding along here
 *     would be a revert we had already paid the gas for.
 */
export function assertProvenSendCall(call: Call, proof: Proof): void {
  if (
    typeof call?.contractAddress !== 'string' ||
    feltOrNull(call.contractAddress) === null ||
    BigInt(call.contractAddress) !== BigInt(NET.pool) ||
    call.entrypoint !== 'apply_actions'
  ) {
    throw new Error(
      `refusing a proven ${call?.entrypoint} on ${call?.contractAddress}: expected apply_actions on the pool`,
    )
  }
  // Named-argument calldata cannot be read positionally, and a missing one is not an empty one.
  // Left unguarded this is a `TypeError: Cannot read properties of undefined` thrown from inside
  // what the caller experiences as a proof check — which routes to `prover-failed` carrying a
  // stack trace instead of a sentence.
  if (!Array.isArray(call.calldata)) {
    throw new Error(
      'refusing a proven apply_actions whose calldata is not an array this pipeline can inspect',
    )
  }
  if (!Array.isArray(proof?.output)) {
    throw new Error('refusing a proof that carries no output payload to check the pool class against')
  }
  const provenClass = proof.output[0]
  if (provenClass === undefined || BigInt(provenClass) !== BigInt(NET.poolClassHash)) {
    throw new Error(
      `refusing a proof compiled against pool class ${provenClass}: this build is pinned to ` +
        `${NET.poolClassHash}, and every rule this pipeline enforces was measured against that class`,
    )
  }
  const calldata = call.calldata as string[]
  const serverActions = proof.output.length - 1
  if (calldata.length !== serverActions + 1) {
    throw new Error(
      `refusing an apply_actions of ${calldata.length} felts: the proof carries ${serverActions} ` +
        'server-action felts, which with the screening Option should be exactly one more',
    )
  }
  const suffix = calldata[calldata.length - 1]
  if (suffix === undefined || BigInt(suffix) !== OPTION_NONE) {
    throw new Error(
      `refusing an apply_actions whose screening Option is ${suffix}: a send makes no deposit, ` +
        'so the pool requires None and rejects anything else as UNEXPECTED_SCREENING',
    )
  }
}

// ── Build + prove ─────────────────────────────────────────────────────────────────────────

export interface ProveSendInput {
  /** The root account key. A parameter — never read from storage here; 1.11 owns that. */
  accountKey: string
  /** The connected wallet: `{ address, signer }`. Signs one FREE view invocation. */
  account: PrivateTransfersUser
  provingBlockId: number
  plan: SendPlan
  wallet: SendWalletData
  /** The sender's live outgoing-channel count — the index a new channel must take. */
  channelCount: number
}

export interface ProvedSend {
  call: Call
  proofFacts: string[]
  /**
   * The proof blob the facts belong to. The sequencer takes `proof_facts` and `proof`
   * together or not at all (verified live in story 1.13's first real broadcast), so a
   * proven send must carry both — see `ProvedRegistration.proof` for the full account.
   */
  proof: string
  provingBlockId: number
  /** Notes this send mints for the sender, read off the registry the SDK handed back. */
  mintedNoteIds: bigint[]
}

/**
 * Builds and proves the planned send.
 *
 * NO AUTO-OPTIONS. `autoRegister`, `autoSetup`, `autoSelectNotes` and `autoDiscover` each change
 * the compiled action list, and every one of them would change it away from the plan whose
 * balance was checked for free. They are omitted rather than passed as `false`, which is
 * stronger: there is no key here for a later edit to flip.
 *
 * OHTTP is on, for the same reason registration turns it on: without it the proving service sees
 * the visitor's IP alongside the exact amounts and addresses being moved.
 */
export async function proveSend(input: ProveSendInput): Promise<ProvedSend> {
  const { plan, wallet, account } = input
  const self = String(account.address)
  const viewingKey = deriveViewingKey(input.accountKey, NET.chainId, NET.pool)
  const registry = buildSendRegistry(wallet, plan.openChannels)

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: {
      url: NET.prover,
      chainId: NET.chainId as constants.StarknetChainId,
      ohttp: true,
    },
    discoveryProvider: makeSendDiscovery(wallet, input.channelCount),
    poolContractAddress: NET.pool,
  })

  // `{ registry }` AND NOTHING ELSE. The registry is how the compiler resolves the channels we
  // already hold without asking anyone; every other `ExecuteOptions` key is an auto-behaviour
  // that would change the list away from the plan, so none is passed — not even as `false`,
  // which would be a key a later edit could flip. The registry is mutated in place and handed
  // back, which is where the ids of the notes this send mints come from.
  const builder = transfers.build({ registry })
  // Every channel the plan opens, in the plan's order — which is the order the compiler emits
  // them in, and therefore the order `assertSendSpan` expects.
  for (const recipient of plan.openChannels) builder.setup(recipient)
  // The change note comes back to us, so the surplus recipient is us. This is also what makes
  // the SDK fail fast on a shortfall rather than proving a list the pool would reject.
  builder.surplusTo(self)

  for (const { token, notes } of plan.spend) {
    const t = builder.with(token)
    for (const s of plan.openSubchannels) {
      if (same(s.token, token)) t.setup(s.recipient)
    }
    t.inputs(...notes.map((n) => toSdkNote(n, self)))
    if (same(token, plan.request.token)) {
      if (plan.request.kind === 'transfer') {
        t.transfer({ recipient: plan.request.recipient, amount: plan.request.amount })
      } else {
        // A SWAP TAKES THIS BRANCH TOO. Its recipient is the executor, checked in `planSend` to
        // be the same contract the invoke leg names — so this is the leg that hands the sell
        // amount over, and the invoke below is the instruction to give it back.
        t.withdraw({ recipient: plan.request.recipient, amount: plan.request.amount })
      }
    }
    if (plan.fee && same(token, STRK_TOKEN)) {
      // The reimbursement leg, folded in BEFORE the proof binds the list. The recipient is the
      // address the relayer advertised and the amount is the fee it quoted; neither is a
      // constant here, and the relayer cannot add either one itself after the fact.
      t.withdraw({ recipient: plan.fee.recipient, amount: plan.fee.feeWei })
    }
  }

  // ── The swap sandwich: the open note, then the instruction to fill it ────────────────────
  //
  // Driven AFTER every spend builder so the compiler's `createNotes` phase sees the buy token's
  // builder last, which is the order `planSend` writes the open note into `expectedActions`.
  // Within a phase the compiler preserves builder insertion order, so these two orders are the
  // same statement made twice — and `assertSendSpan` refuses the send if they ever stop being.
  const swapLeg = plan.request.kind === 'swap' ? plan.request.swap : undefined
  if (swapLeg) {
    const buy = builder.with(swapLeg.buyToken)
    for (const s of plan.openSubchannels) {
      if (same(s.token, swapLeg.buyToken)) buy.setup(s.recipient)
    }
    // `Open` is the SDK's marker for a note whose amount is written by a later deposit — here,
    // the executor's. It is a symbol rather than a number precisely so it cannot be confused with
    // an amount of zero, which would be a note committing to nothing and staying that way.
    buy.transfer({ recipient: self, amount: Open })

    // ONE INVOKE PER TRANSACTION — the SDK enforces it (`builders.ts:214`) and this is that one.
    // The callback runs inside the compiler, after the open note has an id, which is the only
    // moment the calldata can be completed.
    builder.invoke(({ openNotes }) => {
      const note = openNotes[0]
      if (note === undefined) {
        // The compiler produced no open note despite being asked for one. Nothing downstream can
        // recover from that: an invoke naming a note id that does not exist withdraws the sell
        // amount to a contract with no way to return it.
        throw new Error(
          'the compiler minted no open note for the buy token, so there is nowhere for the swap ' +
            'proceeds to land — refusing to invoke.',
        )
      }
      const built = invokeCalldata({
        buyToken: swapLeg.buyToken,
        calls: swapLeg.calls,
        // `invokeCalldata` normalises through `BigInt` itself, so the note id goes over as the
        // decimal a bigint stringifies to rather than being hand-formatted here. One conversion,
        // in one place, is the whole reason that function does its own normalising.
        openNoteId: String(note.noteId),
      })
      if (built.state === 'refused') throw new Error(built.because)
      return { contractAddress: swapLeg.executor, calldata: [...built.calldata] }
    })
  }

  const invocation = await builder.createProofInvocation({ provingBlockId: input.provingBlockId })
  const span = extractClientActionSpan(invocation.invocation.calldata)
  assertSendSpan(span, plan.expectedActions)
  assertChannelIndices(span, input.channelCount)

  const { callAndProof, registry: after } = await transfers.executeWithInvocation(
    invocation,
    input.provingBlockId,
  )
  const { call, proof } = callAndProof
  assertProvenSendCall(call, proof)

  const proofFacts = [...proof.proofFacts]
  if (proofFacts.length === 0) {
    throw new Error('the prover returned no proof facts; the pool will not accept the transaction')
  }
  const bad = proofFacts.findIndex((f) => typeof f !== 'string' || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(f))
  if (bad !== -1) {
    throw new Error(`the prover returned a proof fact that is not a felt at index ${bad}: ${String(proofFacts[bad])}`)
  }
  return {
    call,
    proofFacts,
    // Same rule, same helper, same free failure point as registration: the sequencer
    // rejects facts without their blob. See `proofBlobFrom` in register.ts.
    proof: proofBlobFrom(proof),
    provingBlockId: input.provingBlockId,
    mintedNoteIds: mintedNoteIds(after, wallet),
  }
}

/**
 * Throws unless every `OpenChannel` in the span takes the index the pool will demand.
 *
 * `open_channel` asserts the index equals the sender's live outgoing-channel count and reverts
 * `INDEX_NOT_SEQUENTIAL` otherwise — probed live, see ACTION_LIST_EVIDENCE. The compiler seeds
 * that counter from whatever discovery reported and drops the report in one case
 * (`compiler.js:432-434`), so the number that actually got compiled in is checked here against
 * the number that was read, rather than assumed to be the same.
 *
 * `OpenChannel` is `[variant, recipient_addr, index, random, salt]`, so the index is the second
 * field of the item.
 */
export function assertChannelIndices(span: readonly bigint[], channelCount: number): void {
  let at = 1
  let expected = BigInt(channelCount)
  while (at < span.length) {
    const variant = Number(span[at]!)
    if (variant === CLIENT_ACTION.OpenChannel) {
      const index = span[at + 2]
      if (index !== expected) {
        throw new Error(
          `refusing an OpenChannel at index ${index}: the pool holds ${channelCount} channel(s) ` +
            `for this sender, so the next one must be ${expected} or it reverts INDEX_NOT_SEQUENTIAL`,
        )
      }
      expected += 1n
    }
    // Walks a variable-width invoke by reading its length prefix, and still THROWS on a variant
    // it cannot measure at all. This function is exported, so a standalone caller must not get a
    // silent pass on a span the walk has lost its place in.
    at += actionWidthAt(span, at)
  }
}

/**
 * The ids of notes this send minted for the SENDER — the change note, and a self-transfer's own
 * note — taken from the registry the SDK handed back rather than recomputed.
 *
 * Recomputing them would mean reimplementing the pool's channel-key and note-id hashes in this
 * repository, where they would be a second copy of a protocol rule nobody would notice drifting.
 * The SDK already tracked them while it compiled; this only subtracts the notes we came in with.
 */
function mintedNoteIds(registry: PrivateRegistry, wallet: SendWalletData): bigint[] {
  const had = new Set(wallet.notes.map((n) => n.id.toString()))
  const out: bigint[] = []
  for (const [, notes] of registry.notes.entries()) {
    for (const note of notes) {
      const id = BigInt(note.id as string | number | bigint)
      if (!had.has(id.toString())) out.push(id)
    }
  }
  return out
}

// ── Relay, mature, confirm ────────────────────────────────────────────────────────────────

/**
 * Puts the batch on chain from the USER's own account and answers with the transaction hash.
 *
 * A seam rather than an implementation, because what signs here is the connected wallet and this
 * package holds no wallet. Whatever supplies it gets the assembled calls — the same
 * `[STRK.approve(pool, ceiling), apply_actions]` the relayer would have signed — plus the proof
 * facts AND the proof blob, which are V3 transaction details and cannot ride inside a call. The
 * sequencer takes the pair or nothing, so an executor that drops either broadcasts a rejection.
 */
export type SelfSubmitExecutor = (
  calls: Call[],
  details: { proofFacts: string[]; proof: string },
) => Promise<string>

/**
 * Resolves `true` once the pool holds every note, `false` once we have stopped watching.
 *
 * `false` IS NOT FAILURE. Nothing here can cancel a chain, so running out of patience means we
 * looked away, and the pipeline reports that as `confirmation-unknown` rather than as a send
 * that did not happen.
 */
export type ConfirmNoteMature = (noteIds: readonly bigint[]) => Promise<boolean>

/**
 * How long the maturity watch keeps looking.
 *
 * A WATCHING BUDGET, NOT A RIPENING WINDOW. It says nothing about how long a note takes to
 * become spendable — the deployed pool publishes no such number and this module refuses to
 * invent one (FR-052). It bounds how long the submit lock is held by a poll, which is the same
 * job `CONFIRM_TIMEOUT_MS` does for the receipt, and it is the same length for the same reason.
 */
export const MATURE_TIMEOUT_MS = CONFIRM_TIMEOUT_MS

/** How often the default watch asks. Frequent enough to be responsive, slow enough to be polite. */
export const MATURE_POLL_MS = 5_000

/** Polls `get_note` until the pool holds every id, or until the deadline. */
export function makeNoteMatureWatcher(
  read: (noteId: bigint) => Promise<boolean> = noteExists,
  timer: DeadlineTimer = REAL_TIMER,
  pollMs: number = MATURE_POLL_MS,
  budgetMs: number = MATURE_TIMEOUT_MS,
  now: () => number = Date.now,
): ConfirmNoteMature {
  return async (noteIds) => {
    // A send that minted nothing for the sender — a withdraw that spent its notes exactly — has
    // nothing to ripen. Answering `true` immediately is the truth, not a shortcut.
    if (noteIds.length === 0) return true
    const deadline = now() + budgetMs
    for (;;) {
      try {
        // EACH ROUND IS ITSELF DEADLINED. Without this, one RPC that accepts the connection and
        // never answers parks the `Promise.all` forever — the overall deadline below is only
        // consulted between rounds, so it is never reached, and the submit lock this runs under
        // is held for the life of the tab. The round budget is what is left of the whole budget,
        // so a hung read cannot outlive the watch it belongs to.
        const roundMs = Math.max(1, deadline - now())
        const present = await withDeadline(Promise.all(noteIds.map((id) => read(id))), roundMs, timer)
        if (present.every(Boolean)) return true
      } catch (e) {
        // A read that broke is not a note that is missing, and neither is a read that hung. Keep
        // watching until the budget runs out; the caller cannot tell the difference and does not
        // need to, because both answers are "we do not know yet".
        console.warn(`send: a maturity read failed and was retried: ${String(e)}`)
      }
      if (now() >= deadline) return false
      await new Promise<void>((resolve) => {
        timer.setTimeout(resolve, pollMs)
      })
    }
  }
}

/**
 * Thrown when the fee-recipient read failed for a reason retrying cannot fix.
 *
 * SEPARATE FROM AN UNREACHABLE RELAYER, and the distinction is what a surface does next. A
 * network failure is "try again in a moment"; a relayer that advertises no recipient, or
 * advertises a zero, or a URL that is not a submit endpoint, is a deployment that is wired wrong
 * — retrying it forever is the wrong advice, and self-submission is the working path.
 */
export class RelayerMisconfigured extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RelayerMisconfigured'
  }
}

/** How long to wait on the fee-recipient read. It is one small GET on the app's own origin. */
export const FEE_RECIPIENT_TIMEOUT_MS = 10_000

/** Asks the relayer where a reimbursement `Withdraw` should be sent. One free GET. */
export async function readFeeRecipient(
  relayerUrl: string,
  timer: DeadlineTimer = REAL_TIMER,
  timeoutMs: number = FEE_RECIPIENT_TIMEOUT_MS,
): Promise<string> {
  const url = relayerUrl.replace(/\/submit$/, '/fee-recipient')
  // A relayer URL that is not a `/submit` endpoint would leave the replace a no-op, and this
  // would GET the submit path and read whatever came back as an address. Refuse instead: the
  // answer feeds an irreversible `Withdraw`, so the one thing this must not do is improvise.
  if (url === relayerUrl) {
    throw new RelayerMisconfigured(
      `cannot derive a fee-recipient endpoint from ${JSON.stringify(relayerUrl)}: it does not end in /submit`,
    )
  }
  // Deadlined for the same reason the relay hop is: this runs before the lock but a hung socket
  // still parks a send the user is watching, with no way to give up.
  const res = await withDeadline(fetch(url, { headers: { accept: 'application/json' } }), timeoutMs, timer)
  const body = (await res.json().catch(() => ({}))) as FeeRecipientBody | null
  const advertised = body?.feeRecipient
  if (res.status !== 200 || typeof advertised !== 'string' || !advertised.trim()) {
    throw new RelayerMisconfigured(
      `the relayer did not advertise a fee recipient (${res.status}): without one there is no ` +
        'address to reimburse, and guessing it would send the fee somewhere nobody is watching',
    )
  }
  // CHECKED, NOT TRUSTED, and checked for a value as well as a shape. This address goes into a
  // proven, irreversible `Withdraw`; `"0"` and `"0x0"` are perfectly well-formed felts and would
  // burn the reimbursement, so a zero is refused here rather than at the pool.
  const felt = feltOrNull(advertised)
  if (felt === null) {
    throw new RelayerMisconfigured(
      `the relayer advertised a fee recipient that is not a felt address: ${JSON.stringify(advertised)}`,
    )
  }
  if (felt === 0n) {
    throw new RelayerMisconfigured(
      'the relayer advertised a fee recipient of 0; a reimbursement sent there is burned',
    )
  }
  return advertised
}

// ── The pipeline ──────────────────────────────────────────────────────────────────────────

export interface SendInput extends SendRequest {
  accountKey: string
  account: PrivateTransfersUser
  wallet: SendWalletData
  appName?: string
  relayerUrl?: string
}

/**
 * The seams to the stories that do not exist yet, plus the injection points the tests drive.
 * Every default is either the live implementation or a refusal — never a stub that succeeds.
 */
export interface SendDeps {
  /** 1.11's session lock. Two tabs spending the same notes is a double-spend one of them pays for. */
  acquireSubmitLock?: () => Promise<() => void>
  readHealth?: () => Promise<PoolHealth>
  readBlockNumber?: () => Promise<number>
  readRecipientKey?: (address: string) => Promise<bigint>
  readChannelCount?: (address: string) => Promise<number>
  readFeeRecipient?: (relayerUrl: string) => Promise<string>
  prove?: (input: ProveSendInput) => Promise<ProvedSend>
  submit?: (url: string, body: SubmitBody) => Promise<RelayResponse>
  /**
   * Self-submission. DEFAULTS TO REFUSE: this package holds no wallet, and a default that
   * silently did nothing would report a send nobody made.
   */
  selfSubmit?: SelfSubmitExecutor
  confirm?: (transactionHash: string) => Promise<number | null | void>
  confirmNoteMature?: ConfirmNoteMature
  deadlineTimer?: DeadlineTimer
  onStage?: (stage: SendStage) => void
}

/**
 * Sends `amount` of `token` to `recipient` and returns the stages it actually reached.
 *
 * THE ORDER OF THE PRE-FLIGHT IS THE PRODUCT. Every refusal above the `prove` stage has cost the
 * user nothing: pool health first (a paused or upgraded pool is not worth proving against), then
 * the recipient's key (a free view that turns an impossible transfer into an invitation), then
 * the balances (arithmetic on data we already hold). Only after all three does anything reach a
 * prover, and only after the prover does anything reach a submitter.
 */
export async function sendShielded(input: SendInput, deps: SendDeps = {}): Promise<SendResult> {
  const {
    acquireSubmitLock = async () => () => {},
    readHealth = readPoolHealth,
    readBlockNumber = () => withFallback((p) => p.getBlockNumber()),
    readRecipientKey = getPublicKey,
    readChannelCount = getNumOfChannels,
    readFeeRecipient: readFeeRecipientDep = readFeeRecipient,
    prove = proveSend,
    submit = postSubmitToRelayer,
    selfSubmit = async () => {
      throw new Error('no self-submit executor was supplied, so nothing can sign from this wallet')
    },
    confirm = defaultConfirm,
    confirmNoteMature = makeNoteMatureWatcher(),
    deadlineTimer = REAL_TIMER,
    onStage,
  } = deps

  const selfSubmitted = input.mode === 'self' ? ({ selfSubmitted: true } as const) : {}
  const stages: SendStage[] = []
  const reach = (stage: SendStage) => {
    stages.push(stage)
    try {
      onStage?.(stage)
    } catch (e) {
      // An observer is for watching, not for voting. A component that unmounted mid-send must
      // not abort a transaction that is already paying for itself.
      console.warn(`send: onStage(${stage}) observer threw and was ignored: ${String(e)}`)
    }
  }
  const fail = (failure: SendFailure): SendResult => ({ ok: false, stages, failure, ...selfSubmitted })

  const self = String(input.account.address)
  const relayerUrl = input.relayerUrl ?? DEFAULT_RELAYER_URL
  const submitter = input.appName?.trim() || DEFAULT_APP_NAME

  // 1. The chain, before anything else. A `PoolHealth` that is not `ok` is not a state to build
  //    a transaction against, and every branch of it is free.
  let health: PoolHealth
  try {
    health = await readHealth()
  } catch (e) {
    return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
  }
  if (health.state === 'paused') return fail({ kind: 'pool-paused' })
  if (health.state === 'upgraded') {
    return fail({ kind: 'pool-upgraded', pinned: health.pinned, onchain: health.onchain })
  }
  if (health.state === 'unreachable') {
    return fail({ kind: 'blocked-rpc-unknown', reason: 'the pool could not be read' })
  }
  if (health.feeWei <= 0n) {
    return fail({
      kind: 'blocked-rpc-unknown',
      reason: `the pool reported a fee of ${health.feeWei} wei, which is not a fee we will build a send from`,
    })
  }
  if (health.proofValidityBlocks <= PROVING_BLOCK_LAG) {
    return fail({
      kind: 'blocked-rpc-unknown',
      reason:
        `the pool reported a proof validity window of ${health.proofValidityBlocks} blocks, which ` +
        `is not wider than the ${PROVING_BLOCK_LAG}-block proving lag — every proof built against ` +
        'it would already be expired',
    })
  }

  const feeRow: FeeRow = { submitter, feeWei: health.feeWei, paidByUs: input.mode === 'relayer' }
  const selfFundedFeeRow: FeeRow = { ...feeRow, paidByUs: false }
  const offer: SelfSubmitOffer = {
    mode: 'self',
    feeRow: selfFundedFeeRow,
    disclosure: SELF_SUBMIT_DISCLOSURE,
    gasNotice: SELF_SUBMIT_GAS_LOSS,
  }

  // 2. The recipient. Only a shielded transfer needs a registered one — a withdraw names a
  //    public address the pool transfers to directly.
  if (input.kind === 'transfer') {
    const route = await preflightRecipient(input.recipient, readRecipientKey)
    if (route.route === 'blocked-rpc-unknown') {
      return fail({ kind: 'blocked-rpc-unknown', reason: route.reason })
    }
    if (route.route === 'unregistered') {
      return fail({ kind: 'unregistered-recipient', recipient: input.recipient, door: route.door })
    }
  }

  // 3. Where the fee goes, in relayer mode. Read from the relayer rather than pinned: the wallet
  //    it signs with can be rotated without a front-end release, and a stale constant here would
  //    send a real reimbursement to an address nobody is watching.
  let fee: FeeLeg | null = null
  if (input.mode === 'relayer') {
    try {
      fee = { recipient: await readFeeRecipientDep(relayerUrl), feeWei: health.feeWei }
    } catch (e) {
      // A relayer that is wired wrong is a different sentence from one that is unreachable: the
      // first has a working alternative right now, the second wants a retry.
      if (e instanceof RelayerMisconfigured) {
        return fail({ kind: 'relayer-misconfigured', reason: String(e), selfSubmit: offer })
      }
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }
  }

  // 4. The plan and the balances. Pure arithmetic on data already in hand, so a refusal here has
  //    issued zero prover and zero relayer requests.
  const planned = planSend(
    {
      kind: input.kind,
      recipient: input.recipient,
      token: input.token,
      symbol: input.symbol,
      amount: input.amount,
      mode: input.mode,
    },
    input.wallet,
    self,
    fee,
  )
  if (!planned.ok) return fail(planned.failure)

  // Everything above this line was free and unserialised. From here on the notes this send
  // spends are committed to, and two tabs committing to the same notes is a double-spend one of
  // them pays a revert for — so the lock goes on before the last read and stays on through the
  // submission.
  let release: () => void
  try {
    release = await acquireSubmitLock()
  } catch (e) {
    return fail({ kind: 'lock-unavailable', reason: String(e) })
  }
  try {
    // 5. Build. The channel count is read HERE, under the lock and as late as possible: it is
    //    the index a new channel must take, and another tab opening one between the read and
    //    the prove is exactly what `INDEX_NOT_SEQUENTIAL` is.
    reach('build')
    let channelCount: number
    try {
      channelCount = await readChannelCount(self)
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    // THE FEE IS RE-READ UNDER THE LOCK, because the reimbursement leg is about to be frozen
    // into a proof. The pool's fee is mutable at ZERO upgrade delay, so a rise between the
    // pre-flight read and this moment would leave us proving a `Withdraw` for less than
    // `collect_fee` is going to pull — the relayer signs, pays the difference out of its own
    // balance, and nothing anywhere reports it. Refusing here costs a re-prove; not refusing
    // costs the relayer real STRK on every send until someone notices.
    //
    // A FALL is fine and is deliberately not refused: the leg over-reimburses by the difference,
    // which lands in the relayer's favour and hurts nobody.
    //
    // WHAT CANNOT BE RE-CHECKED HERE is whether the notes are still unspent. That needs
    // discovery, which this path does not have (story 1.9) — so the defence against a note
    // spent by another tab is the submit lock serialising them, plus the pool's own nullifier,
    // which reverts the second spend rather than allowing it. See the `reverted` branch.
    if (planned.plan.fee) {
      let current: PoolHealth
      try {
        current = await readHealth()
      } catch (e) {
        return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
      }
      if (current.state === 'paused') return fail({ kind: 'pool-paused' })
      if (current.state === 'upgraded') {
        return fail({ kind: 'pool-upgraded', pinned: current.pinned, onchain: current.onchain })
      }
      if (current.state === 'unreachable') {
        return fail({ kind: 'blocked-rpc-unknown', reason: 'the pool could not be re-read under the lock' })
      }
      if (current.feeWei > planned.plan.fee.feeWei) {
        return fail({
          kind: 'fee-moved',
          foldedWei: planned.plan.fee.feeWei,
          currentWei: current.feeWei,
        })
      }
    }

    reach('prove')
    let proved: ProvedSend
    try {
      proved = await prove({
        accountKey: input.accountKey,
        account: input.account,
        provingBlockId: Math.max(0, health.blockNumber - PROVING_BLOCK_LAG),
        plan: planned.plan,
        wallet: input.wallet,
        channelCount,
      })
    } catch (e) {
      return fail({ kind: 'prover-failed', reason: String(e) })
    }

    // A proof binds to the block it was made against and the pool rejects it once
    // `proofValidityBlocks` have passed. Proving is the slow step, so the head can have moved.
    try {
      const currentBlock = await readBlockNumber()
      if (currentBlock - proved.provingBlockId >= health.proofValidityBlocks) {
        return fail({
          kind: 'proof-expired',
          provedAtBlock: proved.provingBlockId,
          currentBlock,
          validityBlocks: health.proofValidityBlocks,
        })
      }
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    reach('relay')
    let calls: Call[]
    try {
      // The identical batch in both modes: `collect_fee` pulls from whoever submits, so whoever
      // submits has to approve first, in the same transaction. `approveCeiling` is shared with
      // the relayer's own allowlist, so what we build is exactly what it will accept.
      calls = assembleRegistrationCalls(proved.call, health.feeWei)
    } catch (e) {
      return fail({ kind: 'bad-input', reason: String(e) })
    }

    let transactionHash: string
    if (input.mode === 'self') {
      try {
        transactionHash = await selfSubmit(calls, { proofFacts: proved.proofFacts, proof: proved.proof })
      } catch (e) {
        // The user's own account was the caller, so a rejected or reverting attempt has still
        // been paid for. Saying so is the whole difference between an honest tradeoff and a
        // silent bill.
        return fail({ kind: 'self-submit-failed', reason: String(e), gasLine: SELF_SUBMIT_GAS_LOSS })
      }
      if (typeof transactionHash !== 'string' || !transactionHash.trim()) {
        return fail({
          kind: 'confirmation-unknown',
          transactionHash: '',
          reason: 'the self-submit executor returned no transaction hash, so a transaction may be in flight whose id we do not know',
        })
      }
    } else {
      const relayed = await relay(submit, relayerUrl, calls, proved.proofFacts, proved.proof, offer)
      if ('failure' in relayed) return fail(relayed.failure)
      transactionHash = relayed.transactionHash
    }

    // 6. Confirm the receipt before watching for the note: a reverted send mints nothing, and
    //    polling `get_note` for a note that will never exist would burn the whole watch budget
    //    to arrive at "we stopped watching" for a transaction we already know rolled back.
    let sendBlock: number | null | void
    try {
      sendBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
    } catch (e) {
      if (e instanceof RegistrationReverted) {
        return fail({ kind: 'reverted', message: mapSendError(e.revertReason), transactionHash })
      }
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }

    // 7. Mature. The stage is entered even when there is nothing to wait for, because the stage
    //    vocabulary is a promise about what a send goes through, not about what this one had to.
    reach('mature')
    let matured: boolean
    try {
      matured = await confirmNoteMature(proved.mintedNoteIds)
    } catch (e) {
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }
    if (!matured) {
      return fail({
        kind: 'confirmation-unknown',
        transactionHash,
        reason:
          'the send landed and we stopped watching for the note it minted before the pool ' +
          'reported it. The transaction is on chain; the note may already be there.',
      })
    }
    reach('confirmed')

    return {
      ok: true,
      stages,
      transactionHash,
      submittedBy: input.mode,
      ...selfSubmitted,
      feeRow,
      maturedNoteIds: proved.mintedNoteIds,
      sendBlock: sanitizeBlockNumber(sendBlock),
    }
  } finally {
    // A `finally` that throws REPLACES the result — including a success — with an exception, so
    // a lock whose release fails would erase a send that already happened.
    try {
      release()
    } catch (e) {
      console.warn(`send: releasing the submit lock threw and was ignored: ${String(e)}`)
    }
  }
}

/**
 * The relay hop and its answer, classified.
 *
 * Split out so the two branches that are NOT dead ends — the send cap and a relayer that cannot
 * pay — carry the self-submit offer in the same shape, and so the ambiguity rules stay in one
 * place. The rules are `register.ts`'s, and for the same reason: a 200 we cannot read means a
 * transaction exists whose hash we have lost, which must never be reported as a clean refusal.
 */
async function relay(
  submit: (url: string, body: SubmitBody) => Promise<RelayResponse>,
  url: string,
  calls: Call[],
  proofFacts: string[],
  proof: string,
  offer: SelfSubmitOffer,
): Promise<{ transactionHash: string } | { failure: SendFailure }> {
  let response: RelayResponse
  try {
    // NO `sponsored` FLAG. A send reimburses the relayer's fee from its own proven action chain,
    // so it is not a sponsorship and must not be charged to the budget that buys cold visitors
    // their one free account — nor refused with copy about registrations.
    response = await submit(url, { calls, proofFacts, proof })
  } catch (e) {
    if (e instanceof RelayDeliveryUnknown) {
      return { failure: { kind: 'confirmation-unknown', transactionHash: '', reason: String(e) } }
    }
    return { failure: { kind: 'relay-refused', status: 0, reason: String(e) } }
  }

  // The relayer's own notice is carried verbatim rather than paraphrased into a second sentence
  // that would drift from it — but a MISSING notice must not become an empty string, which
  // renders as a blank space where an explanation belongs. The fallback says the one thing that
  // is true in every one of these branches.
  const notice = (advertised: string | undefined) =>
    advertised?.trim() ||
    'The relayer is not taking this send right now. You can still submit it from your own wallet.'

  if (response.status === 403 && response.body.reason === 'send-cap-reached') {
    return { failure: { kind: 'send-cap-reached', notice: notice(response.body.notice), selfSubmit: offer } }
  }
  // A SEND SHOULD NEVER SEE THIS, and that is why it gets a branch instead of falling through.
  // The sponsorship budget meters flagged submissions only, and a send sends no flag — so a
  // `sponsorship-paused` here means the relayer is metering it against the wrong budget. Left to
  // fall through it became `relay-refused` carrying the registration notice as its reason, and a
  // send surface would have rendered "sponsored registrations are paused" at someone who was
  // trying to move money.
  if (response.status === 403 && response.body.reason === 'sponsorship-paused') {
    return { failure: { kind: 'sponsorship-paused', notice: notice(response.body.notice), selfSubmit: offer } }
  }
  if (response.status === 503 && response.body.reason === 'relayer-down') {
    return { failure: { kind: 'relayer-down', notice: notice(response.body.notice), selfSubmit: offer } }
  }

  if (response.status === 200 && response.bodyUnreadable) {
    return {
      failure: {
        kind: 'confirmation-unknown',
        transactionHash: '',
        reason:
          'the relayer accepted the submission but its reply could not be read, so a transaction ' +
          'is in flight whose hash we do not know',
      },
    }
  }
  const transactionHash = response.body.transactionHash
  if (response.status !== 200 || typeof transactionHash !== 'string' || !transactionHash.trim()) {
    if (response.status === 200) {
      return {
        failure: {
          kind: 'confirmation-unknown',
          transactionHash: '',
          reason: 'the relayer answered 200 without a usable transaction hash',
        },
      }
    }
    return {
      failure: {
        kind: 'relay-refused',
        status: response.status,
        reason: response.body.error ?? response.body.notice ?? 'the relayer refused the submission',
      },
    }
  }
  return { transactionHash }
}

/**
 * Maps a raw pool revert string to honest user copy.
 *
 * The codes a send can hit are not the ones a registration can, so the table is its own rather
 * than shared with `mapRegistrationError` — which would have to grow send vocabulary it never
 * uses. Unknown codes pass through unchanged rather than being mistranslated.
 */
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
    // Both banked live in ACTION_LIST_EVIDENCE and both previously fell through as raw codes.
    ZERO_AMOUNT: 'That send moves an amount of zero, which the pool refuses.',
    SENDER_NOT_REGISTERED: 'This account has no key in the pool yet, so it cannot send.',
  }
  for (const [code, message] of Object.entries(table)) {
    if (raw.includes(code)) return message
  }
  return raw
}

/** The one rule for what counts as a block number. Anything else is `null`, never a guess. */
function sanitizeBlockNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Waits for the chain, then checks the receipt.
 *
 * `RegistrationReverted` is thrown by the shared `confirmFromReceipt`, and it is reused here
 * rather than reproduced under a send-shaped name: `assertNotReverted` carries the whole
 * REVERTED-still-resolves trap that makes the check necessary, and a second class thrown from a
 * second copy of that logic is how one of the two eventually stops catching it.
 */
async function defaultConfirm(transactionHash: string): Promise<number | null> {
  return confirmFromReceipt(await withFallback((p) => p.waitForTransaction(transactionHash)))
}

/** Re-exported so a caller assembling a send batch finds it where the send lives. */
export { assembleRegistrationCalls as assembleSendCalls }

/** The approve a self-submitted send needs, for a caller that wants to show it before signing. */
export function selfSubmitApprove(feeWei: bigint): Call {
  return {
    contractAddress: STRK_TOKEN,
    entrypoint: 'approve',
    calldata: CallData.compile([NET.pool, cairo.uint256(approveCeiling(feeWei))]),
  }
}

/**
 * The fee row's two lines for a send, reusing the registration row's shape and disclosure.
 *
 * DERIVED FROM THE ROW ALONE. This used to take a `mode` argument alongside the row, which meant
 * the two could disagree — `sendFeeRowCopy({paidByUs: true}, 'self')` would render "Submitted by
 * you" over a row that says the relayer paid, and neither the type system nor a reader would
 * catch it. `paidByUs` already carries the fact; one source, one answer.
 */
export function sendFeeRowCopy(row: FeeRow): { line: string; disclosure: string } {
  return {
    line: row.paidByUs
      ? `Submitted by ${row.submitter} relayer · ${formatStrk(row.feeWei)} STRK · reimbursed from your notes`
      : `Submitted by you · ${formatStrk(row.feeWei)} STRK · paid from your wallet`,
    disclosure: row.paidByUs ? POOL_SEES_DISCLOSURE : SELF_SUBMIT_DISCLOSURE,
  }
}
