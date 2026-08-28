//
// Sponsored registration, end to end and headless (FR-012, story 1.12).
//
// This is the module that turns "the user wants an account" into a transaction the
// relayer has broadcast and the chain has accepted. It owns four stages and no more —
// build, prove, relay, confirmed — and it is the only place the four are sequenced.
//
// THERE IS NO FIFTH STAGE, and the missing one is a protocol fact rather than an
// omission. Value-bearing deposits have to sit out a ripening window before the note
// they mint can be spent; a zero-deposit `SetViewingKey` mints nothing, so there is no
// window and nothing to wait out. A stage vocabulary carrying one would be inventing a
// delay the user does not actually have to sit through, and the account is usable the
// moment the transaction confirms.
//
// No DOM, no React, no copy rendering. Epic 6 renders the pipeline and the collision
// screen; everything here is typed data those surfaces read.
//

import { CallData, cairo, constants, hash, type Call } from 'starknet'
import {
  createPrivateTransfers,
  type DiscoveryProviderInterface,
  type PrivateTransfersUser,
} from '@starkware-libs/starknet-privacy-sdk'
import { NET, STRK_TOKEN } from './constants.js'
import { deriveViewingKey } from './identity.js'
import { CLIENT_ACTION } from './message-book.js'
import { approveCeiling } from './fee-ceiling.js'
import { readPoolConstants, type PoolConstants } from './pool.js'
import { RELAYER_PATHS, type SubmitBody, type SubmitResponseBody } from './relayer-wire.js'
import { withFallback } from './rpc.js'
import { mapRegistrationError, preflightRegistration, type PreflightRoute } from './registration.js'
import type { RegistrationStage } from './pipeline-stage.js'

/**
 * The four stages a sponsored registration passes through, in order. Four, exhaustively
 * — a ripening stage is absent on purpose, and adding one would not merely be extra
 * vocabulary, it would be a claim about the protocol that is false. See the header.
 *
 * DECLARED IN `pipeline-stage.ts` AND RE-EXPORTED HERE so a renderer can import the union without
 * importing this module, which reaches the relayer wire and the SDK. No existing importer changed.
 */
export type { RegistrationStage } from './pipeline-stage.js'

/** Why a registration stopped. Every branch is a sentence the UI can show as-is. */
export type RegisterFailure =
  /**
   * 1.8's backup ceremony has not confirmed. The default, until something says otherwise.
   * `reason` is present only when the gate THREW rather than answering no.
   */
  | { kind: 'backup-not-confirmed'; reason?: string }
  | { kind: 'already-registered'; onChainKey: bigint }
  | { kind: 'collision'; onChainKey: bigint }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  /**
   * The inputs, not the chain: a malformed account key whose viewing-key derivation
   * throws, or an injected seam that threw for its own reasons. Separate from
   * `blocked-rpc-unknown` because retrying will not help until something is corrected.
   */
  | { kind: 'bad-input'; reason: string }
  /** The submit lock could not be taken. Another tab may be mid-registration. */
  | { kind: 'lock-unavailable'; reason: string }
  | { kind: 'pool-paused' }
  | { kind: 'prover-failed'; reason: string }
  /** Proved against a block that fell out of the pool's validity window before we relayed. */
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  /**
   * The relayer's budget is spent. Carries ITS notice verbatim — we do not rewrite it —
   * plus the fee row the user now has to pay themselves, because "you can fund this from
   * your own wallet" is not a usable sentence without the number attached.
   */
  | { kind: 'pay-your-own-way'; notice: string; feeRow: FeeRow }
  /**
   * Refused BEFORE the relayer could have sent anything: nothing was signed, nothing is
   * in flight, and retrying is free. Anything ambiguous is `confirmation-unknown` instead.
   */
  | { kind: 'relay-refused'; status: number; reason: string }
  /** The chain accepted the transaction and the pool reverted it. `message` is mapped copy. */
  | { kind: 'reverted'; message: string }
  /**
   * WE MAY HAVE REGISTERED AND CANNOT PROVE IT. NOT `blocked-rpc-unknown`, and the
   * distinction is the whole point: that one means nothing happened and retrying is free;
   * this one means a transaction may be in flight, the budget may already be spent, and a
   * retry risks a second registration reverting `NON_ZERO_VALUE`.
   *
   * Every ambiguity after the request could have reached the relayer lands here — a relay
   * timeout, a socket dropped mid-flight, a 200 whose body we could not read — not just a
   * failed confirmation. `transactionHash` is empty when we never learned one, which is
   * itself the worst case and must not be dressed up as a clean refusal.
   */
  | { kind: 'confirmation-unknown'; transactionHash: string; reason: string }

export type RegisterResult =
  | {
      ok: true
      stages: RegistrationStage[]
      transactionHash: string
      feeRow: FeeRow
      /**
       * The block the registration landed in, read off the confirm receipt — story 1.8's
       * Recovery File header re-issue needs it, and this is the only moment it is known
       * for free. `null` when the receipt carried no usable block number (an injected
       * confirm, or an RPC whose receipt shape we did not recognise); the re-issue then
       * simply does not happen, which is the same as not having registered yet.
       */
      registrationBlock: number | null
    }
  | { ok: false; stages: RegistrationStage[]; failure: RegisterFailure }

// ── Who paid, and how much (AC6 — the fee row epic 6 renders) ─────────────────────────────

/** The fee row's data. Every number in it is a live read; nothing here is a literal. */
export interface FeeRow {
  /** The name shown as the submitter — ours, because our address is in the public record. */
  submitter: string
  /** The pool fee for this submission, read from `get_fee_amount` at build time. */
  feeWei: bigint
  /** True while the relayer is paying. False is the self-funded path, not an error. */
  paidByUs: boolean
}

