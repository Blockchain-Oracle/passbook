//
// The free pre-flight, in the order that is the product: pool health (a paused or upgraded pool
// is not worth proving against), the recipient's key (an impossible transfer becomes an
// invitation), the relayer's fee leg (read live), then the refusals computable from the walk.
// Nothing here has asked a prover or a relayer to do anything.
//

import { PROVING_BLOCK_LAG } from './client.js'
import { SELF_SUBMIT_DISCLOSURE, SELF_SUBMIT_GAS_LOSS, type SelfSubmitOffer, type SendFailure } from './pipeline.js'
import { getPublicKey, readPoolHealth, type PoolHealth } from './pool.js'
import { preflightRecipient } from './recipient.js'
import { DEFAULT_APP_NAME, type FeeRow } from './register.js'
import { shieldedShortfall, validateCommon, type FeeLeg, type SendInput, type SendLeg, type SendRequest } from './send-plan.js'
import { legFor } from './send-prove.js'
import { RelayerMisconfigured, readFeeRecipient } from './submit.js'

export type OkHealth = Extract<PoolHealth, { state: 'ok' }>

export interface PreflightReads {
  readHealth?: () => Promise<PoolHealth>
  readRecipientKey?: (address: string) => Promise<bigint>
  readFeeRecipient?: (relayerUrl: string) => Promise<string>
}

export interface Preflighted {
  health: OkHealth
  request: SendRequest
  leg: SendLeg
  /** `null` in self mode. */
  fee: FeeLeg | null
  feeRow: FeeRow
  /** What a relayer-side refusal offers instead. */
  offer: SelfSubmitOffer
}

/** A `PoolHealth` a send can be built against, or the refusal it is. */
export function healthFailure(health: PoolHealth): SendFailure | null {
  if (health.state === 'paused') return { kind: 'pool-paused' }
  if (health.state === 'upgraded') return { kind: 'pool-upgraded', pinned: health.pinned, onchain: health.onchain }
  if (health.state === 'unreachable') return { kind: 'blocked-rpc-unknown', reason: 'the pool could not be read' }
  if (health.feeWei <= 0n) {
    return { kind: 'blocked-rpc-unknown', reason: `the pool reported a fee of ${health.feeWei} wei, which is not a fee we will build a send from` }
  }
  if (health.proofValidityBlocks <= PROVING_BLOCK_LAG) {
    return {
      kind: 'blocked-rpc-unknown',
      reason:
        `the pool reported a proof validity window of ${health.proofValidityBlocks} blocks, which is not wider than the ` +
        `${PROVING_BLOCK_LAG}-block proving lag — every proof built against it would already be expired`,
    }
  }
  return null
}

export async function preflightSend(
  input: SendInput,
  self: string,
  relayerUrl: string,
  reads: PreflightReads = {},
): Promise<Preflighted | { failure: SendFailure }> {
  const { readHealth = readPoolHealth, readRecipientKey = getPublicKey, readFeeRecipient: readFee = readFeeRecipient } = reads

  // 1. The chain.
  let raw: PoolHealth
  try {
    raw = await readHealth()
  } catch (e) {
    return { failure: { kind: 'blocked-rpc-unknown', reason: String(e) } }
  }
  const unhealthy = healthFailure(raw)
  if (unhealthy) return { failure: unhealthy }
  const health = raw as OkHealth
  const feeRow: FeeRow = { submitter: input.appName?.trim() || DEFAULT_APP_NAME, feeWei: health.feeWei, paidByUs: input.mode === 'relayer' }
  const offer: SelfSubmitOffer = { mode: 'self', feeRow: { ...feeRow, paidByUs: false }, disclosure: SELF_SUBMIT_DISCLOSURE, gasNotice: SELF_SUBMIT_GAS_LOSS }

  // 2. The recipient — only a shielded transfer needs a registered one; a withdraw names a public address.
  if (input.kind === 'transfer') {
    const route = await preflightRecipient(input.recipient, readRecipientKey)
    if (route.route === 'blocked-rpc-unknown') return { failure: { kind: 'blocked-rpc-unknown', reason: route.reason } }
    if (route.route === 'unregistered') return { failure: { kind: 'unregistered-recipient', recipient: input.recipient, door: route.door } }
  }

  // 3. Where the fee goes, read live: the relayer's signing wallet rotates without a release.
  let fee: FeeLeg | null = null
  if (input.mode === 'relayer') {
    try {
      fee = { recipient: await readFee(relayerUrl), feeWei: health.feeWei }
    } catch (e) {
      if (e instanceof RelayerMisconfigured) return { failure: { kind: 'relayer-misconfigured', reason: String(e), selfSubmit: offer } }
      return { failure: { kind: 'blocked-rpc-unknown', reason: String(e) } }
    }
  }

  // 4. The free refusals. Legs are forwarded by name — `app` was once dropped here, turning a
  //    funding op into a plain withdraw to the contract.
  const request: SendRequest = {
    kind: input.kind,
    recipient: input.recipient,
    token: input.token,
    symbol: input.symbol,
    amount: input.amount,
    mode: input.mode,
    swap: input.swap,
    bridge: input.bridge,
    app: input.app,
  }
  const leg = legFor(input.kind)
  if (!leg) return { failure: { kind: 'bad-input', reason: `refusing an unknown send kind ${JSON.stringify(input.kind)}` } }
  for (const check of [validateCommon(request, self, fee), leg.validate(request, self), shieldedShortfall(request, input.wallet, fee)]) {
    if (!check.ok) return { failure: check.failure }
  }
  return { health, request, leg, fee, feeRow, offer }
}
