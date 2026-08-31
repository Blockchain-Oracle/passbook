//
// The starter drip pipeline: prove the deposit, hand it to the relayer, wait for the note.
//
// `register.ts` for the shape, `starter-drip.ts` for why this is its own transaction. Four stages,
// same vocabulary as registration — a drip mints one note to an account that is already registered,
// so there is nothing to preflight beyond "are they registered, and can the prover see them".
//
import type { Call } from 'starknet'
import type { PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'

import { PROVING_BLOCK_LAG } from './constants.js'
import { resourceBoundsFor, type GasPrices } from './fee-ceiling.js'
import type { RegistrationStage } from './pipeline-stage.js'
import { getPublicKey, readHead, readPoolConstants, type PoolConstants } from './pool.js'
import { assembleRegistrationCalls } from './register-prove.js'
import { withFallback } from './rpc.js'
import { proveStarterDrip } from './starter-drip.js'
import type { ProvedRegistration } from './register-prove.js'
import {
  CONFIRM_TIMEOUT_MS,
  DEFAULT_RELAYER_URL,
  REAL_TIMER,
  RegistrationReverted,
  RelayDeliveryUnknown,
  confirmOnChain,
  postSubmitToRelayer,
  withDeadline,
  type DeadlineTimer,
  type RelayResponse,
} from './relay.js'

export type StarterFailure =
  /** The pool has no key for this address: a note cannot be owned by an account that is not registered. */
  | { kind: 'not-registered' }
  /** This account already took its starting balance. The relayer's own words. */
  | { kind: 'already-claimed'; notice: string }
  | { kind: 'bad-input'; reason: string }
  | { kind: 'lock-unavailable'; reason: string }
  | { kind: 'pool-paused' }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  | { kind: 'prover-failed'; reason: string }
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  /** The relayer will not pay for this one. Its notice verbatim; there is no self-paid path — it is a gift. */
  | { kind: 'unavailable'; notice: string }
  | { kind: 'relay-refused'; status: number; reason: string }
  | { kind: 'reverted'; message: string }
  /** MAY have landed. The claim is held until the relayer's own watch reads the receipt. */
  | { kind: 'confirmation-unknown'; transactionHash: string; reason: string }

export type StarterResult =
  | { ok: true; stages: RegistrationStage[]; transactionHash: string; amountWei: bigint; block: number | null }
  | { ok: false; stages: RegistrationStage[]; failure: StarterFailure }

export interface StarterInput {
  accountKey: string
  account: PrivateTransfersUser
  /** What lands in the note. Read from the relayer, never a constant in the browser. */
  amountWei: bigint
  relayerUrl?: string
}

export interface StarterDeps {
  acquireSubmitLock?: () => Promise<() => void>
  readConstants?: () => Promise<PoolConstants>
  readHead?: typeof readHead
  readPublicKey?: (address: string) => Promise<bigint>
  isDeployedAt?: (address: string, block: number) => Promise<boolean>
  prove?: typeof proveStarterDrip
  submit?: typeof postSubmitToRelayer
  confirm?: (hash: string) => Promise<number | null>
  deadlineTimer?: DeadlineTimer
  onStage?: (stage: RegistrationStage) => void
}

/** The prover authenticates the user at the proving block; an account it cannot see there fails there. */
async function deployedAt(address: string, blockNumber: number): Promise<boolean> {
  try {
    return typeof (await withFallback((p) => p.getClassHashAt(address, blockNumber))) === 'string'
  } catch {
    return false
  }
}

/**
 * Asks the relayer to mint this account its first shielded note, paid from the relayer's wallet.
 *
 * REFUSE-DON'T-THROW, like every other pipeline here: the result is always a `StarterResult`, so a
 * caller renders a sentence rather than catching. The one genuinely ambiguous outcome keeps its own
 * kind — `confirmation-unknown` means a transaction may be in flight and a second attempt could
 * mint a second note, which is why nothing retries automatically.
 */
export async function runStarterDrip(input: StarterInput, deps: StarterDeps = {}): Promise<StarterResult> {
  const {
    acquireSubmitLock = async () => () => {},
    readConstants = readPoolConstants,
    readHead: head = readHead,
    readPublicKey = getPublicKey,
    isDeployedAt = deployedAt,
    prove = proveStarterDrip,
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
      console.warn(`starter: onStage(${stage}) observer threw and was ignored: ${String(e)}`)
    }
  }
  const fail = (failure: StarterFailure): StarterResult => ({ ok: false, stages, failure })
  const address = String(input.account.address)

  if (input.amountWei <= 0n) {
    return fail({ kind: 'bad-input', reason: `refusing a starter drip of ${input.amountWei} wei` })
  }

  let release: () => void
  try {
    release = await acquireSubmitLock()
  } catch (e) {
    return fail({ kind: 'lock-unavailable', reason: String(e) })
  }
  try {
    reach('build')
    // Registered FIRST, because the reverted attempt of 2026-08-31 was exactly this deposit against
    // an owner the pool did not know yet. A free read here is cheaper than that receipt was.
    try {
      if ((await readPublicKey(address)) === 0n) return fail({ kind: 'not-registered' })
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    let live: PoolConstants
    try {
      live = await readConstants()
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }
    if (live.paused) return fail({ kind: 'pool-paused' })
    if (live.feeWei <= 0n) {
      return fail({ kind: 'blocked-rpc-unknown', reason: `the pool reported a fee of ${live.feeWei} wei` })
    }

    const provingBlockId = Math.max(0, live.blockNumber - PROVING_BLOCK_LAG)
    try {
      if (!(await isDeployedAt(address, provingBlockId))) {
        return fail({
          kind: 'blocked-rpc-unknown',
          reason: `the account is not visible at block ${provingBlockId}, which the proof is built against`,
        })
      }
    } catch (e) {
      return fail({ kind: 'blocked-rpc-unknown', reason: String(e) })
    }

    reach('prove')
    let proved: ProvedRegistration
    try {
      proved = await prove({ accountKey: input.accountKey, account: input.account, provingBlockId, amountWei: input.amountWei })
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
      // The approve must cover the fee AND the deposit: the pool pulls both from whoever submits,
      // and that is the relayer. `assembleRegistrationCalls` refuses a starter the ceiling cannot
      // hold, which is the bound on what one drip can cost us.
      calls = assembleRegistrationCalls(proved.call, live.feeWei, input.amountWei)
    } catch (e) {
      return fail({ kind: 'bad-input', reason: String(e) })
    }
    let response: RelayResponse
    try {
      response = await submit(input.relayerUrl ?? DEFAULT_RELAYER_URL, {
        calls,
        account: address,
        proofFacts: proved.proofFacts,
        proof: proved.proof,
        // A deposit moves value, so an estimate cannot see the proof and would revert before signing.
        resourceBounds: resourceBoundsFor(prices),
        sponsored: true,
        // Principal, not one of their three. See `SubmitBody.drip`.
        drip: true,
      })
    } catch (e) {
      if (e instanceof RelayDeliveryUnknown) return fail({ kind: 'confirmation-unknown', transactionHash: '', reason: String(e) })
      return fail({ kind: 'relay-refused', status: 0, reason: String(e) })
    }
    if (response.status === 403 && response.body.reason === 'starter-claimed') {
      return fail({ kind: 'already-claimed', notice: response.body.notice ?? '' })
    }
    if (response.status === 403 || response.status === 503) {
      return fail({ kind: 'unavailable', notice: response.body.notice ?? response.body.error ?? '' })
    }
    const transactionHash = response.body.transactionHash
    if (response.status !== 200 || !transactionHash) {
      return fail({ kind: 'relay-refused', status: response.status, reason: response.body.error ?? 'the relayer refused this drip' })
    }

    reach('confirmed')
    try {
      const block = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
      return { ok: true, stages, transactionHash, amountWei: input.amountWei, block }
    } catch (e) {
      if (e instanceof RegistrationReverted) return fail({ kind: 'reverted', message: e.message })
      return fail({ kind: 'confirmation-unknown', transactionHash, reason: String(e) })
    }
  } finally {
    release()
  }
}