/**
 * The one honest sentence about what a sponsored submission exposes.
 *
 * Byte-exact and exported as a constant so the disclosure cannot drift between the
 * surfaces that show it. The pool's `apply_actions` is a public transaction sent from
 * the relayer's address; what it carries is the proven action span, not note contents.
 */
export const POOL_SEES_DISCLOSURE = 'The pool sees this transaction, not your notes.'

/** The submitter name shown when the caller supplies none — or supplies only whitespace. */
export const DEFAULT_APP_NAME = 'Passbook'

/**
 * Formats wei as STRK without trailing-zero noise — `6000…000n` renders as `6`.
 *
 * Refuses a negative amount rather than rendering one. `bigint` division truncates
 * toward zero and the remainder carries the sign, so `-1n` would come out as the string
 * `0.-00…001`; a fee row is the one place a user checks what they are being charged, and
 * a corrupted number there is worse than no number.
 */
export function formatStrk(wei: bigint): string {
  if (wei < 0n) throw new Error(`refusing to render a negative amount: ${wei} wei`)
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

/**
 * Assembles the fee row's two lines. ONE function, so the wording exists once.
 *
 * `paid by us` is the sponsored claim and it is only made when the relayer is actually
 * the payer; the self-funded path says `paid by you` rather than going quiet, because a
 * missing line reads as a hidden charge.
 */
export function feeRowCopy(row: FeeRow): { line: string; disclosure: string } {
  return {
    line:
      `Submitted by ${row.submitter} relayer · ${formatStrk(row.feeWei)} STRK · ` +
      `paid by ${row.paidByUs ? 'us' : 'you'}`,
    disclosure: POOL_SEES_DISCLOSURE,
  }
}

// ── Build + prove (AC2) ───────────────────────────────────────────────────────────────────

/** What the prover leg hands back: the pool call and the facts that must ride with it. */
export interface ProvedRegistration {
  /** The pool's `apply_actions` call, exactly as the SDK assembled it. */
  call: Call
  /** Prover facts; the transaction is rejected without them. */
  proofFacts: string[]
  /**
   * The proof blob itself (the prover's `proof` string, ~300KB of base64), which must
   * ride on the broadcast NEXT TO the facts. The sequencer enforces both-or-neither —
   * `proof_facts` without `proof` is rejected at `starknet_addInvokeTransaction` with
   * "Proof facts and proof must either both be present or both be absent" — and this
   * pipeline learned that from the FIRST real broadcast (story 1.13, 2026-08-24), not
   * from a receipt: receipts do not echo the proof field back, so sampling accepted
   * transactions had "shown" that no proof material rides at all. It does; it is just
   * write-only on the wire.
   */
  proof: string
  /** The block the proof is bound to, for the validity-window check before relay. */
  provingBlockId: number
}

export interface ProveRegistrationInput {
  /** The root account key. A parameter — never read from storage here; 1.11 owns that. */
  accountKey: string
  /** The connected wallet: `{ address, signer }`. Signs one FREE view invocation. */
  account: PrivateTransfersUser
  provingBlockId: number
}

/**
 * Discovery that refuses to be called.
 *
 * Registration compiles without an indexer — the free probe proved it by wiring exactly
 * this and watching a lone `SetViewingKey` compile anyway — so story 1.9's indexer-free
 * discovery is not a dependency of this path. Passing a real indexer instead would make
 * the cold-start registration depend on a service it does not need; passing a silently
 * empty stub would hide the day that stops being true. These throw.
 */
const REFUSING_DISCOVERY: DiscoveryProviderInterface = {
  discoverNotes: async () => {
    throw new Error('registration must not reach discovery: discoverNotes was called')
  },
  discoverChannels: async () => {
    throw new Error('registration must not reach discovery: discoverChannels was called')
  },
  discoverRequirement: async () => {
    throw new Error('registration must not reach discovery: discoverRequirement was called')
  },
}

/** `compile_actions`, the pool's free view — the ONLY entrypoint a proof invocation may wrap. */
const COMPILE_ACTIONS_SELECTOR = hash.getSelectorFromName('compile_actions')

/**
 * Pulls the `Span<ClientAction>` back out of a proof invocation's calldata.
 *
 * The invocation is an `__execute__` wrapping one call to the pool's free
 * `compile_actions` view, laid out `[array_len=1, to, selector, inner_len, ...inner]`
 * with `inner = [sender, viewingKey, ...span]`. Reading it back is the only way to
 * assert on what the SDK's compiler actually produced rather than on what we asked for.
 *
 * Target and selector are checked, not assumed. Reading a span out of a call to some
 * other contract or entrypoint would mean asserting on one thing while the prover works
 * on another — the assertion would pass and prove nothing, which is worse than no
 * assertion. The trailing-felt check is the same idea: an inner span shorter than the
 * calldata means there are felts here nobody has looked at.
 */
export function extractClientActionSpan(executeCalldata: readonly string[]): bigint[] {
  if (executeCalldata.length < 4) {
    throw new Error(`proof invocation calldata is too short to be an __execute__: ${executeCalldata.length} felts`)
  }
  if (BigInt(executeCalldata[0]!) !== 1n) {
    throw new Error(
      `refusing a proof invocation carrying ${executeCalldata[0]} calls: registration is exactly one compile_actions`,
    )
  }
  if (BigInt(executeCalldata[1]!) !== BigInt(NET.pool)) {
    throw new Error(`refusing a proof invocation aimed at ${executeCalldata[1]}: expected the pool ${NET.pool}`)
  }
  if (BigInt(executeCalldata[2]!) !== BigInt(COMPILE_ACTIONS_SELECTOR)) {
    throw new Error(`refusing a proof invocation of selector ${executeCalldata[2]}: expected compile_actions`)
  }
  const innerLength = Number(BigInt(executeCalldata[3]!))
  const inner = executeCalldata.slice(4)
  if (inner.length !== innerLength) {
    throw new Error(
      `compile_actions calldata declares ${innerLength} felts but ${inner.length} follow it — ` +
        'a mismatch means part of this invocation went uninspected',
    )
  }
  if (innerLength < 2) {
    throw new Error(`compile_actions calldata carries ${innerLength} felts: too few for even (sender, viewingKey)`)
  }
  return inner.slice(2).map((f) => BigInt(f))   // drop the sender and viewing-key arguments
}

/**
 * Throws unless the compiled span is EXACTLY one zero-deposit `SetViewingKey`.
 *
 * A `Span<ClientAction>` serialises as `[count, ...items]` and a `SetViewingKey` item is
 * two felts (`variant=0`, `random`), so the entire legal span is three felts. That is
 * what makes this a real check rather than a comment: a `Deposit` or an `OpenChannel`
 * folded in by `autoSetup`/`autoRegister` — which `internal/compiler.js` will do silently
 * when either option is set — lands a fourth felt and fails here, BEFORE the prover is
 * paid attention and long before anything is submitted.
 */
export function assertLoneSetViewingKey(span: readonly bigint[]): void {
  if (span.length !== 3 || span[0] !== 1n) {
    throw new Error(
      `refusing to prove ${span[0] ?? 0} compiled action(s) (${span.length} felts): ` +
        'sponsored registration is a lone SetViewingKey and nothing else',
    )
  }
  if (span[1] !== BigInt(CLIENT_ACTION.SetViewingKey)) {
    throw new Error(`refusing to prove client action variant ${span[1]}: expected SetViewingKey`)
  }
  if (span[2] === 0n) {
    // The pool's own name for this is ZERO_RANDOM; it is quoted rather than shown, because
    // a bare code is not a sentence and this module owes the caller a readable one.
    throw new Error(
      'refusing to prove a registration whose encryption randomness is zero — the pool ' +
        'rejects it as ZERO_RANDOM',
    )
  }
}

/**
 * Builds and proves the lone `SetViewingKey`.
 *
 * `build()` is called with NO options object at all. `autoSetup`, `autoRegister` and
 * `autoSelectNotes` each change the compiled action list, and the first two would append
 * an `OpenChannel` the sponsored path is not paying for. Omitting the argument is
 * stronger than passing `false`: there is no key to later flip.
 *
 * OHTTP is on. Without it the proving service sees the visitor's IP alongside the exact
 * address being registered, which is the linkage the rest of this app spends its effort
 * closing.
 */
export async function proveRegistration(input: ProveRegistrationInput): Promise<ProvedRegistration> {
  const viewingKey = deriveViewingKey(input.accountKey, NET.chainId, NET.pool)

  const transfers = createPrivateTransfers({
    account: input.account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: {
      url: NET.prover,
      chainId: NET.chainId as constants.StarknetChainId,
      ohttp: true,
    },
    discoveryProvider: REFUSING_DISCOVERY,
    poolContractAddress: NET.pool,
  })

  const invocation = await transfers
    .build()
    .register()
    .createProofInvocation({ provingBlockId: input.provingBlockId })

  assertLoneSetViewingKey(extractClientActionSpan(invocation.invocation.calldata))

  const { callAndProof } = await transfers.executeWithInvocation(invocation, input.provingBlockId)
  const { call, proof } = callAndProof

  // The SDK assembles this call itself, so this asserts on what we are about to hand a
  // funded key rather than on our own intent. `apply_actions` on the pool is the only
  // entrypoint a registration may reach; a plain `privacy_invoke` here would mean the
  // SDK took a different path than the one this pipeline was designed around.
  if (BigInt(call.contractAddress) !== BigInt(NET.pool) || call.entrypoint !== 'apply_actions') {
    throw new Error(`refusing a proven ${call.entrypoint} on ${call.contractAddress}: expected apply_actions on the pool`)
  }

  // Validate what we hand onward, here, where the failure is still `prover-failed` and
  // still free. Facts that are empty or not felt-shaped are refused by the relayer, and
  // discovering that as a 400 after the relay hop would blame the wrong leg for a bad
  // prove — and would burn a sponsorship slot on the way.
  const proofFacts = [...proof.proofFacts]
  if (proofFacts.length === 0) {
    throw new Error('the prover returned no proof facts; the pool will not accept the transaction')
  }
  const bad = proofFacts.findIndex((f) => typeof f !== 'string' || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(f))
  if (bad !== -1) {
    throw new Error(`the prover returned a proof fact that is not a felt at index ${bad}: ${String(proofFacts[bad])}`)
  }

  return { call, proofFacts, proof: proofBlobFrom(proof), provingBlockId: input.provingBlockId }
}

/**
 * Pulls the proof blob out of a prover response, or throws.
 *
 * ONE helper for both prove legs (registration here, `proveSend` in send.ts), and it
 * runs where the failure is still `prover-failed` and still free: the sequencer rejects
 * `proof_facts` without their `proof`, so a prove that came back without the blob has
 * not produced a submittable transaction and must not cost a relay hop to find out.
 */
export function proofBlobFrom(proof: unknown): string {
  const data = (proof as { data?: unknown } | undefined)?.data
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error(
      'the prover returned no proof blob alongside its facts; the sequencer rejects ' +
        'proof_facts without proof',
    )
  }
  return data
}

