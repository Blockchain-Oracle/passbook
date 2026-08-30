// POST /submit — the one door to the relayer's key. Order is the control:
// relayer-down → body shape → live approve ceiling (only if needed) → allowlist → budget → sign.
import { Hono } from 'hono'
import type { Call } from 'starknet'

import { RELAYER_DOWN_NOTICE } from '../../../protocol/src/relayer-wire.js'
import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import {
  assertProofFacts,
  assertResourceBounds,
  assertSubmittable,
  isPoolApplyActions,
  needsApproveCeiling,
  type ResourceBounds,
} from '../allowlist.js'
import type { AppEnv } from '../context.js'
import { jsonError, reply, visitorOf } from './shared.js'

interface SubmitDetails {
  proofFacts: string[]
  proof: string
  resourceBounds?: ResourceBounds
}

/** Validates the wire body by hand — every refusal string here is a shipped contract. */
function parseSubmitBody(raw: unknown): {
  calls: Call[]
  details?: SubmitDetails
  sponsored: boolean
  covered: boolean
  account?: string
} {
  const body = (raw ?? {}) as {
    calls?: unknown
    sponsored?: unknown
    covered?: unknown
    account?: unknown
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
  return { calls, details, sponsored, covered, account }
}

export const submitRoutes = new Hono<AppEnv>()

submitRoutes.post('/', async (c) => {
  const ctx = c.var.ctx
  if (ctx.relayerState() === 'relayer-down') {
    // `state` is a legacy wire field; `reason` is what every other refusal branches on.
    return reply(c, 503, {
      error: 'the relayer is not accepting submissions right now',
      state: 'relayer-down',
      reason: 'relayer-down',
      notice: RELAYER_DOWN_NOTICE,
    })
  }

  let calls: Call[]
  let details: SubmitDetails | undefined
  let sponsored: boolean
  let covered: boolean
  let account: string | undefined
  try {
    ;({ calls, details, sponsored, covered, account } = parseSubmitBody(await c.req.json()))
  } catch (e) {
    return jsonError(c, 400, String(e))
  }

  // The live fee is read only when an approve is in the batch — chain availability is not a
  // precondition for submissions that have nothing to bound.
  let policy = ctx.policy
  if (needsApproveCeiling(calls)) {
    try {
      policy = { ...policy, maxApproveWei: await ctx.resolveApproveCeiling() }
    } catch (e) {
      return jsonError(c, 503, `refusing to sign: the live fee could not be read: ${String(e)}`)
    }
  }

  // Before the key is touched. 403: legible, just not permitted.
  try {
    assertSubmittable(calls, policy)
  } catch (e) {
    return jsonError(c, 403, String(e))
  }

  // Spend is recorded BEFORE broadcast so concurrent requests cannot share one check.
  //
  // ── BOTH LEDGERS ARE DECIDED BEFORE EITHER IS SPENT ───────────────────────────────────────
  //
  // Two meters gate this door — the IP-keyed budget that bounds abuse, and the account allowance a
  // user watches count down. Spending the first and then being refused by the second would burn a
  // unit for a transaction that never happened, and the user would have paid for a refusal. Both
  // `decide` calls are pure and synchronous, so checking them together is atomic in the same sense
  // the single check was: nothing yields between the decisions and the spends.
  const budget = sponsored ? ctx.sponsorship : ctx.sendBudget
  const kind = sponsored ? 'sponsorship' : 'send'
  // ONLY a covered batch spends the allowance. A reimbursed send costs us gas alone and must not
  // burn one of the transactions we said we would pay for — see `SubmitBody.covered`.
  const allowance = account && covered ? ctx.accountAllowance : undefined
  const now = Date.now()
  const visitor = budget ? visitorOf(c, budget.salt, now) : ''

  if (budget) {
    const d = budget.decide(visitor, now)
    if (!d.allow) {
      // Which cap bound goes to ops, never to the caller.
      console.warn(`relayer: ${kind} refused (${d.reason}) for visitor ${visitor.slice(0, 8)}…`)
      return reply(
        c,
        403,
        sponsored
          ? { error: 'sponsored submissions are paused', reason: 'sponsorship-paused', notice: d.notice }
          : { error: 'relayed sends are paused', reason: 'send-cap-reached', notice: d.notice },
      )
    }
  }
  if (allowance && account) {
    const d = allowance.decide(account, now)
    if (!d.allow) {
      console.warn(`relayer: allowance spent (${d.reason}) for account ${account.slice(0, 10)}…`)
      return reply(c, 403, {
        error: 'this account has used its sponsored transactions',
        reason: 'allowance-spent',
        notice: d.notice,
        sponsorship: allowance.remaining(account, now),
      })
    }
  }

  // Both said yes; now commit both. A write failure here refuses to sign rather than signing
  // something nobody recorded — see `SponsorshipLedger.spend`.
  try {
    if (budget) budget.spend(visitor, now)
    if (allowance && account) allowance.spend(account, now)
  } catch (e) {
    console.warn(`relayer: ${kind} ledger write failed: ${String(e)}`)
    return jsonError(c, 500, `the ${kind} ledger could not be written; refusing to sign`)
  }

  try {
    const transactionHash = await ctx.submit(calls, details)
    return reply(c, 200, {
      transactionHash,
      ...(allowance && account ? { sponsorship: allowance.remaining(account, now) } : {}),
    })
  } catch (e) {
    return jsonError(c, 502, String(e))
  }
})
