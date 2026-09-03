//
// The one place a send meets the SDK builder. Each kind's leg adds its actions; the builder does
// the composing (setup, note selection, surplus, open notes, invoke calldata args). The compiled
// invocation is read before it is proved — a mail is held to the note its memo was sealed for —
// and proving hands back the `apply_actions` call with its proof.
//

import type { Call } from 'starknet'
import {
  ProvingServiceError,
  ProvingServiceHttpError,
  ScreeningRejected,
  ScreeningUnavailable,
  type ExecuteOptions,
  type PrivateRegistry,
  type PrivateTransfersUser,
  type ProofInvocationResult,
} from '@starkware-libs/starknet-privacy-sdk'

import { decodeClientActions, extractClientActionSpan } from './action-span.js'
import { CLIENT_ACTION } from './client-action-index.js'
import { earnInvokeFor } from './send-earn.js'
import { EARN_CALLDATA_FELTS, earnTokens } from './earn-calldata.js'
import { marketById } from './earn-markets.js'
import { EarnSpanMismatch, assertEarnActionSpan } from './earn-guards.js'
import { EXECUTE_DEFAULTS, createPoolClient } from './client.js'
import { NET, STRK_TOKEN } from './constants.js'
import { predictMailAnchor, type MailAnchor } from './mail-anchor.js'
import { encodeMailBody } from './mail-body.js'
import { mailCalldata, sealMail } from './mail-envelope.js'
import { MailAnchorMismatch, assertMailActionSpan } from './mail-guards.js'
import type { SendFailure } from './pipeline.js'
import { appLeg } from './send-app.js'
import { bridgeLeg } from './send-bridge.js'
import { mailLeg } from './send-mail.js'
import { earnLeg } from './send-earn.js'
import { isAppKind, isEarnKind, type FeeLeg, type MailLeg, type SendKind, type SendLeg, type SendRequest, type SendWalletData } from './send-plan.js'
import { swapLeg } from './send-swap.js'
import { transferLeg, withdrawLeg } from './send-transfer.js'
import { proofDetailsFrom } from './submit.js'

/** The kind's leg, or `null` for a kind nothing here knows how to build. */
export function legFor(kind: SendKind): SendLeg | null {
  if (kind === 'transfer') return transferLeg
  if (kind === 'mail') return mailLeg
  if (kind === 'withdraw') return withdrawLeg
  if (kind === 'swap') return swapLeg
  if (isEarnKind(kind)) return earnLeg
  if (kind === 'bridge') return bridgeLeg
  return isAppKind(kind) ? appLeg : null
}

export interface ProveSendInput {
  accountKey: string
  account: PrivateTransfersUser
  request: SendRequest
  wallet: SendWalletData
  /** The reimbursement leg in relayer mode; `null` in self mode. */
  fee: FeeLeg | null
  /** Overrides for the SDK build — the offline composition check hands it a registry; the app never does. */
  buildOptions?: Partial<ExecuteOptions>
}

export interface ProvedSend {
  /** The pool's `apply_actions` call. */
  call: Call
  proofFacts: string[]
  proof: string
  provingBlockId: number
  /** Notes this send minted for the sender, by id — what the maturity watch looks for. */
  mintedNoteIds: bigint[]
  /** A mail's recipient note — the anchor its memo is keyed by on chain. */
  mailAnchor?: bigint
}

/** A sealed memo: the leg the builder composes from, and what the span guard holds it to. */
export interface SealedMail {
  leg: MailLeg
  anchor: MailAnchor
}

/**
 * Names the recipient's note and seals the memo for it. Runs before the builder so the calldata
 * is fixed when the SDK's callback asks for it, and so the guard has something to hold it to.
 */
async function sealMailFor(request: SendRequest, self: string, viewingKey: bigint, wallet: SendWalletData): Promise<SealedMail> {
  const mail = request.mail
  if (!mail) throw new Error('a mail reached the prover with no memo')
  if (mail.recipientPublicKey === undefined) throw new Error('a mail reached the prover without the recipient public key the pre-flight reads')
  const anchor = predictMailAnchor({
    self,
    viewingKey,
    recipient: request.recipient,
    recipientPublicKey: mail.recipientPublicKey,
    token: request.token,
    channels: wallet.channels,
  })
  const envelope = await sealMail(
    { chainId: NET.chainId, pool: NET.pool, mailbox: mail.mailbox, channelKey: anchor.channelKey, noteId: anchor.noteId, token: BigInt(request.token) },
    encodeMailBody(mail.body),
  )
  return { anchor, leg: { ...mail, anchor: anchor.noteId, calldata: mailCalldata(envelope) } }
}