// ── The fee leg (AC2/AC6) ─────────────────────────────────────────────────────────────────

/**
 * Prepends the fee approval to the proven call.
 *
 * `collect_fee` pulls from `get_caller_address()`, so the approval has to come from the
 * account that submits — the relayer — and it has to ride in the same batch, because an
 * approval in a separate transaction is a window in which anyone else can spend it. The
 * relayer's allowlist accepts exactly this shape: one `STRK.approve` to the pool under a
 * ceiling drawn from the live fee, plus one `apply_actions`.
 *
 * `feeWei` is a parameter rather than a read inside here so the caller reads it once,
 * with the rest of the live protocol numbers, and the fee row and the approval cannot
 * disagree about what was charged.
 *
 * THE APPROVE CARRIES HEADROOM, and is not the bare fee. The pool's fee is mutable at
 * ZERO upgrade delay, so it can rise between our read and the moment `collect_fee` runs
 * — and an allowance one wei short is a revert we have already paid the gas for. The
 * amount is `approveCeiling(feeWei)`, which is `min(2 × fee, 20 STRK)`: the SAME function
 * the relayer's allowlist uses to decide the maximum it will sign, so what we build is
 * exactly what it accepts, and neither side can drift without the other. `approve` SETS
 * the allowance rather than adding to it, and the pool pulls one fee, so the headroom is
 * an upper bound on exposure and not an amount handed over.
 *
 * The fee ROW still reports `feeWei` — the user is charged the fee, not the ceiling.
 */
