//
// The submitter seam: one signature for "sign and broadcast these calls with this proof", with a
// self implementation (the user's own account) and a relayer implementation (POST /api/submit).
//
// Two facts the seam exists to carry. The proof pair rides as v3 transaction DETAILS, both-or-
// neither — the sequencer rejects `proof_facts` without `proof`, and receipts never echo either.
// And starknet.js's fee estimate cannot see those details, so every value-moving proven
// transaction reverts inside `estimateFee`; explicit resource bounds make it skip the estimate.
//

import type { Proof } from '@starkware-libs/starknet-privacy-sdk'
import { CallData, cairo, type Call } from 'starknet'

import { NET, STRK_TOKEN } from './constants.js'
import { approveCeiling } from './fee-ceiling.js'
import {
  DEFAULT_RELAYER_URL,
  RELAY_TIMEOUT_MS,
  REAL_TIMER,
  RelayDeliveryUnknown,
  postSubmitToRelayer,
  withDeadline,
  type DeadlineTimer,
  type RelayResponse,
} from './relay.js'
import type { FeeRecipientBody } from './relayer-wire.js'

export { DEFAULT_RELAYER_URL }

/** Bigints, not hex strings: `ResourceBoundsBN` is what `execute` consumes; hex throws before signing. */
export interface ResourceBounds {
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint }
}

export interface SubmitDetails {
  proofFacts: string[]
  proof: string
  resourceBounds?: ResourceBounds
}

/** Signs and broadcasts; resolves to the transaction hash. Throws are classified by the caller. */
export type Submitter = (calls: Call[], details?: SubmitDetails) => Promise<string>

/**
 * Ceilings for a value-moving proven transaction, sized from the measured create probe (88M l2)
 * with a lean margin. A ceiling is a BALANCE requirement — the sequencer refuses bounds that
 * exceed the sender's balance — so this reserves ~4.7 STRK, well under the relayer's 20 STRK cap.
 */
export const DEFAULT_RESOURCE_BOUNDS: ResourceBounds = {
  l2_gas: { max_amount: 120_000_000n, max_price_per_unit: 35_000_000_000n },
  l1_gas: { max_amount: 5_000n, max_price_per_unit: 100_000_000_000_000n },
  l1_data_gas: { max_amount: 30_000n, max_price_per_unit: 300_000_000_000n },
}

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/** The v3 details a proof rides as. Both-or-neither, enforced here so a mismatch never reaches the wire. */
export function proofDetailsFrom(proof: Proof): { proofFacts: string[]; proof: string } {
  if (typeof proof.data !== 'string' || !proof.data) {
    throw new Error('the prover returned no proof blob alongside its facts; the sequencer rejects proof_facts without proof')
  }
  const facts = proof.proofFacts
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error('the prover returned no proof facts; a proven call cannot be submitted without them')
  }
  for (const fact of facts) {
    if (typeof fact !== 'string' || !FELT.test(fact)) {
      throw new Error(`the prover returned a proof fact that is not a felt: ${JSON.stringify(fact)}`)
    }
  }
  return { proofFacts: [...facts], proof: proof.data }
}

/** `token.approve(spender, wei)`. `collect_fee` pulls from the caller, so the approve rides in the same batch. */
export function approveCall(token: string, spender: string, wei: bigint): Call {
  if (wei <= 0n) throw new Error(`refusing to approve ${wei} wei`)
  return { contractAddress: token, entrypoint: 'approve', calldata: CallData.compile([spender, cairo.uint256(wei)]) }
}

/** The STRK approve every proven pool batch opens with: the fee ceiling, to the pool. */
export function selfSubmitApprove(feeWei: bigint): Call {
  return approveCall(STRK_TOKEN, NET.pool, approveCeiling(feeWei))
}

/** What `selfSubmitter` needs of a starknet `Account`: `execute` with v3 details. */
export interface ExecutingAccount {
  execute(calls: Call[], details?: object): Promise<{ transaction_hash: string }>
}

/** Self mode: the user's own account signs; its in-batch approve pays `collect_fee`. */
export function selfSubmitter(account: ExecutingAccount): Submitter {
  return async (calls, details) => {
    const { transaction_hash } = await account.execute(calls, details)
    return transaction_hash
  }
}

