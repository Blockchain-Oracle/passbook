// GET /allowance/:address — how many sponsored transactions this account has left.
//
// A READ, and deliberately the only shape of read here: it decides nothing, spends nothing, and
// burns no claim. The shell polls it to render the counter, so it must be cheap and must never be
// the thing that consumes the allowance it reports.
//
// ── WHY THIS IS NOT AUTHENTICATED, AND WHY THAT IS FINE ───────────────────────────────────
//
// Anyone may ask for any address's remaining count. What leaks is how many sponsored transactions
// an address has used today — which is already public: every one of them is a transaction on
// mainnet, submitted by our relayer, with that account's registration or notes in it. An observer
// willing to read the chain has the number already. Refusing to answer would cost the owner their
// counter and cost the observer nothing.
import { Hono } from 'hono'

import { asAddress, toFeltHex } from '../../../protocol/src/address.js'
import type { AppEnv } from '../context.js'
import { jsonError, notFound, reply } from './shared.js'

export const allowanceRoutes = new Hono<AppEnv>()

allowanceRoutes.get('/:address', (c) => {
  const ledger = c.var.ctx.accountAllowance
  // Absent, not zero: a deployment that does not meter per account has no counter to show, and
  // "0 of 0" would read as an offer withdrawn. `AllowanceBody` documents the same distinction.
  if (!ledger) return notFound(c)

  let account: string
  try {
    // Normalised exactly as `/submit` normalises it, or the counter would read a different key
    // than the one being spent and drift by whatever padding the caller happened to use.
    account = toFeltHex(asAddress(c.req.param('address')))
  } catch {
    return jsonError(c, 400, 'that is not a Starknet address')
  }

  return reply(c, 200, { allowance: ledger.remaining(account) })
})