export function assembleRegistrationCalls(applyActions: Call, feeWei: bigint): Call[] {
  if (feeWei <= 0n) throw new Error(`refusing to approve a fee of ${feeWei} wei`)
  return [
    {
      contractAddress: STRK_TOKEN,
      entrypoint: 'approve',
      calldata: CallData.compile([NET.pool, cairo.uint256(approveCeiling(feeWei))]),
    },
    applyActions,
  ]
}

// ── Relay + confirm (AC3/AC5) ─────────────────────────────────────────────────────────────

// The wire contract is defined once, in `relayer-wire.ts`, and shared with the server.
// Re-exported here because this module is where a caller building a submission looks.
export type { SubmitBody, SubmitResponseBody } from './relayer-wire.js'

/** What the relayer answered. `body` is parsed JSON, whatever the status. */
export interface RelayResponse {
  status: number
  body: SubmitResponseBody
  /**
   * True when we got a status line but could not read the body it belongs to.
   *
   * This is not a detail. The server sends 200 ONLY together with a transaction hash, so
   * a 200 whose body we cannot parse means a transaction exists and we do not know its
   * hash — the single worst state to report as a clean refusal.
   */
  bodyUnreadable?: boolean
}

/**
 * Thrown by the relay leg when the request MAY have reached the relayer.
 *
 * A connection refused before any byte left is a clean refusal; a timeout or a socket
 * dropped mid-flight is not, because the server may have signed and broadcast already.
 * Collapsing the two is what invites the retry that reverts `NON_ZERO_VALUE`.
 */
export class RelayDeliveryUnknown extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RelayDeliveryUnknown'
  }
}

/**
 * True for a fetch failure that happened before the request could have been delivered.
 *
 * Deliberately a SHORT allowlist rather than a list of ambiguous cases: an error nobody
 * has classified must fall through to "may have been delivered", because that is the
 * answer that refuses to retry. Getting this backwards costs a double registration.
 */
function isPreSendFailure(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN'
}

/**
 * The relayer endpoint. Relative: the browser resolves it against the app's own origin.
 *
 * The literal moved to `relayer-wire.ts`, which is a runtime leaf, so a caller that needs a URL
 * and no cryptography can import one without pulling this module's graph into its chunk. The name
 * stays here because every existing caller uses it.
 */
export const DEFAULT_RELAYER_URL = RELAYER_PATHS.submit

/**
 * How long to wait on the relayer before giving up.
 *
 * A submission that has not been answered in this long is one nobody is still watching,
 * and — the reason this exists at all — the pipeline holds the submit lock across the
 * relay leg. Without a deadline, one hung socket parks the lock forever and the user
 * cannot even retry. Generous, because signing and broadcasting are genuinely slow.
 */
export const RELAY_TIMEOUT_MS = 60_000

/**
 * How long to wait for the chain before giving up on WATCHING (not on the transaction).
 *
 * `RELAY_TIMEOUT_MS` bounds only the relay hop; without this the confirm leg — which also
 * runs under the held submit lock — could park it forever on an RPC that answers slowly
 * and never conclusively. Expiring produces `confirmation-unknown` carrying the hash,
 * which is the truth: the transaction is out there and we stopped watching.
 *
 * Longer than the relay hop because it is waiting on block production, not on a server.
 */
export const CONFIRM_TIMEOUT_MS = 300_000

/** Swappable so the timeout path is testable without waiting five real minutes. */
export interface DeadlineTimer {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const REAL_TIMER: DeadlineTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Rejects if `work` has not settled within `ms`.
 *
 * The underlying promise is NOT cancelled — nothing here can cancel a chain — so the
 * caller must treat expiry as "we stopped looking", never as "it did not happen".
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  timer: DeadlineTimer = REAL_TIMER,
): Promise<T> {
  let handle: unknown
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handle = timer.setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    // Without this an unfired timer keeps the Node event loop alive for the full window
    // after a fast success — five minutes of a process that thinks it still has work.
    if (handle !== undefined) timer.clearTimeout(handle)
  }
}

