//
// Shield: public → shielded. ALWAYS self-submitted — the embedded account deposits its own public
// funds and pays `collect_fee` through in-batch approvals. No relayer, no `sponsored`.
//
// The SDK builder composes the deposit (self-channel setup for a first note via `autoSetup` +
// `autoDiscover.channels`); this module plans the approvals, checks the compiled span against the
// reviewed amount, and drives the five send stages.
//

import type { Call } from 'starknet'
import {
  createEmptyRegistry,
  type DiscoveryProviderInterface,
  type PrivateRegistry,
  type PrivateTransfersUser,
} from '@starkware-libs/starknet-privacy-sdk'
import { NET, PROVING_BLOCK_LAG, STRK_TOKEN } from './constants.js'
import { createPoolClient } from './client.js'
import { contractDiscoveryFor, poolContractFor } from './discovery.js'
import { approveCall, type Submitter } from './submit.js'
import { approveCeiling, feeFloor, resourceBoundsFor, type ResourceBounds } from './fee-ceiling.js'
import { noteExists, readPoolHealth, type PoolHealth } from './pool.js'
import { getProvider } from './rpc.js'
import { assertProvenShieldCall, assertShieldActionSpan, shieldPoolModeForClassHash, type ShieldPoolMode } from './shield-guards.js'
import { extractClientActionSpan, proofBlobFrom } from './register.js'
import {
  CONFIRM_TIMEOUT_MS,
  REAL_TIMER,
  RegistrationReverted,
  confirmOnChain,
  withDeadline,
  type DeadlineTimer,
} from './relay.js'
import type { SendStage } from './pipeline-stage.js'
import { withFallback } from './rpc.js'

export interface ShieldRequest {
  accountKey: string
  account: PrivateTransfersUser
  token: string
  symbol: string
  amount: bigint
  /** Public balance of `token` at the embedded address — the caller reads it. */
  publicTokenWei: bigint
  /** Public STRK there, for the pool fee and gas. */
  publicStrkWei: bigint
}

export interface ShieldPlan {
  request: ShieldRequest
  feeWei: bigint
  feeCeilingWei: bigint
  poolMode: ShieldPoolMode
  approvalCalls: readonly Call[]
  /** Priced from the block the plan was read against; ride as v3 details because estimation cannot see the proof. */
  resourceBounds: ResourceBounds
}

export type ShieldFailure =
  | { kind: 'bad-input'; reason: string }
  | { kind: 'pool-paused' }
  | { kind: 'pool-upgraded'; pinned: string; onchain: string }
  | { kind: 'blocked-rpc-unknown'; reason: string }
  | { kind: 'insufficient-public-token'; symbol: string; requiredWei: bigint; availableWei: bigint }
  | { kind: 'insufficient-public-strk'; requiredWei: bigint; availableWei: bigint }
  | { kind: 'prover-failed'; reason: string }
  | { kind: 'proof-expired'; provedAtBlock: number; currentBlock: number; validityBlocks: number }
  | { kind: 'submit-failed'; reason: string }
  | { kind: 'reverted'; message: string; transactionHash: string }
  | { kind: 'confirmation-unknown'; reason: string; transactionHash: string }

export type ShieldResult =
  | {
      ok: true
      stages: readonly SendStage[]
      transactionHash: string
      maturedNoteIds: readonly bigint[]
      sendBlock: number | null
      plan: ShieldPlan
    }
  | { ok: false; stages: readonly SendStage[]; failure: ShieldFailure; plan?: ShieldPlan }

export interface ProvedShield {
  call: Call
  proofFacts: string[]
  proof: string
  provingBlockId: number
  mintedNoteIds: bigint[]
}

export interface ProveShieldInput {
  plan: ShieldPlan
  provingBlockId: number
}

/** The submit seam with the proof pair REQUIRED — a shield is a proven transaction. */
export type SelfSubmitExecutor = (
  calls: Call[],
  details: NonNullable<Parameters<Submitter>[1]>,
) => ReturnType<Submitter>

/** `false` means "we stopped watching", never "the note is missing". */
export type ConfirmNoteMature = (noteIds: readonly bigint[]) => Promise<boolean>

export interface ShieldDeps {
  readHealth?: () => Promise<PoolHealth>
  readBlockNumber?: () => Promise<number>
  prove?: (input: ProveShieldInput) => Promise<ProvedShield>
  selfSubmit?: SelfSubmitExecutor
  confirm?: (transactionHash: string) => Promise<number | null | void>
  confirmNoteMature?: ConfirmNoteMature
  onStage?: (stage: SendStage) => void
  deadlineTimer?: DeadlineTimer
}

