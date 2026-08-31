//
// GET /health — the one route on this server that answers an unauthenticated caller.
//
// ── WHY IT HAS TO BE PUBLIC ───────────────────────────────────────────────────────────────
//
// Every other route sits behind `x-relayer-auth`, which is right: this process holds a funded
// signing key. But it left the deployment with no way to be probed. `fly.toml` fell back to a TCP
// check, and a TCP check answers exactly one question — is a socket open — while being unable to
// answer the two that actually matter: can this process reach the chain, and can it still pay a
// fee. A relayer that is out of STRK passes a TCP check forever while refusing every submission.
//
// So this route is public and carries nothing that is not already public. The relayer's address is
// advertised by `/fee-recipient`, recorded in `evidence/sponsored-registration.json`, and printed
// in a public repository; its STRK balance is `balanceOf` on a public token, readable from any RPC
// by anyone who has that address. Publishing it here discloses nothing new — it only saves the
// operator a round trip, which is the entire point of an ops endpoint.
//
// ── WHY IT IS ALWAYS 200 ──────────────────────────────────────────────────────────────────
//
// A health check that fails gets the machine restarted, so the status code must mean "restarting
// me would help". Being out of funds is the clearest case where it would not: a restart cannot add
// STRK, so a 503 there buys a restart loop that fixes nothing and takes the chat rooms down with it
// (they are in memory — see `fly.toml`). The process being able to serve is the 200; whether it can
// currently do its job is `funding.canSign` in the body, where a human or an alert can read it.
//
// ── AND WHY IT DOES NOT READ THE CHAIN ────────────────────────────────────────────────────
//
// It answers from the funding monitor's last measurement. A health endpoint that made an RPC call
// per request would convert a slow public node into a failed check, which is the restart loop again
// by another route. `observedAt` is on the response so a stale reading is legible as stale.
//
import { Hono } from 'hono'

import { NET } from '../../../protocol/src/constants.js'
import { toPlainText } from '../../../protocol/src/amount-format.js'
import type { AppEnv } from '../context.js'
import { reply } from './shared.js'

/** STRK is 18 decimals everywhere; the balance reported here is always the fee token. */
const STRK_DECIMALS = 18

/** `SN_MAIN` reads better in an alert than the chain id felt does. */
function networkName(chainId: string): string {
  if (chainId === '0x534e5f4d41494e') return 'SN_MAIN'
  if (chainId === '0x534e5f5345504f4c4941') return 'SN_SEPOLIA'
  return chainId
}

export const healthRoutes = new Hono<AppEnv>()

healthRoutes.get('/', (c) => {
  const { relayerState, feeRecipient, fundingObserved } = c.var.ctx
  const canSign = relayerState() === 'ok'
  const seen = fundingObserved?.() ?? null

  //
  // ABSENT, NOT ZERO. Before the first measurement lands there is no balance to report, and a `0`
  // would be a statement about the wallet rather than about our knowledge of it — the same rule the
  // app follows for a shielded balance it has not walked yet. `state: 'unknown'` says which it is.
  //
  const funding = seen
    ? {
        state: seen.health,
        canSign,
        balanceWei: seen.balanceWei.toString(),
        balanceStrk: toPlainText(seen.balanceWei, STRK_DECIMALS),
        // The live pool fee this classification was made against — never a pinned constant.
        feeWei: seen.feeWei.toString(),
        feeStrk: toPlainText(seen.feeWei, STRK_DECIMALS),
        // Below `floor` the relayer refuses to sign; below `warn` ops has already been paged.
        floorWei: seen.floorWei.toString(),
        warnWei: seen.warnWei.toString(),
        observedAt: new Date(seen.at).toISOString(),
        observedAgoSeconds: Math.max(0, Math.round((Date.now() - seen.at) / 1000)),
      }
    : { state: 'unknown' as const, canSign, observedAt: null }

  return reply(c, 200, {
    ok: true,
    service: 'strk20-relayer',
    network: networkName(NET.chainId),
    // Already public via `/fee-recipient`; repeated here so one call answers "which relayer is this".
    feeRecipient: feeRecipient || null,
    uptimeSeconds: Math.round(process.uptime()),
    funding,
  })
})
