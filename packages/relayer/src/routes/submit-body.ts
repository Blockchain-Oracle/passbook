//
// The wire body `POST /submit` accepts, parsed by hand.
//
// SPLIT OUT OF `submit.ts` BECAUSE IT IS A DIFFERENT JOB: this file decides what a request MEANS,
// and that one decides what it may SPEND. Every refusal string below is a shipped contract — a
// client reads them — so they are validated exhaustively rather than coerced, and each flag is
// accepted as exactly `true` or not at all. A flag that means something by truthiness is a flag
// that stops meaning anything.
//
import type { Call } from 'starknet'

import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import { assertProofFacts, assertResourceBounds, isPoolApplyActions, type ResourceBounds } from '../allowlist.js'

export interface SubmitDetails {
  proofFacts: string[]
  proof: string
  resourceBounds?: ResourceBounds
}

/** Validates the wire body by hand — every refusal string here is a shipped contract. */
export function parseSubmitBody(raw: unknown): {
  calls: Call[]
  details?: SubmitDetails
  sponsored: boolean
  covered: boolean
  account?: string
  drip: boolean
} {
  const body = (raw ?? {}) as {
    calls?: unknown
    sponsored?: unknown
    covered?: unknown
    account?: unknown
    drip?: unknown
    proofFacts?: unknown
    proof?: unknown
    resourceBounds?: unknown
  }
  if (!Array.isArray(body.calls) || body.calls.length === 0) {
    throw new Error('body must carry a non-empty `calls` array')
  }
  const calls = body.calls as Call[]
  let sponsored = false
  if (body.sponsored !== undefined) {
    // Exactly `true` or absent — a flag that picks the budget must mean one thing.
    if (body.sponsored !== true) {
      throw new Error(
        `refusing sponsored=${JSON.stringify(body.sponsored)}: the only accepted value is true, ` +
          'and a submission that is not sponsored omits the field entirely',
      )
    }
    sponsored = true
  }
  // Whether this batch expects NO reimbursement, so our own STRK pays the fee for good. Same
  // exactly-true-or-absent rule as `sponsored`, for the same reason: a flag that picks a meter must
  // mean one thing. A sponsored registration is never reimbursed, so it implies this.
  let covered = sponsored
  if (body.covered !== undefined) {
    if (body.covered !== true) {
      throw new Error(
        `refusing covered=${JSON.stringify(body.covered)}: the only accepted value is true, ` +
          'and a reimbursed submission omits the field entirely',
      )
    }
    covered = true
  }
  // The account this submission is FOR, so its allowance can be counted down. Optional: a body
  // without one is metered by IP alone, exactly as before this field existed.
  //
  // NORMALISED, NEVER PASSED THROUGH — `0x123` and `0x0123` are one account, and a client that
  // varied the padding would otherwise mint itself a fresh allowance per spelling. Unparseable is
  // refused rather than ignored: silently dropping it would hand out an uncounted transaction.
  let account: string | undefined
  if (body.account !== undefined) {
    try {
      account = toFeltHex(asAddress(body.account as string))
    } catch {
      throw new Error(`refusing account=${JSON.stringify(body.account)}: it is not a Starknet address`)
    }
  }
  let details: SubmitDetails | undefined
  if (body.proofFacts !== undefined) {
    if (!calls.some(isPoolApplyActions)) {
      throw new Error(
        'refusing proofFacts on a batch with no pool apply_actions: facts belong to a ' +
          'proven pool submission, and on any other batch they are arbitrary felts',
      )
    }
    // Both-or-neither: the sequencer would refuse it after signing and spending a budget unit.
    if (typeof body.proof !== 'string' || body.proof.length === 0) {
      throw new Error(
        'refusing proofFacts without their proof: the sequencer takes both or neither, ' +
          'so facts alone would be signed, broadcast, and rejected at our expense',
      )
    }
    details = { proofFacts: assertProofFacts(body.proofFacts), proof: body.proof }
    // Bounds ride only with a proof: an unproven batch estimates cleanly and should keep doing so.
    if (body.resourceBounds !== undefined) {
      details.resourceBounds = assertResourceBounds(body.resourceBounds)
    }
  } else if (body.proof !== undefined) {
    throw new Error(
      'refusing a proof without its proofFacts: the sequencer takes both or neither, ' +
        'and a blob with no facts is not a proven submission',
    )
  }
  // The starter drip: principal we give away, not a transaction we cover. Same exactly-true-or-
  // absent rule; it changes which meters run, so it must mean one thing.
  let drip = false
  if (body.drip !== undefined) {
    if (body.drip !== true) {
      throw new Error(
        `refusing drip=${JSON.stringify(body.drip)}: the only accepted value is true, ` +
          'and an ordinary submission omits the field entirely',
      )
    }
    if (!sponsored) throw new Error('refusing a drip that is not sponsored: our own key pays a drip, so it must say so')
    if (account === undefined) {
      throw new Error('refusing a drip with no account: the address the note is minted to is also the key its one-time claim burns')
    }
    drip = true
  }
  return { calls, details, sponsored, covered, account, drip }
}
