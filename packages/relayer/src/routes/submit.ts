// POST /submit — the one door to the relayer's key. Order is the control:
// relayer-down → body shape → live approve ceiling (only if needed) → allowlist → budget → sign.
import { Hono } from 'hono'
import type { Call } from 'starknet'

import { RELAYER_DOWN_NOTICE } from '../../../protocol/src/relayer-wire.js'
import {
  assertProofFacts,
  assertResourceBounds,
  assertSubmittable,
  isPoolApplyActions,
  needsApproveCeiling,
  type ResourceBounds,
} from '../allowlist.js'
import type { AppEnv } from '../context.js'
import type { SponsorDecision } from '../sponsorship.js'
import { jsonError, reply, visitorOf } from './shared.js'

interface SubmitDetails {
  proofFacts: string[]
  proof: string
  resourceBounds?: ResourceBounds
}

/** Validates the wire body by hand — every refusal string here is a shipped contract. */
function parseSubmitBody(raw: unknown): { calls: Call[]; details?: SubmitDetails; sponsored: boolean } {
  const body = (raw ?? {}) as {
    calls?: unknown
    sponsored?: unknown
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
  return { calls, details, sponsored }
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
  try {
    ;({ calls, details, sponsored } = parseSubmitBody(await c.req.json()))
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
  const budget = sponsored ? ctx.sponsorship : ctx.sendBudget
  const kind = sponsored ? 'sponsorship' : 'send'
  if (budget) {
    const now = Date.now()
    const visitor = visitorOf(c, budget.salt, now)
    let decision: SponsorDecision
    try {
      decision = budget.spend(visitor, now)
    } catch (e) {
      console.warn(`relayer: ${kind} ledger write failed: ${String(e)}`)
      return jsonError(c, 500, `the ${kind} ledger could not be written; refusing to sign`)
    }
    if (!decision.allow) {
      // Which cap bound goes to ops, never to the caller.
      console.warn(`relayer: ${kind} refused (${decision.reason}) for visitor ${visitor.slice(0, 8)}…`)
      return reply(
        c,
        403,
        sponsored
          ? { error: 'sponsored submissions are paused', reason: 'sponsorship-paused', notice: decision.notice }
          : { error: 'relayed sends are paused', reason: 'send-cap-reached', notice: decision.notice },
      )
    }
  }

  try {
    return reply(c, 200, { transactionHash: await ctx.submit(calls, details) })
  } catch (e) {
    return jsonError(c, 502, String(e))
  }
})
