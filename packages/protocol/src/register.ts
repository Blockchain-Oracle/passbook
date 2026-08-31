//
// Registration: one zero-deposit `SetViewingKey`, proven and submitted with the STRK fee approve
// in the same multicall. Four stages — build, prove, relay, confirmed — and no `mature`: a
// registration mints nothing, so there is no note to wait for.
//
// Sponsored by default (the relayer signs, `sponsored: true` charges the sponsorship budget); the
// app swaps `deps.submit` for a self-signing one when the account can pay its own way.
//

import type { Call } from 'starknet'
import type { PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'
import { PROVING_BLOCK_LAG } from './constants.js'
import { resourceBoundsFor, type GasPrices } from './fee-ceiling.js'
import { readHead, readPoolConstants, type PoolConstants } from './pool.js'
import {
  assembleRegistrationCalls,
  proveRegistration,
  type ProveRegistrationInput,
  type ProvedRegistration,
} from './register-prove.js'
import { withFallback } from './rpc.js'
import { mapRegistrationError, preflightRegistration, type PreflightRoute } from './registration.js'
import type { RegistrationStage } from './pipeline-stage.js'
import {
  CONFIRM_TIMEOUT_MS,
  DEFAULT_RELAYER_URL,
  REAL_TIMER,
  RegistrationReverted,
  RelayDeliveryUnknown,
  confirmOnChain,
  postSubmitToRelayer,
  sanitizeBlockNumber,
  withDeadline,
  type DeadlineTimer,
  type RelayResponse,
  type SubmitBody,
} from './relay.js'

export { PROVING_BLOCK_LAG } from './constants.js'
export {
  assembleRegistrationCalls,
  extractClientActionSpan,
  proofBlobFrom,
  proveRegistration,
} from './register-prove.js'

export type RegisterFailure =
  | { kind: 'backup-not-confirmed'; reason?: string }
  | { kind: 'already-registered'; onChainKey: bigint }
  | { kind: 'collision'; onChainKey: bigint }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  | { kind: 'bad-input'; reason: string }
  | { kind: 'lock-unavailable'; reason: string }
  | { kind: 'pool-paused' }
  | { kind: 'prover-failed'; reason: string }
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  /** The relayer's budget is spent. Its notice verbatim, plus the fee row the user now pays. */
  | { kind: 'pay-your-own-way'; notice: string; feeRow: FeeRow }
  /** Refused BEFORE anything could have been signed. Retry is free. */
  | { kind: 'relay-refused'; status: number; reason: string }
  | { kind: 'reverted'; message: string }
  /** A transaction MAY be in flight; a retry risks a second registration reverting NON_ZERO_VALUE. */
  | { kind: 'confirmation-unknown'; transactionHash: string; reason: string }

export type RegisterResult =
  | { ok: true; stages: RegistrationStage[]; transactionHash: string; feeRow: FeeRow; registrationBlock: number | null }
  | { ok: false; stages: RegistrationStage[]; failure: RegisterFailure }

// ── Fee row ───────────────────────────────────────────────────────────────────────────────

export interface FeeRow {
  submitter: string
  /** The pool fee read from `get_fee_amount` at build time — never a literal. */
  feeWei: bigint
  paidByUs: boolean
}

export const POOL_SEES_DISCLOSURE = 'The pool sees this transaction, not your notes.'
export const DEFAULT_APP_NAME = 'strk20.run'

/** Wei as STRK without trailing zeros. Refuses negatives: `bigint` division would render `0.-00…1`. */
export function formatStrk(wei: bigint): string {
  if (wei < 0n) throw new Error(`refusing to render a negative amount: ${wei} wei`)
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

// ── Pipeline ──────────────────────────────────────────────────────────────────────────────

export interface RegisterInput {
  accountKey: string
  account: PrivateTransfersUser
  appName?: string
  relayerUrl?: string
  /**
   * A shielded starter to fold into the same proof, in wei. Absent for a bare registration.
   *
   * ONLY MEANINGFUL ON THE SPONSORED DOOR, and the caller has to know that: the pool pulls it from
   * whoever submits, so on the self-paid path this is the user depositing their OWN STRK and they
   * need that much again on top of the fee. `use-register.ts` passes it only when the relayer is
   * the submitter — see `STARTER_WEI` for why the amount is what it is.
   */
  starterWei?: bigint
}

/** Every default is the live implementation or a refusal — never a stub that succeeds. */
export interface RegisterDeps {
  /** The backup gate. DEFAULTS TO REFUSE: a registration is write-once. */
  canRegister?: () => boolean | Promise<boolean>
  acquireSubmitLock?: () => Promise<() => void>
  preflight?: (accountKey: string, address: string) => Promise<PreflightRoute>
  readConstants?: () => Promise<PoolConstants>
  /**
   * The head, read AFTER proving. Both halves are used and both must be current: the block number
   * decides whether the proof is still inside its validity window, and the gas prices become the
   * resource bounds. Reading prices before the prover ran — which is minutes, not seconds — is how
   * a bound gets built against a price that has since moved.
   */
  readHead?: () => Promise<{ blockNumber: number; gasPrices: GasPrices }>
  /** True when the account contract exists at `blockNumber` — the prover SRC5-probes it there. */
  isDeployedAt?: (address: string, blockNumber: number) => Promise<boolean>
  prove?: (input: ProveRegistrationInput) => Promise<ProvedRegistration>
  /** The relay hop. The app swaps in a self-signing one for the self-pay path. */
  submit?: (url: string, body: SubmitBody) => Promise<RelayResponse>
  confirm?: (transactionHash: string) => Promise<number | null | void>
  deadlineTimer?: DeadlineTimer
  onStage?: (stage: RegistrationStage) => void
}

async function deployedAt(address: string, blockNumber: number): Promise<boolean> {
  try {
    return typeof (await withFallback((p) => p.getClassHashAt(address, blockNumber))) === 'string'
  } catch {
    return false
  }
}

const routeToFailure = (route: PreflightRoute): RegisterFailure | null => {
  switch (route.route) {
    case 'unregistered':
      return null
    case 'already-registered':
      return { kind: 'already-registered', onChainKey: route.onChainKey }
    case 'collision':
      return { kind: 'collision', onChainKey: route.onChainKey }
    case 'blocked-rpc-unknown':
      return { kind: 'blocked-rpc-unknown', reason: route.reason }
    default: {
      const unhandled: never = route
      return { kind: 'blocked-rpc-unknown', reason: `unhandled pre-flight route ${JSON.stringify(unhandled)}` }
    }
  }
}

/** Registers `account` in the pool. Every route except `unregistered` returns before any prover or relayer request. */
export async function registerSponsored(input: RegisterInput, deps: RegisterDeps = {}): Promise<RegisterResult> {
  const {
    canRegister = () => false,
    acquireSubmitLock = async () => () => {},
    preflight = preflightRegistration,
    readConstants = readPoolConstants,
    readHead: head = readHead,
    isDeployedAt = deployedAt,
    prove = proveRegistration,
    submit = postSubmitToRelayer,
    confirm = confirmOnChain,
    deadlineTimer = REAL_TIMER,
    onStage,
  } = deps
  const stages: RegistrationStage[] = []
  const reach = (stage: RegistrationStage) => {
    stages.push(stage)
    try {
      onStage?.(stage)
    } catch (e) {
      console.warn(`register: onStage(${stage}) observer threw and was ignored: ${String(e)}`)
    }
  }
  const fail = (failure: RegisterFailure): RegisterResult => ({ ok: false, stages, failure })
  const address = String(input.account.address)
  const starterWei = input.starterWei

  try {
    if (!(await canRegister())) return fail({ kind: 'backup-not-confirmed' })
  } catch (e) {
    return fail({ kind: 'backup-not-confirmed', reason: String(e) })
  }
  const gate = async (): Promise<RegisterFailure | null> => {
    try {
      return routeToFailure(await preflight(input.accountKey, address))
    } catch (e) {
      return { kind: 'bad-input', reason: String(e) }
    }
  }
  const blocked = await gate()
  if (blocked) return fail(blocked)

  let release: () => void
  try {
    release = await acquireSubmitLock()
  } catch (e) {
    return fail({ kind: 'lock-unavailable', reason: String(e) })
  }
  try {
    // Re-run under the lock: two tabs can both have read `unregistered` before it was held.
    const stillBlocked = await gate()
    if (stillBlocked) return fail(stillBlocked)

    reach('build')
    let live: PoolConstants
    try {
      live = await readConstants()
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }
    if (live.paused) return fail({ kind: 'pool-paused' })
    if (live.feeWei <= 0n) {
      return fail({
        kind: 'blocked-rpc-unknown',
        reason: `the pool reported a fee of ${live.feeWei} wei, which is not a fee we will build an approve from`,
      })
    }
    if (live.proofValidityBlocks <= PROVING_BLOCK_LAG) {
      return fail({
        kind: 'blocked-rpc-unknown',
        reason:
          `the pool reported a proof validity window of ${live.proofValidityBlocks} blocks, ` +
          `which is not wider than the ${PROVING_BLOCK_LAG}-block proving lag — every proof ` +
          'built against it would already be expired',
      })
    }
    const submitter = input.appName?.trim() || DEFAULT_APP_NAME
    const feeRow: FeeRow = { submitter, feeWei: live.feeWei, paidByUs: true }

    // The prover authenticates the user at the proving block, so an account deployed within the
    // last PROVING_BLOCK_LAG blocks does not exist there yet. Nothing is spent; wait and retry.
    const provingBlockId = Math.max(0, live.blockNumber - PROVING_BLOCK_LAG)
    if (!(await isDeployedAt(address, provingBlockId))) {
      return fail({
        kind: 'blocked-rpc-unknown',
        reason:
          `the account contract is not visible at block ${provingBlockId}, which the proof is built against — ` +
          `an account deployed fewer than ${PROVING_BLOCK_LAG} blocks ago must wait for the chain to advance`,
      })
    }

    reach('prove')
    let proved: ProvedRegistration
    try {
      proved = await prove({ accountKey: input.accountKey, account: input.account, provingBlockId, starterWei })
    } catch (e) {
      return fail({ kind: 'prover-failed', reason: String(e) })
    }
    let prices: GasPrices
    try {
      const { blockNumber: currentBlock, gasPrices } = await head()
      if (currentBlock - proved.provingBlockId >= live.proofValidityBlocks) {
        return fail({ kind: 'proof-expired', provedAtBlock: proved.provingBlockId, currentBlock, validityBlocks: live.proofValidityBlocks })
      }
      prices = gasPrices
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    reach('relay')
    let calls: Call[]
    try {
      calls = assembleRegistrationCalls(proved.call, live.feeWei, starterWei ?? 0n)
    } catch (e) {
      return fail({ kind: 'bad-input', reason: String(e) })
    }
    let response: RelayResponse
    try {
      // `sponsored: true` charges the sponsorship budget rather than the plain-send cap.
      // `account` counts this against the address's own allowance — the first of the three, and
      // the one the counter starts from.
      response = await submit(input.relayerUrl ?? DEFAULT_RELAYER_URL, {
        calls,
        account: address,
        proofFacts: proved.proofFacts,
        proof: proved.proof,
        // Bounds, so the submitter SKIPS fee estimation. A bare registration mints nothing and
        // estimated cleanly, which is why this rode without them; the starter deposit made it
        // value-moving, and an estimate cannot see the proof, so it now reverts on
        // `Result::unwrap failed.` before anything is signed. Send and shield have always sent these.
        resourceBounds: resourceBoundsFor(prices),
        sponsored: true,
      })
    } catch (e) {
      if (e instanceof RelayDeliveryUnknown) return fail({ kind: 'confirmation-unknown', transactionHash: '', reason: String(e) })
      return fail({ kind: 'relay-refused', status: 0, reason: String(e) })
    }
    // Both 403s mean the same thing to a person: the subsidy is gone and this costs their own
    // STRK. `sponsorship-paused` is the shared daily budget, `allowance-spent` is this account's
    // own three — different meters, one door. Leaving the second unmapped sent it out as a bare
    // relay refusal, which is how "used its sponsored transactions" reached a screen as an error.
    if (response.status === 403 && (response.body.reason === 'sponsorship-paused' || response.body.reason === 'allowance-spent')) {
      return fail({ kind: 'pay-your-own-way', notice: response.body.notice ?? '', feeRow: { ...feeRow, paidByUs: false } })
    }
    if (response.status === 200 && response.bodyUnreadable) {
      return fail({
        kind: 'confirmation-unknown',
        transactionHash: '',
        reason: 'the relayer accepted the submission but its reply could not be read, so a transaction is in flight whose hash we do not know',
      })
    }
    const transactionHash = response.body.transactionHash
    if (response.status !== 200 || typeof transactionHash !== 'string' || !transactionHash.trim()) {
      if (response.status === 200) {
        return fail({ kind: 'confirmation-unknown', transactionHash: '', reason: 'the relayer answered 200 without a usable transaction hash' })
      }
      return fail({
        kind: 'relay-refused',
        status: response.status,
        reason: response.body.error ?? response.body.notice ?? 'the relayer refused the submission',
      })
    }

    let confirmedBlock: number | null | void
    try {
      confirmedBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
    } catch (e) {
      // Only a receipt saying REVERTED is a revert; anything else may still be landing.
      if (e instanceof RegistrationReverted) return fail({ kind: 'reverted', message: mapRegistrationError(e.revertReason) })
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }
    reach('confirmed')
    return { ok: true, stages, transactionHash, feeRow, registrationBlock: sanitizeBlockNumber(confirmedBlock) }
  } finally {
    // A throwing finally would replace a success with an exception.
    try {
      release()
    } catch (e) {
      console.warn(`register: releasing the submit lock threw and was ignored: ${String(e)}`)
    }
  }
}