export function planShield(request: ShieldRequest, health: Extract<PoolHealth, { state: 'ok' }>): ShieldPlan | ShieldFailure {
  let token: bigint
  let address: bigint
  try {
    token = BigInt(request.token)
    address = BigInt(String(request.account.address))
  } catch {
    return { kind: 'bad-input', reason: 'The token or embedded account address is not a felt.' }
  }
  if (token === 0n || address === 0n) return { kind: 'bad-input', reason: 'The token and embedded account address must be non-zero.' }
  if (request.amount <= 0n) return { kind: 'bad-input', reason: 'Enter an amount greater than zero.' }
  if (health.feeWei <= 0n) return { kind: 'blocked-rpc-unknown', reason: `The pool reported an unusable fee of ${health.feeWei} wei.` }
  if (health.proofValidityBlocks <= PROVING_BLOCK_LAG) {
    return { kind: 'blocked-rpc-unknown', reason: 'The pool proof window is not wide enough to build a fresh shield proof.' }
  }

  const feeCeilingWei = approveCeiling(health.feeWei)
  const tokenIsStrk = token === BigInt(STRK_TOKEN)
  // The balance must hold the fee floor (fee + the live gas bound), not the allowance ceiling.
  const floorWei = feeFloor(health.feeWei, health.gasPrices)
  const publicTokenRequired = tokenIsStrk ? request.amount + floorWei : request.amount
  if (request.publicTokenWei < publicTokenRequired) {
    return { kind: 'insufficient-public-token', symbol: request.symbol, requiredWei: publicTokenRequired, availableWei: request.publicTokenWei }
  }
  if (!tokenIsStrk && request.publicStrkWei < floorWei) {
    return { kind: 'insufficient-public-strk', requiredWei: floorWei, availableWei: request.publicStrkWei }
  }
  return {
    request,
    feeWei: health.feeWei,
    feeCeilingWei,
    poolMode: shieldPoolModeForClassHash(NET.poolClassHash),
    approvalCalls: shieldApprovalCalls(request.token, request.amount, feeCeilingWei),
    resourceBounds: resourceBoundsFor(health.gasPrices),
  }
}

/** STRK gets ONE approve of deposit + fee — two approves would overwrite each other. */
export function shieldApprovalCalls(token: string, amount: bigint, feeCeilingWei: bigint): Call[] {
  if (amount <= 0n || feeCeilingWei <= 0n) throw new Error('Shield approvals require positive amounts.')
  return BigInt(token) === BigInt(STRK_TOKEN)
    ? [approveCall(STRK_TOKEN, NET.pool, amount + feeCeilingWei)]
    : [approveCall(token, NET.pool, amount), approveCall(STRK_TOKEN, NET.pool, feeCeilingWei)]
}

// A public deposit spends no note and names no stranger: only the self-channel walk is allowed.
// A silent stub would hide the day the builder starts asking, so the other two throw.
function shieldDiscovery(): DiscoveryProviderInterface {
  const channels = contractDiscoveryFor(poolContractFor(getProvider()))
  return {
    discoverNotes: async () => {
      throw new Error('Shield proving must not discover shielded notes for a public deposit.')
    },
    discoverChannels: (...args) => channels.discoverChannels(...args),
    discoverRequirement: async () => {
      throw new Error('Shielding does not discover recipient requirements.')
    },
  }
}

/** The ONE place `autoSetup`/`autoDiscover` are used: a first note needs the self channel opened. */
export async function proveShield({ plan, provingBlockId }: ProveShieldInput): Promise<ProvedShield> {
  const { request } = plan
  const { transfers } = createPoolClient(
    { accountKey: request.accountKey, account: request.account },
    { discovery: shieldDiscovery() },
  )
  const invocation = await transfers
    .build({ registry: createEmptyRegistry(), autoDiscover: { channels: 'refresh' }, autoSetup: true, provingBlockId })
    .with(request.token, (t) => t.deposit({ amount: request.amount }))
    .surplusTo(request.account.address)
    .createProofInvocation()

  assertShieldActionSpan(extractClientActionSpan(invocation.invocation.calldata), request)
  const { callAndProof, registry: after } = await transfers.executeWithInvocation(invocation, provingBlockId)
  assertProvenShieldCall(callAndProof.call, callAndProof.proof, plan.poolMode)
  const proofFacts = [...callAndProof.proof.proofFacts]
  if (proofFacts.length === 0) throw new Error('The prover returned no proof facts.')
  return { call: callAndProof.call, proofFacts, proof: proofBlobFrom(callAndProof.proof), provingBlockId, mintedNoteIds: noteIds(after) }
}

export function assembleShieldCalls(plan: ShieldPlan, applyActions: Call): Call[] {
  return [...plan.approvalCalls, applyActions]
}

const MATURE_POLL_MS = 5_000

