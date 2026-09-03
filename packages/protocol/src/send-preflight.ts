//
// The free pre-flight, in the order that is the product: pool health (a paused or upgraded pool
// is not worth proving against), the recipient's key (an impossible transfer becomes an
// invitation), the relayer's fee leg (read live), then the refusals computable from the walk.
// Nothing here has asked a prover or a relayer to do anything.
//

import { PROVING_BLOCK_LAG } from './constants.js'
import { SELF_SUBMIT_DISCLOSURE, SELF_SUBMIT_GAS_LOSS, type SelfSubmitOffer, type SendFailure } from './pipeline.js'
import { getPublicKey, readPoolHealth, type PoolHealth } from './pool.js'
import { preflightRecipient } from './recipient.js'
import { DEFAULT_APP_NAME, type FeeRow } from './register.js'
import { shieldedShortfall, validateCommon, type FeeLeg, type SendInput, type SendLeg, type SendRequest } from './send-plan.js'
import { legFor } from './send-prove.js'
import { RelayerMisconfigured, readAllowance, readFeeRecipient } from './submit.js'
import type { Allowance } from './relayer-wire.js'

export type OkHealth = Extract<PoolHealth, { state: 'ok' }>

export interface PreflightReads {
  readHealth?: () => Promise<PoolHealth>
  readRecipientKey?: (address: string) => Promise<bigint>
  readFeeRecipient?: (relayerUrl: string) => Promise<string>
  /** Never throws; `null` means "assume nothing is covered". See `readAllowance`. */
  readAllowance?: (relayerUrl: string, account: string) => Promise<Allowance | null>
}

/**
 * Whether this account still has a sponsored transaction, as a plain boolean.
 *
 * Its own function because the fallback matters more than the happy path: anything other than a
 * positive remaining count — no allowance, a null read, a deployment that does not meter — means
 * NOT covered, and the user pays their own fee. Erring that way costs a user a fee they might have
 * avoided; erring the other way spends our wallet on a promise nobody made.
 */
async function readAllowanceFor(
  input: SendInput,
  relayerUrl: string,
  read: (relayerUrl: string, account: string) => Promise<Allowance | null>,
): Promise<boolean> {
  const allowance = await read(relayerUrl, String(input.account.address))
  return (allowance?.remaining ?? 0) > 0
}

export interface Preflighted {
  health: OkHealth
  request: SendRequest
  leg: SendLeg
  /** `null` in self mode, and also when the relayer is covering the fee (no reimbursement leg). */
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
  // ── WHO PAYS THE POOL FEE, DECIDED ONCE AND RENDERED HONESTLY ─────────────────────────────
  //
  // `paidByUs` used to be `mode === 'relayer'`, and that was WRONG for every relayed send: a
  // relayer-mode send folds a reimbursement `Withdraw` into its own proof (`send-prove.ts`), so
  // the 6 STRK leaves the USER'S notes and returns to us in the same transaction. The receipt said
  // "paid by strk20.run" while the balance dropped by exactly that amount.
  //
  // It is true only when the account has a sponsored transaction left, because that is the case
  // where no reimbursement leg is folded at all. A read that fails resolves to "not covered",
  // which charges a fee we might have absorbed rather than claiming one we did not.
  const covered =
    input.mode === 'relayer' && (await readAllowanceFor(input, relayerUrl, reads.readAllowance ?? readAllowance))
  const feeRow: FeeRow = {
    submitter: input.appName?.trim() || DEFAULT_APP_NAME,
    feeWei: health.feeWei,
    paidByUs: covered,
  }
  const offer: SelfSubmitOffer = { mode: 'self', feeRow: { ...feeRow, paidByUs: false }, disclosure: SELF_SUBMIT_DISCLOSURE, gasNotice: SELF_SUBMIT_GAS_LOSS }

  // 2. The recipient — only a shielded transfer needs a registered one; a withdraw names a public
  //    address. A mail keeps the key it reads: the memo is sealed for the channel that key names.
  let mail = input.mail
  if (input.kind === 'transfer' || input.kind === 'mail') {
    const route = await preflightRecipient(input.recipient, readRecipientKey)
    if (route.route === 'blocked-rpc-unknown') return { failure: { kind: 'blocked-rpc-unknown', reason: route.reason } }
    if (route.route === 'unregistered') return { failure: { kind: 'unregistered-recipient', recipient: input.recipient, door: route.door } }
    if (mail) mail = { ...mail, recipientPublicKey: route.publicKey }
  }

  // 3. Where the fee goes, read live: the relayer's signing wallet rotates without a release.
  //    Skipped entirely when the transaction is covered — there is no reimbursement to address,
  //    and asking for one would make a misconfigured fee recipient fail a send we were paying for.
  let fee: FeeLeg | null = null
  if (input.mode === 'relayer' && !covered) {
    try {
      fee = { recipient: await readFee(relayerUrl), feeWei: health.feeWei }
    } catch (e) {
      if (e instanceof RelayerMisconfigured) return { failure: { kind: 'relayer-misconfigured', reason: String(e), selfSubmit: offer } }
      return { failure: { kind: 'blocked-rpc-unknown', reason: String(e) } }
    }
  }

  // 4. The free refusals. Legs are forwarded by name — `app` was once dropped here, turning a
  //    funding op into a plain withdraw to the contract. An `earn` leg dropped the same way would
  //    withdraw to our helper with nothing to invoke it back out, so `validateCommon` now refuses
  //    an Earn kind carrying no leg rather than trusting this list to stay complete.
  const request: SendRequest = {
    kind: input.kind,
    recipient: input.recipient,
    token: input.token,
    symbol: input.symbol,
    amount: input.amount,
    mode: input.mode,
    sponsored: covered,
    swap: input.swap,
    earn: input.earn,
    bridge: input.bridge,
    app: input.app,
    mail,
  }
  const leg = legFor(input.kind)
  if (!leg) return { failure: { kind: 'bad-input', reason: `refusing an unknown send kind ${JSON.stringify(input.kind)}` } }
  for (const check of [validateCommon(request, self, fee), leg.validate(request, self), shieldedShortfall(request, input.wallet, fee)]) {
    if (!check.ok) return { failure: check.failure }
  }
  return { health, request, leg, fee, feeRow, offer }
}
