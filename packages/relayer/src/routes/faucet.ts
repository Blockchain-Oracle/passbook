// POST /faucet — the starter drip. The request contributes one value (the address); the token,
// entrypoint and amount are constants. Claim and budget are burned BEFORE the transfer is sent.
import { Hono } from 'hono'

import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import type { AppEnv } from '../context.js'
import { faucetDripWei, starterDripWei } from '../env.js'
import { DRIP_ALREADY_CLAIMED, DRIP_BAD_ADDRESS, DRIP_BUDGET_SPENT, dripCall, isDrippableAddress } from '../faucet.js'
import type { SponsorDecision } from '../sponsorship.js'
import { isPlainObject, jsonError, notFound, readJson, reply, visitorOf } from './shared.js'

const LEDGER_UNWRITABLE = 'the faucet ledger could not be written; refusing to send'

export const faucetRoutes = new Hono<AppEnv>()

/**
 * Whether this address can still take the starter drip.
 *
 * `claimed` is the once-ever per-account key; `available` is whether this deployment hands one out
 * at all. Both are needed to decide whether to SHOW the offer, and they fail differently: a
 * deployment with no faucet answers 404 like every other absent feature, while a claimed address
 * answers 200 with `claimed: true`. A screen that cannot reach this shows no offer rather than a
 * broken one — see the client query, which resolves null on every failure.
 *
 * Unauthenticated and read-only, like `/allowance`: it spends nothing and reveals only what the
 * caller already knows about their own address.
 */
faucetRoutes.get('/:address', (c) => {
  const faucet = c.var.ctx.faucet
  if (!faucet) return notFound(c)
  let claimKey: string
  try {
    claimKey = `drip:${toFeltHex(asAddress(c.req.param('address')))}`
  } catch {
    return jsonError(c, 400, DRIP_BAD_ADDRESS)
  }
  // `available` is COMPUTED, not asserted. Hardcoding it true meant the screen kept offering a
  // drip after the daily budget was spent, and the press answered 429 — the failure this endpoint
  // exists to remove, reintroduced by the one field that was supposed to prevent it.
  const now = Date.now()
  const available = c.var.ctx.relayerState() === 'ok' && faucet.remaining(visitorOf(c, faucet.salt, now), now).remaining > 0
  // The SHIELDED starter rides on the same read, because a screen deciding what to offer a new
  // account needs both answers at once and neither is worth a second round trip. `wei` is a string:
  // JSON has no bigint, and a number would silently lose precision above 2^53.
  const starterKey = claimKey.replace(/^drip:/, 'starter:')
  return reply(c, 200, {
    claimed: faucet.hasClaimed(claimKey),
    available,
    starter: { wei: starterDripWei().toString(), claimed: faucet.hasClaimed(starterKey) },
  })
})

faucetRoutes.post('/', async (c) => {
  const ctx = c.var.ctx
  const faucet = ctx.faucet
  if (!faucet) return notFound(c)

  // (0) The ordinary relayer-down copy — our balance is not the caller's business.
  if (ctx.relayerState() === 'relayer-down') return jsonError(c, 503, DRIP_BUDGET_SPENT)

  // (1) One field, validated; zero is a burn that would report success.
  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')
  const address = body.value.address
  if (!isDrippableAddress(address)) return jsonError(c, 400, DRIP_BAD_ADDRESS)

  const now = Date.now()
  const visitor = visitorOf(c, faucet.salt, now)

  // (2) Budget decided BEFORE the once-ever claim is burned: a capped visitor is told to retry
  // after 00:00 UTC, and that retry must still find the claim available.
  const preview = faucet.decide(visitor, now)
  if (!preview.allow) {
    console.warn(`relayer: faucet refused (${preview.reason})`)
    return jsonError(c, 429, preview.notice)
  }

  // (3) Once per ACCOUNT: normalised so `0x123` and `0x0123` are one claim.
  const claimKey = `drip:${toFeltHex(asAddress(address))}`
  let firstClaim: boolean
  try {
    firstClaim = faucet.tryClaim(claimKey)
  } catch (e) {
    console.warn(`relayer: faucet ledger write failed: ${String(e)}`)
    return jsonError(c, 500, LEDGER_UNWRITABLE)
  }
  if (!firstClaim) return jsonError(c, 429, DRIP_ALREADY_CLAIMED)

  // (4) Spend the budget unit (same synchronous tick as the decision above; nothing yielded between).
  let decision: SponsorDecision
  try {
    decision = faucet.spend(visitor, now)
  } catch (e) {
    console.warn(`relayer: faucet budget write failed: ${String(e)}`)
    return jsonError(c, 500, LEDGER_UNWRITABLE)
  }
  if (!decision.allow) {
    console.warn(`relayer: faucet refused (${decision.reason})`)
    return jsonError(c, 429, decision.notice)
  }

  // (5) Bypasses the allowlist on purpose — the only path that may sign STRK.transfer.
  try {
    const dripWei = faucetDripWei()
    const txHash = await ctx.submit([dripCall(address, dripWei)])
    console.log(`relayer: dripped ${dripWei} wei to ${address} — ${txHash}`)
    return reply(c, 200, { txHash, amountWei: dripWei.toString() })
  } catch (e) {
    // Claim and budget unit already spent, deliberately.
    console.warn(`relayer: faucet transfer failed: ${String(e)}`)
    return jsonError(c, 503, 'the starter transfer could not be sent. Fund this account from any Starknet wallet.')
  }
})