/** Polls `get_note` for every minted id within the confirm budget; a hung read is deadlined too. */
function makeNoteWatcher(timer: DeadlineTimer): ConfirmNoteMature {
  return async (ids) => {
    const pending = new Set(ids)
    const until = Date.now() + CONFIRM_TIMEOUT_MS
    while (pending.size > 0) {
      const left = until - Date.now()
      if (left <= 0) return false
      for (const id of [...pending]) {
        try {
          if (await withDeadline(noteExists(id), left, timer)) pending.delete(id)
        } catch {
          // Retried until the budget runs out.
        }
      }
      if (pending.size > 0) await new Promise((r) => timer.setTimeout(() => r(undefined), MATURE_POLL_MS))
    }
    return true
  }
}

export async function shieldPublic(request: ShieldRequest, deps: ShieldDeps = {}): Promise<ShieldResult> {
  const {
    readHealth = readPoolHealth,
    readBlockNumber = () => withFallback((p) => p.getBlockNumber()),
    prove = proveShield,
    selfSubmit = async () => {
      throw new Error('No embedded-account shield submitter was supplied.')
    },
    confirm = confirmOnChain,
    deadlineTimer = REAL_TIMER,
    confirmNoteMature = makeNoteWatcher(deadlineTimer),
    onStage,
  } = deps
  const stages: SendStage[] = []
  const reach = (stage: SendStage) => {
    stages.push(stage)
    try {
      onStage?.(stage)
    } catch {
      // Observers never control the operation.
    }
  }
  const fail = (failure: ShieldFailure, plan?: ShieldPlan): ShieldResult => ({ ok: false, stages, failure, ...(plan ? { plan } : {}) })

  let health: PoolHealth
  try {
    health = await readHealth()
  } catch (error) {
    return fail({ kind: 'blocked-rpc-unknown', reason: String(error) })
  }
  if (health.state === 'paused') return fail({ kind: 'pool-paused' })
  if (health.state === 'upgraded') return fail({ kind: 'pool-upgraded', pinned: health.pinned, onchain: health.onchain })
  if (health.state === 'unreachable') return fail({ kind: 'blocked-rpc-unknown', reason: 'The pool could not be read.' })

  const planned = planShield(request, health)
  if ('kind' in planned) return fail(planned)

  reach('build')
  reach('prove')
  let proved: ProvedShield
  try {
    proved = await prove({ plan: planned, provingBlockId: Math.max(0, health.blockNumber - PROVING_BLOCK_LAG) })
  } catch (error) {
    return fail({ kind: 'prover-failed', reason: String(error) }, planned)
  }
  try {
    const currentBlock = await readBlockNumber()
    if (currentBlock - proved.provingBlockId >= health.proofValidityBlocks) {
      return fail(
        { kind: 'proof-expired', provedAtBlock: proved.provingBlockId, currentBlock, validityBlocks: health.proofValidityBlocks },
        planned,
      )
    }
  } catch (error) {
    return fail({ kind: 'blocked-rpc-unknown', reason: String(error) }, planned)
  }

  reach('relay')
  let transactionHash: string
  try {
    transactionHash = await selfSubmit(assembleShieldCalls(planned, proved.call), {
      proofFacts: proved.proofFacts,
      proof: proved.proof,
      resourceBounds: planned.resourceBounds,
    })
  } catch (error) {
    return fail({ kind: 'submit-failed', reason: String(error) }, planned)
  }
  if (!transactionHash.trim()) {
    return fail({ kind: 'confirmation-unknown', transactionHash: '', reason: 'The submitter returned no transaction hash.' }, planned)
  }

  let sendBlock: number | null | void
  try {
    sendBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
  } catch (error) {
    // Raw revert reason on purpose: the send table's copy does not describe a deposit.
    if (error instanceof RegistrationReverted) return fail({ kind: 'reverted', message: error.revertReason, transactionHash }, planned)
    return fail({ kind: 'confirmation-unknown', reason: String(error), transactionHash }, planned)
  }

  reach('mature')
  if (!(await confirmNoteMature(proved.mintedNoteIds))) {
    return fail(
      { kind: 'confirmation-unknown', transactionHash, reason: 'The shield landed, but the new note was not observed before this browser stopped watching.' },
      planned,
    )
  }
  reach('confirmed')
  return {
    ok: true,
    stages,
    transactionHash,
    maturedNoteIds: proved.mintedNoteIds,
    sendBlock: typeof sendBlock === 'number' && sendBlock >= 0 ? sendBlock : null,
    plan: planned,
  }
}

function noteIds(registry: PrivateRegistry): bigint[] {
  const ids: bigint[] = []
  for (const [, notes] of registry.notes.entries()) {
    for (const note of notes) ids.push(BigInt(note.id as string | number | bigint))
  }
  return ids
}
