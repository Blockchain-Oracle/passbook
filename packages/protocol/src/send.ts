//
// The send dispatcher: free pre-flight (`send-preflight`) → lock → prove (`send-prove`, where the
// kinds' legs meet the SDK builder) → submit (`submit`) → confirm → mature. The vocabulary and
// results live in `send-plan` / `pipeline`. Every refusal above `prove` cost the user nothing.
//

import type { Call } from 'starknet'

import {
  CONFIRM_TIMEOUT_MS,
  REAL_TIMER,
  SELF_SUBMIT_GAS_LOSS,
  confirmOnChain,
  makeNoteMatureWatcher,
  makeStages,
  mapSendError,
  relayFailureFrom,
  revertReasonOf,
  sanitizeBlockNumber,
  withDeadline,
  type ConfirmNoteMature,
  type DeadlineTimer,
  type SendFailure,
  type SendResult,
  type SendStage,
} from './pipeline.js'
import { readPoolHealth, type PoolHealth } from './pool.js'
import { healthFailure, preflightSend, type OkHealth } from './send-preflight.js'
import { proveFailureFrom, proveSend, type ProveSendInput, type ProvedSend } from './send-prove.js'
import type { SendInput } from './send-plan.js'
import type { Allowance } from './relayer-wire.js'
import { withFallback } from './rpc.js'
import { resourceBoundsFor } from './fee-ceiling.js'
import {
  DEFAULT_RELAYER_URL,
  relayerSubmitter,
  selfSubmitApprove,
  selfSubmitter,
  type SubmitDetails,
  type Submitter,
} from './submit.js'

// ── Re-exports: the names the app imports from here ───────────────────────────────────────

export type { AppInvokeLeg, BridgeLeg, MailLeg, SendInput, SendKind, SwapLeg } from './send-plan.js'
export type { EarnLeg } from './send-earn.js'
export type { SelfSubmitOffer, SendFailure, SendResult } from './pipeline.js'

/** The self seam: the proof pair rides as v3 DETAILS, both-or-neither; an executor that drops either is rejected. */
export type SelfSubmitExecutor = (calls: Call[], details: SubmitDetails) => Promise<string>

export interface SendDeps {
  /** Two tabs spending the same notes is a double-spend one of them pays for. */
  acquireSubmitLock?: () => Promise<() => void>
  readHealth?: () => Promise<PoolHealth>
  readBlockNumber?: () => Promise<number>
  readRecipientKey?: (address: string) => Promise<bigint>
  readFeeRecipient?: (relayerUrl: string) => Promise<string>
  /** Never throws; `null` means "assume nothing is covered". */
  readAllowance?: (relayerUrl: string, account: string) => Promise<Allowance | null>
  prove?: (input: ProveSendInput) => Promise<ProvedSend>
  /** Relayer mode's submitter; defaults to `relayerSubmitter(relayerUrl)`. */
  submit?: Submitter
  /** Self mode. Defaults to the account's own `execute` when it has one, else refuses. */
  selfSubmit?: SelfSubmitExecutor
  confirm?: (transactionHash: string) => Promise<number | null | void>
  confirmNoteMature?: ConfirmNoteMature
  deadlineTimer?: DeadlineTimer
  onStage?: (stage: SendStage) => void
}

const refusingSelfSubmit: SelfSubmitExecutor = async () => {
  throw new Error('no self-submit executor was supplied, so nothing can sign from this wallet')
}