/**
 * The default relay hop. Exported, with `timeoutMs` overridable, so a test can point it
 * at a deliberately hung server and watch the real deadline and the real classification
 * run — the alternative is asserting on a reimplementation of this function.
 */
export async function postSubmitToRelayer(
  url: string,
  body: SubmitBody,
  timeoutMs: number = RELAY_TIMEOUT_MS,
): Promise<RelayResponse> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // Refused outright means nothing was delivered and the caller may retry for free.
    // A timeout or a dropped socket means the relayer may have signed and broadcast, so
    // it must NOT come back as a clean refusal — see RelayDeliveryUnknown.
    if (isPreSendFailure(e)) throw e
    throw new RelayDeliveryUnknown(
      `the relayer did not answer (${String(e)}); a transaction may already be in flight`,
    )
  }

  let parsed: SubmitResponseBody = {}
  let bodyUnreadable = false
  try {
    // `?? {}` is load-bearing: a body of the four bytes `null` parses to `null`, not to a
    // failure, so without it the caller's `.reason` read throws a TypeError from inside
    // what is supposed to be the relayer's answer.
    parsed = ((await res.json()) as SubmitResponseBody | null) ?? {}
  } catch {
    // A relayer that answered something other than JSON still answered — keep the status,
    // but record that the body is missing. On a 200 that is not a cosmetic gap: the server
    // only sends 200 alongside a hash, so the transaction exists and we have lost its id.
    bodyUnreadable = true
  }
  return { status: res.status, body: parsed, bodyUnreadable }
}

// ── The pipeline (AC2–AC6) ────────────────────────────────────────────────────────────────

export interface RegisterInput {
  /** The root account key. A PARAMETER, never read from storage — 1.11 owns persistence. */
  accountKey: string
  /** The connected wallet, `{ address, signer }`. */
  account: PrivateTransfersUser
  /** Shown in the fee row as the submitter. */
  appName?: string
  relayerUrl?: string
}

/**
 * The seams to the stories that do not exist yet, plus the injection points the tests
 * drive. Every default is either the live implementation or a refusal — never a stub
 * that silently succeeds.
 */
export interface RegisterDeps {
  /**
   * 1.8's backup gate. DEFAULTS TO REFUSE.
   *
   * A registration is irreversible and write-once: register before the user has stored
   * their key and the account is orphaned the moment they close the tab. Until 1.8 wires
   * the ceremony, the honest default is "no", and the failure it produces is a named
   * branch rather than a silent skip.
   */
  canRegister?: () => boolean | Promise<boolean>
  /**
   * 1.11's session lock, optional and a no-op by default. Two tabs racing the same
   * account key both spend budget and one of them reverts `NON_ZERO_VALUE`.
   */
  acquireSubmitLock?: () => Promise<() => void>
  preflight?: (accountKey: string, address: string) => ReturnType<typeof preflightRegistration>
  readConstants?: () => Promise<PoolConstants>
  readBlockNumber?: () => Promise<number>
  prove?: (input: ProveRegistrationInput) => Promise<ProvedRegistration>
  submit?: (url: string, body: SubmitBody) => Promise<RelayResponse>
  /**
   * Resolves once the chain accepts; throws `RegistrationReverted` if the pool rolled back.
   *
   * Returns the block the transaction landed in, when it can be read off the receipt, for
   * `RegisterResult.registrationBlock`. `void` remains valid — a confirm that only answers
   * "it landed" is still a correct confirm, and the block is reported as `null`.
   */
  confirm?: (transactionHash: string) => Promise<number | null | void>
  /** Injected so the confirm deadline can be exercised without waiting five real minutes. */
  deadlineTimer?: DeadlineTimer
  onStage?: (stage: RegistrationStage) => void
}

/**
 * How far back to prove.
 *
 * The proving service works from blocks it has already ingested, and both free probes
 * proved at roughly ten blocks behind the head rather than at it. Ten is that
 * observation, not a protocol constant — the pool's own window is `proofValidityBlocks`,
 * read live below, and this only has to stay comfortably inside it.
 */
export const PROVING_BLOCK_LAG = 10

/**
 * Registers `account` in the pool, sponsored, and returns the stages it actually reached.
 *
 * The pre-flight runs first and every route except `unregistered` returns having issued
 * zero prover and zero relayer requests — that ordering is the difference between a free
 * "you already have an account" and a paid revert.
 */
