// POST /starter — the shielded starting balance, sent by this relayer's own key.
//
// Its own route rather than a shape of `/submit`, because it is not a submission a caller composed:
// the body carries ONE value, the address, and this process supplies the token, the amount, the
// proof and the signature. Nothing here spends a sponsorship unit or moves the counter a user
// watches — see `starter.ts` for why a gift is not a sponsored transaction.
//
// ── TWO METERS, AND FOR A WHILE THERE WAS ONLY ONE ────────────────────────────────────────
//
// The once-per-account claim stops an account taking two. It never stopped one person opening
// twenty accounts, and it could not: a registration can be SELF-paid, which spends no sponsorship
// unit, so nothing upstream was counting either. The only remaining brake was the wallet's own
// funding floor — "keep paying until we are nearly broke", ~12 STRK at a time — and it worked
// exactly once, in the direction of broke. The day budget below is the missing half.
import { Hono } from 'hono'

import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import { RELAYER_DOWN_NOTICE, STARTER_CLAIMED_NOTICE } from '../../../protocol/src/relayer-wire.js'
import type { AppEnv } from '../context.js'
import { utcDayKey } from '../sponsorship.js'
import { isPlainObject, jsonError, lifetimeVisitorOf, notFound, readJson, reply } from './shared.js'

export const starterRoutes = new Hono<AppEnv>()

/** The claim key. Normalised so `0x123` and `0x0123` are one account, exactly as `/submit` does. */
const keyFor = (address: string) => `starter:${toFeltHex(asAddress(address))}`

starterRoutes.post('/', async (c) => {
  const ctx = c.var.ctx
  const faucet = ctx.faucet
  // No claim ledger, or no starter configured, means this deployment hands none out.
  if (!faucet || !ctx.starter) return notFound(c)
  if (ctx.relayerState() === 'relayer-down') {
    return reply(c, 503, { error: 'the relayer is not sending right now', notice: RELAYER_DOWN_NOTICE })
  }

  const body = await readJson(c)
  if (!body.ok) return body.res
  if (!isPlainObject(body.value)) return jsonError(c, 400, 'body must be a JSON object')
  let address: string
  let claimKey: string
  try {
    address = toFeltHex(asAddress(body.value.address as string))
    claimKey = keyFor(address)
  } catch {
    return jsonError(c, 400, 'that is not a Starknet address')
  }

  // Read before burning, so a refusal costs an account nothing.
  if (faucet.hasClaimed(claimKey)) {
    return reply(c, 409, { error: 'this account already has its starting balance', notice: STARTER_CLAIMED_NOTICE })
  }

  // ── THE DAY'S BUDGET IS DECIDED BEFORE THE ONCE-EVER CLAIM IS BURNED ──────────────────────
  //
  // The same rule `/faucet` follows, for the same reason and with more at stake here. A claim is
  // permanent: burning one and then refusing for a budget reason would cost this account its
  // starting balance forever, in exchange for nothing. Both meters are permanent now, so the
  // order is the only thing that keeps a refusal from costing something — decide first, burn
  // second, and a capped visitor is turned away without having spent anything.
  const budget = ctx.starterBudget
  const now = Date.now()
  const visitor = budget ? lifetimeVisitorOf(c, budget.salt) : ''
  if (budget) {
    const d = budget.decide(visitor, now)
    if (!d.allow) {
      // Which cap bound is ours to know; the caller gets one sentence either way.
      console.warn(`relayer: starter refused (${d.reason}) for visitor ${visitor.slice(0, 8)}…`)
      return reply(c, 403, { error: 'starting balances are paused', reason: 'starter-paused', notice: d.notice })
    }
  }

  // Atomic: two requests racing for the last chance settle here, and only one wins.
  if (!faucet.tryClaim(claimKey)) {
    return reply(c, 409, { error: 'this account already has its starting balance', notice: STARTER_CLAIMED_NOTICE })
  }

  // Committed after the claim, and a write failure here gives the claim straight back: half a
  // spend is the one state neither meter can explain later. `spend` persists before it mutates,
  // so a throw means nothing was recorded — see `SponsorshipLedger.spend`.
  let budgetSpent = false
  try {
    if (budget) budgetSpent = budget.spend(visitor, now).allow
  } catch (e) {
    console.warn(`relayer: the starter budget could not be written: ${String(e)}`)
    try {
      faucet.releaseClaim(claimKey)
    } catch (r) {
      console.warn(`relayer: the starter claim stays burned after a failed budget write: ${String(r)}`)
    }
    return jsonError(c, 500, 'the starter budget could not be written; refusing to send')
  }

  const outcome = await ctx.starter(address)
  if (!outcome.ok) {
    if (!outcome.keepClaim) {
      // It provably did not land, so the one chance goes back rather than being spent on a refusal.
      // ONE TRY EACH, like `/submit`: a failed release must not skip the budget refund beside it.
      try {
        faucet.releaseClaim(claimKey)
      } catch (e) {
        console.warn(`relayer: the starter claim stays burned, its release could not be written: ${String(e)}`)
      }
      if (budgetSpent && budget) {
        try {
          budget.refund(visitor, now)
        } catch (e) {
          console.warn(`relayer: the starter budget unit stays spent, its refund could not be written: ${String(e)}`)
        }
      }
    }
    return reply(c, 502, { error: outcome.because })
  }

  // Watched like any other spend: if the receipt says REVERTED, the claim is released and the
  // account can ask again. This is the only evidence we act on — see revert-watch.ts.
  try {
    ctx.revertWatch?.watch({
      hash: outcome.transactionHash,
      // The day the SPEND was stamped with, not today's — they differ across a rollover, and the
      // refund declines rather than rewriting a fresh day's counters.
      utcDay: utcDayKey(now),
      claim: claimKey,
      // The budget unit rides with the claim: a revert delivered no note, so neither was earned.
      ...(budgetSpent ? { visitor, meter: 'starter' as const } : {}),
      submittedAt: now,
    })
  } catch (e) {
    console.warn(`relayer: ${outcome.transactionHash} is unwatched, a revert will not release the claim: ${String(e)}`)
  }
  return reply(c, 200, { transactionHash: outcome.transactionHash })
})