/** Thrown by `relayerSubmitter` when the relayer answered with something other than a hash. */
export class RelayRefused extends Error {
  constructor(
    readonly status: number,
    /** The branch token (`send-cap-reached`, `sponsorship-paused`, `relayer-down`), when the relayer sent one. */
    readonly reason: string | undefined,
    readonly error: string | undefined,
    readonly notice: string | undefined,
  ) {
    super(error ?? notice ?? `the relayer refused the submission (${status})`)
    this.name = 'RelayRefused'
  }
}

/**
 * Relayer mode: POST the batch with the proof pair and NO `sponsored` flag — a send reimburses the
 * relayer from its own proven action chain and must not spend the sponsorship budget.
 *
 * Resolves only with a usable hash. A 200 whose body cannot be read, or carries no hash, is a
 * transaction that EXISTS with an id we lost: `RelayDeliveryUnknown`, never a clean refusal.
 */
export function relayerSubmitter(url: string = DEFAULT_RELAYER_URL, timer: DeadlineTimer = REAL_TIMER): Submitter {
  return async (calls, details) => {
    if (!details) throw new Error('refusing to relay a pool batch without its proof details')
    const body = { calls, proofFacts: details.proofFacts, proof: details.proof, resourceBounds: details.resourceBounds }
    let response: RelayResponse
    try {
      // The fetch carries its own abort; the outer deadline only guards a timer that never fires.
      response = await withDeadline(postSubmitToRelayer(url, body, RELAY_TIMEOUT_MS), RELAY_TIMEOUT_MS + 1_000, timer)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('timed out')) {
        throw new RelayDeliveryUnknown(`the relayer did not answer (${e.message}); a transaction may already be in flight`)
      }
      throw e
    }
    if (response.status === 200 && response.bodyUnreadable) {
      throw new RelayDeliveryUnknown(
        'the relayer accepted the submission but its reply could not be read, so a transaction is in flight whose hash we do not know',
      )
    }
    const hash = response.body.transactionHash
    if (response.status === 200) {
      if (typeof hash === 'string' && hash.trim()) return hash
      throw new RelayDeliveryUnknown('the relayer answered 200 without a usable transaction hash')
    }
    throw new RelayRefused(response.status, response.body.reason, response.body.error, response.body.notice)
  }
}

// ── The relayer's fee recipient ───────────────────────────────────────────────────────────

/** A relayer wired wrong: never retry, offer self-submission. Distinct from unreachable. */
export class RelayerMisconfigured extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RelayerMisconfigured'
  }
}

const FEE_RECIPIENT_TIMEOUT_MS = 10_000

/** Where a reimbursement `Withdraw` must go. Read live — the signing wallet rotates without a release. */
export async function readFeeRecipient(
  relayerUrl: string,
  timer: DeadlineTimer = REAL_TIMER,
  timeoutMs: number = FEE_RECIPIENT_TIMEOUT_MS,
): Promise<string> {
  const url = relayerUrl.replace(/\/submit$/, '/fee-recipient')
  if (url === relayerUrl) {
    throw new RelayerMisconfigured(
      `cannot derive a fee-recipient endpoint from ${JSON.stringify(relayerUrl)}: it does not end in /submit`,
    )
  }
  const res = await withDeadline(fetch(url, { headers: { accept: 'application/json' } }), timeoutMs, timer)
  const body = (await res.json().catch(() => ({}))) as FeeRecipientBody | null
  const advertised = body?.feeRecipient
  if (res.status !== 200 || typeof advertised !== 'string' || !advertised.trim()) {
    throw new RelayerMisconfigured(
      `the relayer did not advertise a fee recipient (${res.status}): without one there is no ` +
        'address to reimburse, and guessing it would send the fee somewhere nobody is watching',
    )
  }
  // This address feeds an irreversible Withdraw: `"0"` is a well-formed felt that burns it.
  let felt: bigint
  try {
    felt = BigInt(advertised)
  } catch {
    throw new RelayerMisconfigured(`the relayer advertised a fee recipient that is not a felt address: ${JSON.stringify(advertised)}`)
  }
  if (felt === 0n) throw new RelayerMisconfigured('the relayer advertised a fee recipient of 0; a reimbursement sent there is burned')
  return advertised
}
