// POST /submit — the one door to the relayer's key. Order is the control:
// relayer-down → body shape → live approve ceiling (only if needed) → allowlist → budget → sign.
import { Hono } from 'hono'
import type { Call } from 'starknet'

import { RELAYER_DOWN_NOTICE } from '../../../protocol/src/relayer-wire.js'
import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import { cairoPanic, rpcMethod, stripRpcParams } from '../../../protocol/src/rpc-error.js'
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

/**
 * The RPC methods that run BEFORE `starknet_addInvokeTransaction`. A throw from one of these is a
 * batch that does not exist, so both meters may be given back.
 *
 * ── MATCHED AGAINST THE METHOD, NEVER AGAINST THE MESSAGE ─────────────────────────────────
 *
 * This was a regex over the whole error string, and that was a hole worth naming: an RPC throw
 * echoes the request back, the request carries the caller's own `proof` blob, and `parseSubmitBody`
 * accepts any non-empty string there. So a client sending `proof: "starknet_getNonce"` made every
 * failure look pre-broadcast and refunded itself on each one — an unmetered key, reached with one
 * field. `rpcMethod` reads only the library's anchored prefix, which no caller can write.
 *
 * Anything not on this list MAY have landed, and refunding there would hand back a unit for a
 * transaction this relayer really did pay for. Unrecognised keeps the spend: that direction costs
 * a user one covered transaction, the other costs us a real fee.
 */
const NEVER_BROADCAST: ReadonlySet<string> = new Set(['starknet_estimateFee', 'starknet_getNonce'])

/**
 * An RPC throw carries the ENTIRE signed transaction back as `with params {…}` — hundreds of
 * kilobytes of calldata and, on a proven batch, the proof blob itself. That is the payload we
 * sent, never the reason we failed, so it is cut here rather than shipped to a browser.
 */
function briefly(text: string): string {
  const cut = stripRpcParams(text)
  if (!cut) return 'the submission failed without a stated reason'
  if (cut.length <= 600) return cut
  const short = `${cut.slice(0, 597)}…`
  // The Cairo panic sits at the DEEPEST nesting of an execution error, so it is the first thing a
  // length cap removes and the last thing worth removing. Put it back when the cut ate it.
  const panic = cairoPanic(cut)
  return panic && !cairoPanic(short) ? `${short} ('${panic}')` : short
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

  // A proven batch with no bounds would be ESTIMATED, and an estimate cannot execute the proof —
  // so it reverts on `Result::unwrap failed.` and the submission dies before it is signed. Read
  // ours rather than refusing: a client that forgot must not be able to close this door.
  if (details && !details.resourceBounds) {
    try {
      // Through the SAME gate as a client's bounds. These are spending authority over this wallet
      // whoever computed them, and ours are derived from a live gas price — a spike puts them over
      // the ceiling exactly as a hostile client would, and the cap is the only thing that binds.
      details.resourceBounds = assertResourceBounds(await ctx.resolveResourceBounds())
    } catch (e) {
      return jsonError(c, 503, `refusing to sign: a proven batch arrived without resource bounds and ours could not be built: ${String(e)}`)
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
  let budgetSpent = false
  let allowanceSpent = false
  try {
    // From the DECISION, not from the call: `spend` commits nothing when it refuses, so a flag set
    // by reaching the line would later refund a unit this request never took.
    if (budget) budgetSpent = budget.spend(visitor, now).allow
    if (allowance && account) allowanceSpent = allowance.spend(account, now).allow
  } catch (e) {
    console.warn(`relayer: ${kind} ledger write failed: ${String(e)}`)
    // Nothing is signed past this point, so a unit the FIRST ledger recorded bought nothing. Half
    // a spend is the one state neither meter can explain later: the user is charged for a refusal.
    if (budgetSpent && budget) {
      try {
        budget.refund(visitor, now)
      } catch (r) {
        console.warn(`relayer: ${kind} unit could not be unwound after a half-written spend: ${String(r)}`)
      }
    }
    return jsonError(c, 500, `the ${kind} ledger could not be written; refusing to sign`)
  }

  try {
    const transactionHash = await ctx.submit(calls, details)
    return reply(c, 200, {
      transactionHash,
      ...(allowance && account ? { sponsorship: allowance.remaining(account, now) } : {}),
    })
  } catch (e) {
    const text = String(e)
    const method = rpcMethod(text)
    if (method && NEVER_BROADCAST.has(method)) {
      // The batch does not exist, so neither meter bought anything. Give both units back before
      // answering — otherwise the next attempt is refused for a transaction that never happened.
      //
      // ONE TRY EACH. Sharing a try meant a failed write on the first ledger skipped the second
      // entirely, leaving a user's covered transaction burned for a batch that provably never
      // existed — which is the exact state this refund was added to prevent.
      if (budgetSpent && budget) {
        try {
          budget.refund(visitor, now)
        } catch (r) {
          console.warn(`relayer: ${kind} unit stays spent, its refund could not be written: ${String(r)}`)
        }
      }
      if (allowanceSpent && allowance && account) {
        try {
          allowance.refund(account, now)
        } catch (r) {
          console.warn(`relayer: allowance unit stays spent, its refund could not be written: ${String(r)}`)
        }
      }
    } else {
      console.warn(`relayer: ${kind} unit kept — a transaction may be in flight: ${briefly(text)}`)
    }
    return jsonError(c, 502, briefly(text))
  }
})