export async function sendShielded(input: SendInput, deps: SendDeps = {}): Promise<SendResult> {
  const {
    acquireSubmitLock = async () => () => {},
    readHealth = readPoolHealth,
    readBlockNumber = () => withFallback((p) => p.getBlockNumber()),
    prove = proveSend,
    deadlineTimer = REAL_TIMER,
    confirm = confirmOnChain,
    confirmNoteMature = makeNoteMatureWatcher(undefined, deadlineTimer),
    onStage,
  } = deps
  const relayerUrl = input.relayerUrl ?? DEFAULT_RELAYER_URL
  const account = input.account as { execute?: unknown }
  const selfSubmit = deps.selfSubmit ?? (typeof account.execute === 'function' ? selfSubmitter(account as never) : refusingSelfSubmit)

  const selfSubmitted = input.mode === 'self' ? ({ selfSubmitted: true } as const) : {}
  const { stages, reach } = makeStages(onStage)
  const fail = (failure: SendFailure): SendResult => ({ ok: false, stages, failure, ...selfSubmitted })
  const self = `0x${BigInt(input.account.address).toString(16)}`

  const pre = await preflightSend(input, self, relayerUrl, {
    readHealth,
    readRecipientKey: deps.readRecipientKey,
    readFeeRecipient: deps.readFeeRecipient,
    readAllowance: deps.readAllowance,
  })
  if ('failure' in pre) return fail(pre.failure)
  const { health, request, fee, feeRow, offer } = pre

  // Built AFTER the preflight, because only it knows whether this one is covered: the address
  // meters it against this account rather than its network, and `request.sponsored` tells the
  // relayer no reimbursement leg was folded, so it should charge the allowance rather than expect
  // its fee back. Passing the wrong one here is the difference between a free transaction and a
  // user paying for one we promised.
  const submit = deps.submit ?? relayerSubmitter(relayerUrl, deadlineTimer, self, request.sponsored)

  // From here the notes are committed to: the lock goes on before proving and stays on through the submission.
  let release: () => void
  try {
    release = await acquireSubmitLock()
  } catch (e) {
    return fail({ kind: 'lock-unavailable', reason: String(e) })
  }
  try {
    reach('build')
    if (fee) {
      // Re-read under the lock: a fee RISE would under-pay `collect_fee` and the relayer eats it. A fall is fine.
      let current: PoolHealth
      try {
        current = await readHealth()
      } catch (e) {
        return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
      }
      const bad = healthFailure(current)
      if (bad) return fail(bad)
      const currentWei = (current as OkHealth).feeWei
      if (currentWei > fee.feeWei) return fail({ kind: 'fee-moved', foldedWei: fee.feeWei, currentWei })
    }

    reach('prove')
    let proved: ProvedSend
    try {
      proved = await prove({ accountKey: input.accountKey, account: input.account, request, wallet: input.wallet, fee })
    } catch (e) {
      return fail(proveFailureFrom(e))
    }
    // A proof binds to its block; proving is the slow step, so the head can have moved past the window.
    try {
      const currentBlock = await readBlockNumber()
      if (currentBlock - proved.provingBlockId >= health.proofValidityBlocks) {
        return fail({ kind: 'proof-expired', provedAtBlock: proved.provingBlockId, currentBlock, validityBlocks: health.proofValidityBlocks })
      }
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    reach('relay')
    // The identical batch in both modes: `collect_fee` pulls from whoever submits, so they approve first, in-batch.
    const calls: Call[] = [selfSubmitApprove(health.feeWei), proved.call]
    const details: SubmitDetails = { proofFacts: proved.proofFacts, proof: proved.proof, resourceBounds: resourceBoundsFor(health.gasPrices) }
    let transactionHash: string
    if (input.mode === 'self') {
      try {
        transactionHash = await selfSubmit(calls, details)
      } catch (e) {
        // The user's own account was the caller: a rejected attempt was still paid for.
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
      try {
        transactionHash = await submit(calls, details)
      } catch (e) {
        return fail(relayFailureFrom(e, offer))
      }
    }

    // The receipt before the note: a reverted send mints nothing, so watching for its note burns the whole budget.
    let sendBlock: number | null | void
    try {
      sendBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
    } catch (e) {
      const reason = revertReasonOf(e)
      if (reason !== null) return fail({ kind: 'reverted', message: mapSendError(reason), transactionHash })
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }

    // Mature. Entered even with nothing to wait for: the stage list is a promise about what a send goes through.
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
          'the send landed and we stopped watching for the note it minted before the pool reported it. ' +
          'The transaction is on chain; the note may already be there.',
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
      ...(proved.mailAnchor === undefined ? {} : { mailAnchor: proved.mailAnchor }),
    }
  } finally {
    // A `finally` that throws replaces the result, so a failed release must not erase a send that happened.
    try {
      release()
    } catch (e) {
      console.warn(`send: releasing the submit lock threw and was ignored: ${String(e)}`)
    }
  }
}
