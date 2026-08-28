import { CallData, cairo, constants, type Call } from 'starknet'
import {
  AddressMap,
  createPrivateTransfers,
  type DiscoveryProviderInterface,
  type PrivateRegistry,
  type PrivateTransfersUser,
  type Proof,
} from '@starkware-libs/starknet-privacy-sdk'

import { NET, STRK_TOKEN } from './constants.js'
import { approveCeiling } from './fee-ceiling.js'
import { deriveViewingKey } from './identity.js'
import { CLIENT_ACTION } from './message-book.js'
import { readPoolHealth, type PoolHealth } from './pool.js'
import {
  CONFIRM_TIMEOUT_MS,
  PROVING_BLOCK_LAG,
  REAL_TIMER,
  RegistrationReverted,
  confirmFromReceipt,
  extractClientActionSpan,
  proofBlobFrom,
  withDeadline,
  type DeadlineTimer,
} from './register.js'
import {
  makeNoteMatureWatcher,
  type ConfirmNoteMature,
  type SelfSubmitExecutor,
} from './send.js'
import { SEND_STAGES, type SendStage } from './pipeline-stage.js'
import { withFallback } from './rpc.js'

export interface ShieldRequest {
  accountKey: string
  account: PrivateTransfersUser
  token: string
  symbol: string
  amount: bigint
  /** Public balance of `token` at the embedded Passbook address. */
  publicTokenWei: bigint
  /** Public STRK at that same address, used for the pool fee and transaction gas. */
  publicStrkWei: bigint
}

export type ShieldPoolMode = 'compatibility' | 'screening'

