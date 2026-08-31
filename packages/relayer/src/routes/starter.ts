// POST /starter — the shielded starting balance, sent by this relayer's own key.
//
// Its own route rather than a shape of `/submit`, because it is not a submission a caller composed:
// the body carries ONE value, the address, and this process supplies the token, the amount, the
// proof and the signature. Nothing here spends a sponsorship unit or moves the counter a user
// watches — see `starter.ts` for why a gift is not a sponsored transaction.
import { Hono } from 'hono'

import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import { RELAYER_DOWN_NOTICE, STARTER_CLAIMED_NOTICE } from '../../../protocol/src/relayer-wire.js'
import type { AppEnv } from '../context.js'
import { utcDayKey } from '../sponsorship.js'
import { isPlainObject, jsonError, notFound, readJson, reply } from './shared.js'

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
  // Atomic: two requests racing for the last chance settle here, and only one wins.
  if (!faucet.tryClaim(claimKey)) {
    return reply(c, 409, { error: 'this account already has its starting balance', notice: STARTER_CLAIMED_NOTICE })
  }

  const outcome = await ctx.starter(address)
  if (!outcome.ok) {
    if (!outcome.keepClaim) {
      // It provably did not land, so the one chance goes back rather than being spent on a refusal.
      try {
        faucet.releaseClaim(claimKey)
      } catch (e) {
        console.warn(`relayer: the starter claim stays burned, its release could not be written: ${String(e)}`)
      }
    }
    return reply(c, 502, { error: outcome.because })
  }

  // Watched like any other spend: if the receipt says REVERTED, the claim is released and the
  // account can ask again. This is the only evidence we act on — see revert-watch.ts.
  try {
    ctx.revertWatch?.watch({
      hash: outcome.transactionHash,
      utcDay: utcDayKey(Date.now()),
      claim: claimKey,
      submittedAt: Date.now(),
    })
  } catch (e) {
    console.warn(`relayer: ${outcome.transactionHash} is unwatched, a revert will not release the claim: ${String(e)}`)
  }
  return reply(c, 200, { transactionHash: outcome.transactionHash })
})
