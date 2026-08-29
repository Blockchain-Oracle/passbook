// GET /fee-recipient — the address a reimbursement Withdraw must name. Absent or zero refuses:
// this goes into a proven, irreversible withdraw, so the operator hears it, not a user's send.
import { Hono } from 'hono'

import type { AppEnv } from '../context.js'
import { jsonError, reply } from './shared.js'

export const feeRecipientRoutes = new Hono<AppEnv>()

feeRecipientRoutes.get('/', (c) => {
  const { feeRecipient } = c.var.ctx
  if (!feeRecipient) {
    return jsonError(
      c,
      503,
      'this relayer does not advertise a fee recipient, so a reimbursement leg cannot be ' +
        'addressed; submissions that pay their own way are unaffected',
    )
  }
  let felt: bigint | null
  try {
    felt = BigInt(feeRecipient.trim())
  } catch {
    felt = null
  }
  // "0" is a well-formed felt and a burn address.
  if (felt === null || felt === 0n) {
    return jsonError(
      c,
      503,
      'this relayer is configured with a fee recipient that is not a usable address, so it ' +
        'refuses to advertise it; a reimbursement sent to it would be burned',
    )
  }
  return reply(c, 200, { feeRecipient })
})