export async function registerSponsored(
  input: RegisterInput,
  deps: RegisterDeps = {},
): Promise<RegisterResult> {
  const {
    canRegister = () => false,
    acquireSubmitLock = async () => () => {},
    preflight = preflightRegistration,
    readConstants = readPoolConstants,
    readBlockNumber = () => withFallback((p) => p.getBlockNumber()),
    prove = proveRegistration,
    submit = postSubmitToRelayer,
    confirm = defaultConfirm,
    deadlineTimer = REAL_TIMER,
    onStage,
  } = deps

  const stages: RegistrationStage[] = []
  const reach = (stage: RegistrationStage) => {
    stages.push(stage)
    try {
      onStage?.(stage)
    } catch (e) {
      // An observer is for watching, not for voting. A UI callback that throws — a
      // component unmounted mid-pipeline, say — must not abort a registration that is
      // already paying for itself.
      console.warn(`register: onStage(${stage}) observer threw and was ignored: ${String(e)}`)
    }
  }
  const fail = (failure: RegisterFailure): RegisterResult => ({ ok: false, stages, failure })

  const address = String(input.account.address)

  /**
   * Turns a pre-flight route into a decision, PROCEEDING ONLY on `unregistered`.
   *
   * Written as "proceed on exactly one value" rather than "stop on these three" because
   * the fall-through direction is the one that spends money. A fifth `PreflightRoute`
   * variant added later would otherwise compile and pay; here it hits the `never`
   * assignment and fails the build instead.
   */
  const routeToFailure = (route: PreflightRoute): RegisterFailure | null => {
    switch (route.route) {
      case 'unregistered':
        return null
      case 'already-registered':
        return { kind: 'already-registered', onChainKey: route.onChainKey }
      case 'collision':
        return { kind: 'collision', onChainKey: route.onChainKey }
      case 'blocked-rpc-unknown':
        return { kind: 'blocked-rpc-unknown', reason: route.reason }
      default: {
        const unhandled: never = route
        return {
          kind: 'blocked-rpc-unknown',
          reason: `unhandled pre-flight route ${JSON.stringify(unhandled)}`,
        }
      }
    }
  }

  // 1. Fail closed on the backup ceremony, before the pre-flight even reads the chain.
  //    `canRegister` is injected, so it can throw; a seam that throws must not reject
  //    this promise, or the caller has to handle two error channels for one outcome.
  try {
    if (!(await canRegister())) return fail({ kind: 'backup-not-confirmed' })
  } catch (e) {
    // A gate that could not answer has not said yes. Same refusal, with the reason
    // attached so the failure is debuggable rather than indistinguishable from a plain no.
    return fail({ kind: 'backup-not-confirmed', reason: String(e) })
  }

  // 2. The free gate. No stage is entered for it: nothing has been built yet.
  let route: PreflightRoute
  try {
    route = await preflight(input.accountKey, address)
  } catch (e) {
    // A malformed account key makes the derivation throw before any read happens, and an
    // injected pre-flight can throw for its own reasons. Either way the caller gets a
    // typed refusal, never a rejected promise.
    return fail({ kind: 'bad-input', reason: String(e) })
  }
  const blocked = routeToFailure(route)
  if (blocked) return fail(blocked)

  let release: () => void
  try {
    release = await acquireSubmitLock()
  } catch (e) {
    return fail({ kind: 'lock-unavailable', reason: String(e) })
  }
  try {
    // 2b. Re-run the pre-flight now that the lock is HELD. The first one answered before
    //     anything was serialised, so two tabs could both have read `unregistered` and
    //     both proceeded — the second one paying for a `NON_ZERO_VALUE` revert, which is
    //     the precise race the lock exists to prevent. The read is free; the race is not.
    let confirmedRoute: PreflightRoute
    try {
      confirmedRoute = await preflight(input.accountKey, address)
    } catch (e) {
      return fail({ kind: 'bad-input', reason: String(e) })
    }
    const stillBlocked = routeToFailure(confirmedRoute)
    if (stillBlocked) return fail(stillBlocked)

    // 3. Build. The live numbers are read here and nowhere else, so the approval, the
    //    freshness check and the fee row all describe the same reading.
    reach('build')
    let live: PoolConstants
    try {
      live = await readConstants()
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }
    if (live.paused) return fail({ kind: 'pool-paused' })
    // A fee of zero is not a free registration, it is a reading we should not act on:
    // `get_fee_amount` has never returned it, and building an approve from it would
    // produce a batch the pool rejects after the relayer has already paid the gas. An
    // unusable read is not a usable one, so it routes with the other unreadable-chain
    // cases and names itself in the reason.
    if (live.feeWei <= 0n) {
      return fail({
        kind: 'blocked-rpc-unknown',
        reason: `the pool reported a fee of ${live.feeWei} wei, which is not a fee we will build an approve from`,
      })
    }

    // The window the proof will be judged against. A pool that reports a window no wider
    // than the lag we prove at means every proof we make is born expired — and the fee
    // read gets a sanity check, so this one should too rather than being trusted because
    // it has never yet been wrong.
    if (live.proofValidityBlocks <= PROVING_BLOCK_LAG) {
      return fail({
        kind: 'blocked-rpc-unknown',
        reason:
          `the pool reported a proof validity window of ${live.proofValidityBlocks} blocks, ` +
          `which is not wider than the ${PROVING_BLOCK_LAG}-block proving lag — every proof ` +
          'built against it would already be expired',
      })
    }

    // `appName` is trimmed rather than merely defaulted: a blank or whitespace string is
    // not a submitter name, and rendering it produces `Submitted by  relayer`.
    const submitter = input.appName?.trim() || DEFAULT_APP_NAME
    const feeRow: FeeRow = { submitter, feeWei: live.feeWei, paidByUs: true }
    /** What the user would pay themselves. Same live number, different payer. */
    const selfFundedFeeRow: FeeRow = { ...feeRow, paidByUs: false }

    // 4. Prove.
    reach('prove')
    let proved: ProvedRegistration
    try {
      proved = await prove({
        accountKey: input.accountKey,
        account: input.account,
        provingBlockId: Math.max(0, live.blockNumber - PROVING_BLOCK_LAG),
      })
    } catch (e) {
      return fail({ kind: 'prover-failed', reason: String(e) })
    }

    // A proof binds to the block it was made against and the pool rejects it once
    // `proofValidityBlocks` have passed. Proving is the slow step, so the head can have
    // moved; checking here turns an unexplained on-chain revert into a branch that can
    // say "that took too long, try again".
    try {
      const currentBlock = await readBlockNumber()
      if (currentBlock - proved.provingBlockId >= live.proofValidityBlocks) {
        return fail({
          kind: 'proof-expired',
          provedAtBlock: proved.provingBlockId,
          currentBlock,
          validityBlocks: live.proofValidityBlocks,
        })
      }
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    // 5. Relay.
    reach('relay')
    let calls: Call[]
    try {
      calls = assembleRegistrationCalls(proved.call, live.feeWei)
    } catch (e) {
      // Unreachable today, because the zero-fee gate above already covers the only way
      // this throws — but that is an invariant held by a check twenty lines away, not by
      // anything local, and an exception escaping here would bypass every typed branch.
      return fail({ kind: 'bad-input', reason: String(e) })
    }
    let response: RelayResponse
    try {
      response = await submit(input.relayerUrl ?? DEFAULT_RELAYER_URL, {
        calls,
        proofFacts: proved.proofFacts,
        // The blob the facts are the facts OF. The sequencer takes both or neither, so a
        // body carrying facts alone would be refused at broadcast — after the relayer
        // signed and paid attention. See ProvedRegistration.proof.
        proof: proved.proof,
        // A registration IS the sponsorship — it mints nothing, so there is no value in the
        // transaction to reimburse the fee from and the relayer's own STRK pays it. The flag
        // is what keeps this charged to the sponsorship budget once the relayer stopped
        // treating every submission as one (story 1.16); without it a registration would be
        // metered against the plain-send cap and would never see the pay-your-own-way notice.
        sponsored: true,
      })
    } catch (e) {
      // A refusal before delivery is free to retry; anything else may already be signed.
      if (e instanceof RelayDeliveryUnknown) {
        return fail({ kind: 'confirmation-unknown', transactionHash: '', reason: String(e) })
      }
      return fail({ kind: 'relay-refused', status: 0, reason: String(e) })
    }

    // The budget is spent. This is not a dead end and must never read as one: the
    // relayer's own notice already says what the alternative is, so it is carried
    // through verbatim rather than paraphrased into a second, drifting sentence — and
    // the fee row rides along, because the self-funded screen is exactly where the
    // number the user is now being asked to pay has to be visible.
    if (response.status === 403 && response.body.reason === 'sponsorship-paused') {
      return fail({
        kind: 'pay-your-own-way',
        notice: response.body.notice ?? '',
        feeRow: selfFundedFeeRow,
      })
    }

    // A 200 we cannot read is the dangerous one: the server sends 200 ONLY with a hash,
    // so the transaction exists and we have lost its id. Reporting that as a refusal
    // invites exactly the retry that reverts NON_ZERO_VALUE.
    if (response.status === 200 && response.bodyUnreadable) {
      return fail({
        kind: 'confirmation-unknown',
        transactionHash: '',
        reason:
          'the relayer accepted the submission but its reply could not be read, so a ' +
          'transaction is in flight whose hash we do not know',
      })
    }
    const transactionHash = response.body.transactionHash
    if (response.status !== 200 || typeof transactionHash !== 'string' || !transactionHash.trim()) {
      // A 200 without a usable hash should not be possible from our own server; treat it
      // as delivered-but-unaccountable rather than refused, for the same reason as above.
      if (response.status === 200) {
        return fail({
          kind: 'confirmation-unknown',
          transactionHash: '',
          reason: 'the relayer answered 200 without a usable transaction hash',
        })
      }
      return fail({
        kind: 'relay-refused',
        status: response.status,
        reason: response.body.error ?? response.body.notice ?? 'the relayer refused the submission',
      })
    }

    // 6. Confirm. A reverted registration is mapped copy, never a raw pool code — the
    //    pool has no "already registered" error and surfaces it as `NON_ZERO_VALUE`.
    let confirmedBlock: number | null | void
    try {
      confirmedBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
    } catch (e) {
      // Only a RECEIPT that says REVERTED is a revert. A timeout, a dropped socket or an
      // RPC that stopped answering says nothing about the transaction — it may well be
      // landing right now — and calling that "the pool rejected your registration" is a
      // confident lie that would send the user to re-register over their own pending
      // write. See `assertNotReverted` for why this distinction has to be made here.
      if (e instanceof RegistrationReverted) {
        return fail({ kind: 'reverted', message: mapRegistrationError(e.revertReason) })
      }
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }
    reach('confirmed')

    return {
      ok: true,
      stages,
      transactionHash,
      feeRow,
      // Sanitized, not merely type-narrowed. `confirm` is an injection point, so the number
      // arriving here is whatever a caller's implementation returned — and the one thing it
      // feeds is a Recovery File header field that must be true or absent. A NaN, a negative
      // or a fractional block is not a block, and `null` says so.
      registrationBlock: sanitizeBlockNumber(confirmedBlock),
    }
  } finally {
    // A `finally` that throws REPLACES the result — including a success — with an
    // exception, so a lock whose release fails would erase a registration that already
    // happened. The result is decided by this point; releasing is cleanup.
    try {
      release()
    } catch (e) {
      console.warn(`register: releasing the submit lock threw and was ignored: ${String(e)}`)
    }
  }
}

/**
 * The chain executed our transaction and the pool rolled it back. Distinct from every
 * other way `confirm` can fail, because only this one means the registration definitively
 * did not happen — everything else leaves a transaction we cannot account for.
 */
export class RegistrationReverted extends Error {
  constructor(readonly revertReason: string) {
    super(revertReason)
    this.name = 'RegistrationReverted'
  }
}

/**
 * Throws `RegistrationReverted` if the receipt says the pool rolled the transaction back.
 *
 * THIS IS NOT REDUNDANT WITH `waitForTransaction`, and assuming it was is how a reverted
 * registration reported success. starknet.js defaults `errorStates` to `[]` and decides
 * success on FINALITY (`ACCEPTED_ON_L2`/`ACCEPTED_ON_L1`) — a reverted transaction reaches
 * ACCEPTED_ON_L2 like any other, so the wait RESOLVES and the receipt is the only place
 * the rollback is recorded. Passing `errorStates: [REVERTED]` would throw, but starknet.js
 * builds that error's message as `"REVERTED: ACCEPTED_ON_L2"` and drops `revert_reason` —
 * the pool's actual code, which is the one thing `mapRegistrationError` needs.
 *
 * Read positionally off a loose shape rather than through a receipt wrapper: this has to
 * hold for whatever `waitForTransaction` hands back, including a plain RPC receipt.
 */
export function assertNotReverted(receipt: unknown): void {
  const r = (receipt ?? {}) as { execution_status?: unknown; revert_reason?: unknown }
  if (r.execution_status === 'REVERTED') {
    throw new RegistrationReverted(
      typeof r.revert_reason === 'string' && r.revert_reason
        ? r.revert_reason
        : 'the pool reverted this registration and the receipt carried no reason',
    )
  }
}

/** The one rule for what counts as a block number. Anything else is `null`, never a guess. */
function sanitizeBlockNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Reads the block number off a receipt, or `null` if it does not carry a usable one.
 *
 * Read positionally off a loose shape, for the same reason `assertNotReverted` is: this has
 * to hold for whatever `waitForTransaction` hands back, including a plain RPC receipt. A
 * missing or non-integer block is `null` rather than a guess — the one thing this feeds is a
 * Recovery File header field that must be true or absent.
 */
export function readReceiptBlockNumber(receipt: unknown): number | null {
  const r = (receipt ?? {}) as { block_number?: unknown; blockNumber?: unknown }
  // Both spellings. The RPC wire format is `block_number`, and that is what a raw receipt
  // carries — but starknet.js has camelCased receipt fields before, and a caller injecting
  // `confirm` may well hand back an object built from its own SDK's shape. Reading only the
  // snake_case spelling turns that into a silent `null`: the registration succeeds, the
  // Recovery File re-issue never gets its block, and nothing anywhere reports a problem.
  return sanitizeBlockNumber(r.block_number) ?? sanitizeBlockNumber(r.blockNumber)
}

/**
 * The whole of what `defaultConfirm` does with a receipt: refuse a revert, then read the block.
 *
 * Extracted so it can be unit-tested against synthetic receipts. Left inline it was the only
 * production path producing `registrationBlock` and the only one no test ran — a fetch and a
 * decision fused into one function, where the fetch is the part that needs a chain and the
 * decision is the part that needs asserting.
 *
 * The ORDER is the substance. The block is read only after the revert check, because a
 * reverted transaction lands in a block like any other, and reporting it would hand the
 * Recovery File re-issue a registration block for a registration that did not happen.
 */
export function confirmFromReceipt(receipt: unknown): number | null {
  assertNotReverted(receipt)
  return readReceiptBlockNumber(receipt)
}

/** Waits for the chain, then checks the receipt. See `assertNotReverted` for why both. */
async function defaultConfirm(transactionHash: string): Promise<number | null> {
  return confirmFromReceipt(await withFallback((p) => p.waitForTransaction(transactionHash)))
}

/**
 * What ONE sponsored registration actually cost on mainnet, measured — never invented.
 *
 * Banked 24 Aug 2026 by `scripts/bank-sponsored-registration.ts` driving THIS pipeline
 * against the live pool, prover and relayer (story 1.13 / FR-019); the full record with
 * balance-delta cross-check is `evidence/sponsored-registration.json`, and every number
 * here resolves against the transaction hash below. This is the "no hardcoded cost" rule
 * kept the only way it can be: the literal exists because it was PAID, and it carries the
 * provenance to prove it. NOTHING RENDERS FROM IT YET: wiring it — plus the copy rework
 * the two-transaction fact forces — is a recorded obligation (deferred-work.md), not an
 * accomplished fact.
 *
 * TWO TRANSACTIONS, NOT ONE, and the second fact matters as much as the price: the prove
 * leg authenticates the registering user on-chain (`assert_valid_signature`'s SRC5 probe
 * of the user address), so the account contract MUST be deployed before registration —
 * a counterfactual address cannot register, and nothing sponsors the deployment today.
 * Copy that says "creating an account costs one Starknet transaction" is false for an
 * embedded-key cold start; render from `accountDeployment` here instead.
 *
 * The pool fee is mutable at zero notice and gas moves with the network, so this is a
 * RECORD of one real registration, not a quote — copy built from it should say "about".
 */
export const SPONSORED_REGISTRATION_EVIDENCE = {
  transactionHash: '0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d',
  block: 13805277,
  /** `get_fee_amount` at the build stage, pulled by `collect_fee` from the approve leg. */
  poolFeeWei: 6_000_000_000_000_000_000n,
  /** The receipt's `actual_fee` (FRI) the relayer paid to execute the batch. */
  gasWei: 2_594_270_938_553_438_960n,
  /** What the submitting wallet lost, exactly — matched by its balance delta. */
  totalWei: 8_594_270_938_553_438_960n,
  /** Prove-stage wall time, entry to relay entry, against the live prover over OHTTP. */
  proveMs: 5_878,
  /** The deployment the registration could not happen without. Paid separately, by the account. */
  accountDeployment: {
    transactionHash: '0x46118590a97a709232613b2de05c1f15fe58575e81a16995a940182f9e1f1b8',
    block: 13805248,
    feeWei: 54_911_450_842_067_264n,
  },
  screeningImmunity:
    'confirmed in practice: the never-screened fresh address registered successfully — a ' +
    'zero-deposit span takes the no-deposit branch, which asserts the attestation is None',
  measuredAt: '2026-08-24T18:55:47.020Z',
  record: 'evidence/sponsored-registration.json',
} as const