export interface ShieldPlan {
  request: ShieldRequest
  feeWei: bigint
  feeCeilingWei: bigint
  poolMode: ShieldPoolMode
  approvalCalls: readonly Call[]
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

const COMPATIBILITY_POOL_CLASS_HASHES = new Set([
  BigInt('0x715b22abfb60815623f4127ba64bd2f93613d8a5c1e519841eaab444659d2af'),
  BigInt('0x30b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b'),
])

export function shieldPoolModeForClassHash(classHash: string): ShieldPoolMode {
  return COMPATIBILITY_POOL_CLASS_HASHES.has(BigInt(classHash)) ? 'compatibility' : 'screening'
}

export function planShield(
  request: ShieldRequest,
  health: Extract<PoolHealth, { state: 'ok' }>,
): ShieldPlan | ShieldFailure {
  let token: bigint
  let address: bigint
  try {
    token = BigInt(request.token)
    address = BigInt(String(request.account.address))
  } catch {
    return { kind: 'bad-input', reason: 'The token or embedded account address is not a felt.' }
  }
  if (token === 0n || address === 0n) {
    return { kind: 'bad-input', reason: 'The token and embedded account address must be non-zero.' }
  }
  if (request.amount <= 0n) {
    return { kind: 'bad-input', reason: 'Enter an amount greater than zero.' }
  }
  if (health.feeWei <= 0n) {
    return { kind: 'blocked-rpc-unknown', reason: `The pool reported an unusable fee of ${health.feeWei} wei.` }
  }
  if (health.proofValidityBlocks <= PROVING_BLOCK_LAG) {
    return {
      kind: 'blocked-rpc-unknown',
      reason: 'The pool proof window is not wide enough to build a fresh shield proof.',
    }
  }

  const feeCeilingWei = approveCeiling(health.feeWei)
  const tokenIsStrk = token === BigInt(STRK_TOKEN)
  const publicTokenRequired = tokenIsStrk ? request.amount + feeCeilingWei : request.amount
  if (request.publicTokenWei < publicTokenRequired) {
    return {
      kind: 'insufficient-public-token',
      symbol: request.symbol,
      requiredWei: publicTokenRequired,
      availableWei: request.publicTokenWei,
    }
  }
  if (!tokenIsStrk && request.publicStrkWei < feeCeilingWei) {
    return {
      kind: 'insufficient-public-strk',
      requiredWei: feeCeilingWei,
      availableWei: request.publicStrkWei,
    }
  }

  return {
    request,
    feeWei: health.feeWei,
    feeCeilingWei,
    poolMode: shieldPoolModeForClassHash(NET.poolClassHash),
    approvalCalls: shieldApprovalCalls(request.token, request.amount, feeCeilingWei),
  }
}

/** Approvals are composed once so STRK's deposit and fee cannot overwrite one another. */
export function shieldApprovalCalls(token: string, amount: bigint, feeCeilingWei: bigint): Call[] {
  if (amount <= 0n || feeCeilingWei <= 0n) throw new Error('Shield approvals require positive amounts.')
  const approve = (contractAddress: string, value: bigint): Call => ({
    contractAddress,
    entrypoint: 'approve',
    calldata: CallData.compile([NET.pool, cairo.uint256(value)]),
  })
  return BigInt(token) === BigInt(STRK_TOKEN)
    ? [approve(STRK_TOKEN, amount + feeCeilingWei)]
    : [approve(token, amount), approve(STRK_TOKEN, feeCeilingWei)]
}

/**
 * Accepts only the setup prefix the SDK needs for a first self-note, followed by exactly
 * `Deposit + CreateEncNote`. No auto-selected note, withdrawal or invoke can ride along.
 */
export function assertShieldActionSpan(
  span: readonly bigint[],
  request: Pick<ShieldRequest, 'account' | 'token' | 'amount'>,
): void {
  const count = Number(span[0] ?? -1n)
  if (!Number.isInteger(count) || count < 2 || count > 4) {
    throw new Error(`refusing a shield span declaring ${span[0] ?? 'no'} actions`)
  }

  const widths: Record<number, number> = {
    [CLIENT_ACTION.OpenChannel]: 5,
    [CLIENT_ACTION.OpenSubchannel]: 7,
    [CLIENT_ACTION.Deposit]: 3,
    [CLIENT_ACTION.CreateEncNote]: 7,
  }
  const actions: { variant: number; fields: readonly bigint[] }[] = []
  let at = 1
  for (let index = 0; index < count; index++) {
    const variant = Number(span[at])
    const width = widths[variant]
    if (width === undefined || at + width > span.length) {
      throw new Error(`refusing unsupported or truncated shield action ${variant} at ${index}`)
    }
    actions.push({ variant, fields: span.slice(at + 1, at + width) })
    at += width
  }
  if (at !== span.length) throw new Error(`${span.length - at} shield calldata felts went uninspected`)

  const tail = actions.slice(-2)
  if (tail[0]?.variant !== CLIENT_ACTION.Deposit || tail[1]?.variant !== CLIENT_ACTION.CreateEncNote) {
    throw new Error('A shield must end with exactly Deposit + CreateEncNote.')
  }
  const prefix = actions.slice(0, -2).map((action) => action.variant)
  const legalPrefix =
    prefix.length === 0 ||
    (prefix.length === 1 && prefix[0] === CLIENT_ACTION.OpenSubchannel) ||
    (prefix.length === 2 &&
      prefix[0] === CLIENT_ACTION.OpenChannel &&
      prefix[1] === CLIENT_ACTION.OpenSubchannel)
  if (!legalPrefix) throw new Error('A shield carried actions outside the permitted self-channel setup prefix.')

  const self = BigInt(String(request.account.address))
  for (const action of actions.slice(0, -2)) {
    if (action.fields[0] !== self) throw new Error('Shield setup was compiled for a different recipient.')
    if (action.variant === CLIENT_ACTION.OpenSubchannel && action.fields[4] !== BigInt(request.token)) {
      throw new Error('Shield setup was compiled for a different token.')
    }
  }
  const deposit = tail[0]!
  if (deposit.fields[0] !== BigInt(request.token) || deposit.fields[1] !== request.amount) {
    throw new Error('The compiled Deposit does not match the reviewed token and amount.')
  }
  const note = tail[1]!
  if (
    note.fields[0] !== self ||
    note.fields[2] !== BigInt(request.token) ||
    note.fields[3] !== request.amount
  ) {
    throw new Error('The compiled encrypted note is not the reviewed note to self.')
  }
}

export function assertProvenShieldCall(
  call: Call,
  proof: Proof,
  mode: ShieldPoolMode,
): void {
  if (
    BigInt(call.contractAddress) !== BigInt(NET.pool) ||
    call.entrypoint !== 'apply_actions' ||
    !Array.isArray(call.calldata)
  ) {
    throw new Error('The shield proof did not produce apply_actions on the pinned pool.')
  }
  const classHash = proof.output?.[0]
  if (classHash === undefined || BigInt(classHash) !== BigInt(NET.poolClassHash)) {
    throw new Error(`The prover compiled against pool class ${classHash}, not ${NET.poolClassHash}.`)
  }
  const serverActionFelts = proof.output.length - 1
  const calldata = call.calldata as string[]
  const suffix = calldata.slice(serverActionFelts).map((felt) => BigInt(felt))
  if (mode === 'compatibility') {
    if (suffix.length !== 0) throw new Error('A compatibility pool shield carried an unexpected suffix.')
    return
  }
  if (suffix.length !== 4 || suffix[0] !== 0n || suffix.slice(1).some((felt) => felt === 0n)) {
    throw new Error('A screening pool shield did not carry the SDK screening attestation.')
  }
}

const REFUSING_NOTES: DiscoveryProviderInterface['discoverNotes'] = async () => {
  throw new Error('Shield proving must not discover shielded notes for a public deposit.')
}

export async function proveShield({ plan, provingBlockId }: ProveShieldInput): Promise<ProvedShield> {
  const { request } = plan
  const viewingKey = deriveViewingKey(request.accountKey, NET.chainId, NET.pool)
  const discoveryProvider: DiscoveryProviderInterface = {
    discoverNotes: REFUSING_NOTES,
    discoverChannels: async (address, key, recipients, params) => {
      const { IndexerDiscoveryProvider } = await import('@starkware-libs/starknet-privacy-sdk')
      return new IndexerDiscoveryProvider(NET.discovery, NET.pool).discoverChannels(
        address,
        key,
        recipients,
        params,
      )
    },
    discoverRequirement: async () => {
      throw new Error('Shielding does not discover recipient requirements.')
    },
  }
  const transfers = createPrivateTransfers({
    account: request.account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: {
      url: NET.prover,
      chainId: NET.chainId as constants.StarknetChainId,
      nodeUrl: NET.rpc[0],
      ohttp: true,
    },
    discoveryProvider,
    poolContractAddress: NET.pool,
  })
  const registry: PrivateRegistry = { channels: new AddressMap(), notes: new AddressMap() }
  const invocation = await transfers
    .build({
      registry,
      autoDiscover: { channels: 'refresh' },
      autoSetup: true,
      provingBlockId,
    })
    .with(request.token)
    .deposit({ amount: request.amount })
    .surplusTo(request.account.address)
    .createProofInvocation()

  assertShieldActionSpan(extractClientActionSpan(invocation.invocation.calldata), request)
  const { callAndProof, registry: after } = await transfers.executeWithInvocation(invocation, provingBlockId)
  assertProvenShieldCall(callAndProof.call, callAndProof.proof, plan.poolMode)
  const proofFacts = [...callAndProof.proof.proofFacts]
  if (proofFacts.length === 0) throw new Error('The prover returned no proof facts.')

  return {
    call: callAndProof.call,
    proofFacts,
    proof: proofBlobFrom(callAndProof.proof),
    provingBlockId,
    mintedNoteIds: noteIds(after),
  }
}

export function assembleShieldCalls(plan: ShieldPlan, applyActions: Call): Call[] {
  return [...plan.approvalCalls, applyActions]
}

export async function shieldPublic(request: ShieldRequest, deps: ShieldDeps = {}): Promise<ShieldResult> {
  const {
    readHealth = readPoolHealth,
    readBlockNumber = () => withFallback((provider) => provider.getBlockNumber()),
    prove = proveShield,
    selfSubmit = async () => {
      throw new Error('No embedded-account shield submitter was supplied.')
    },
    confirm = defaultConfirm,
    confirmNoteMature = makeNoteMatureWatcher(),
    onStage,
    deadlineTimer = REAL_TIMER,
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
  const fail = (failure: ShieldFailure, plan?: ShieldPlan): ShieldResult => ({
    ok: false,
    stages,
    failure,
    ...(plan ? { plan } : {}),
  })

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
        {
          kind: 'proof-expired',
          provedAtBlock: proved.provingBlockId,
          currentBlock,
          validityBlocks: health.proofValidityBlocks,
        },
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
    })
  } catch (error) {
    return fail({ kind: 'submit-failed', reason: String(error) }, planned)
  }
  if (!transactionHash.trim()) {
    return fail(
      { kind: 'confirmation-unknown', transactionHash: '', reason: 'The submitter returned no transaction hash.' },
      planned,
    )
  }

  let sendBlock: number | null | void
  try {
    sendBlock = await withDeadline(confirm(transactionHash), CONFIRM_TIMEOUT_MS, deadlineTimer)
  } catch (error) {
    if (error instanceof RegistrationReverted) {
      return fail({ kind: 'reverted', message: error.revertReason, transactionHash }, planned)
    }
    return fail({ kind: 'confirmation-unknown', reason: String(error), transactionHash }, planned)
  }

  reach('mature')
  if (!(await confirmNoteMature(proved.mintedNoteIds))) {
    return fail(
      {
        kind: 'confirmation-unknown',
        transactionHash,
        reason: 'The shield landed, but the new note was not observed before this browser stopped watching.',
      },
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

async function defaultConfirm(transactionHash: string): Promise<number | null> {
  return confirmFromReceipt(await withFallback((provider) => provider.waitForTransaction(transactionHash)))
}

export { SEND_STAGES }