/** Notes the SDK's refreshed registry holds that the walk the user looked at did not. */
export function mintedNoteIds(registry: PrivateRegistry, wallet: SendWalletData): bigint[] {
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

/** A send compiled and signed but not yet proved: what the guard read, and what the prover gets. */
export interface CompiledSend {
  invocation: ProofInvocationResult
  provingBlockId: number
  sealed: SealedMail | null
}

/**
 * The open-note id the SDK wrote into the compiled `InvokeExternal`.
 *
 * Its last felt, by the helper's own signature: `privacy_invoke(operation, in_token, out_token,
 * amount: u256, note_id)` serialises to six felts and `note_id` is the sixth. Read rather than
 * recomputed because the id hashes a channel key and an index the builder chose.
 */
function compiledOpenNoteId(span: readonly bigint[]): bigint {
  const invokes = decodeClientActions(span, 'earn').filter((a) => a.variant === CLIENT_ACTION.InvokeExternal)
  const invoke = invokes[0]
  if (invokes.length !== 1 || !invoke) {
    throw new EarnSpanMismatch(`the compiled transaction carries ${invokes.length} InvokeExternal actions; an Earn transaction carries one`)
  }
  // `[contract_address, calldata_len, ...calldata]` — six felts of calldata, note id last.
  const calldata = invoke.fields.slice(2)
  const noteId = calldata[EARN_CALLDATA_FELTS - 1]
  if (calldata.length !== EARN_CALLDATA_FELTS || noteId === undefined) {
    throw new EarnSpanMismatch(`the compiled Earn invoke carries ${calldata.length} felts; the helper declares ${EARN_CALLDATA_FELTS}`)
  }
  if (noteId === 0n) throw new EarnSpanMismatch('the compiled Earn invoke names note id 0, which no open note has')
  return noteId
}

/**
 * Builds, compiles and signs — everything up to the prover — and reads the span. A mail whose
 * note the SDK named differently is refused here for nothing rather than on chain for a fee.
 * Exposed so the composition can be checked against live state without proving anything.
 */
export async function compileSend(input: ProveSendInput, client = createPoolClient({ accountKey: input.accountKey, account: input.account })): Promise<CompiledSend> {
  const leg = legFor(input.request.kind)
  if (!leg) throw new Error(`no builder for a ${input.request.kind}`)
  const blockId = await client.provingBlockId()
  const self = client.address

  const sealed = input.request.kind === 'mail' ? await sealMailFor(input.request, self, client.viewingKey, input.wallet) : null
  const request: SendRequest = sealed ? { ...input.request, mail: sealed.leg } : input.request

  // Change comes back to us; that is also what makes the SDK fail fast on a shortfall.
  const builder = client.transfers.build({ ...EXECUTE_DEFAULTS, ...input.buildOptions, provingBlockId: blockId.block_number }).surplusTo(self)
  leg.compose(builder, request, self)
  if (input.fee) {
    // The reimbursement leg, frozen into the proof: the relayer cannot add it after the fact.
    builder.with(STRK_TOKEN, (t) => {
      t.withdraw({ recipient: input.fee!.recipient, amount: input.fee!.feeWei })
    })
  }

  const invocation = await builder.createProofInvocation()
  if (isEarnKind(request.kind) && request.earn) {
    // The relayer decodes nothing, so this is the only thing standing between the review the user
    // read and what actually gets proved. It runs on the compiled span, before the prover is asked.
    const leg = request.earn
    const market = marketById(leg.marketId)
    if (!market) throw new Error(`there is no Earn market called ${leg.marketId}`)
    const { inToken, outToken } = earnTokens({ direction: leg.direction, market })
    // The note id is the one felt of the calldata this code cannot predict — the SDK mints the
    // open note and names it — so it is read back out of the compiled invoke rather than guessed.
    // Everything the review actually promised (the direction, the token pair, the amount) is
    // rebuilt from the request and compared, and the span guard separately insists there is
    // exactly one open note and that it is for the output token.
    const openNoteId = compiledOpenNoteId(extractClientActionSpan(invocation.invocation.calldata))
    assertEarnActionSpan(extractClientActionSpan(invocation.invocation.calldata), {
      helper: BigInt(leg.helper),
      inToken: BigInt(inToken),
      amount: request.amount,
      outToken: BigInt(outToken),
      calldata: earnInvokeFor(leg, request.amount, openNoteId),
    })
  }
  if (sealed) {
    assertMailActionSpan(extractClientActionSpan(invocation.invocation.calldata), {
      recipient: BigInt(request.recipient),
      token: BigInt(request.token),
      amount: request.amount,
      mailbox: BigInt(sealed.leg.mailbox),
      channelKey: sealed.anchor.channelKey,
      anchor: sealed.anchor.noteId,
      calldata: sealed.leg.calldata!,
    })
  }
  return { invocation, provingBlockId: blockId.block_number, sealed }
}

/** Builds, proves and returns the proven call. Throws on any prover or composition error. */
export async function proveSend(input: ProveSendInput): Promise<ProvedSend> {
  const client = createPoolClient({ accountKey: input.accountKey, account: input.account })
  const { invocation, provingBlockId, sealed } = await compileSend(input, client)
  const { callAndProof, registry } = await client.transfers.executeWithInvocation(invocation, provingBlockId)
  const details = proofDetailsFrom(callAndProof.proof)
  return {
    call: callAndProof.call,
    proofFacts: details.proofFacts,
    proof: details.proof,
    provingBlockId,
    mintedNoteIds: mintedNoteIds(registry, input.wallet),
    ...(sealed ? { mailAnchor: sealed.anchor.noteId } : {}),
  }
}

/** What a thrown prove means. Screening verdicts and prover faults are all "nothing was signed". */
export function proveFailureFrom(e: unknown): SendFailure {
  if (e instanceof MailAnchorMismatch) return { kind: 'mail-anchor-mismatch', reason: e.message }
  if (e instanceof EarnSpanMismatch) return { kind: 'earn-span-mismatch', reason: e.message }
  if (e instanceof ScreeningRejected) {
    return { kind: 'prover-failed', reason: `the prover's screening rejected this send and will keep rejecting it: ${e.message}` }
  }
  if (e instanceof ScreeningUnavailable) {
    return { kind: 'prover-failed', reason: `the prover's screening could not be reached; try again in a moment: ${e.message}` }
  }
  if (e instanceof ProvingServiceError) {
    return { kind: 'prover-failed', reason: `the prover refused (${e.code}): ${e.message}${e.data ? ` — ${e.data}` : ''}` }
  }
  if (e instanceof ProvingServiceHttpError) {
    return { kind: 'prover-failed', reason: `the prover answered ${e.status}: ${e.message}` }
  }
  return { kind: 'prover-failed', reason: String(e) }
}
