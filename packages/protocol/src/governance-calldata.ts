//
// Payload builders for `contracts/src/governance.cairo` — pure, refuse-don't-throw, in
// `market-calldata.ts`'s exact grammar. Every layout here is transcribed from the Cairo op it
// feeds, and the snforge suite asserts the same shapes from the other side.
//
// The ballot builder additionally carries the COMMITMENT VECTOR — the per-option curve points
// `governance-commitment.ts` mints — so the one file that knows the payload layout is the one
// that places the points in it.
//

export const GOV_OP = {
  ballot: 1,
  join: 2,
  delegate: 3,
  fund: 4,
  reclaim: 5,
  revoke: 6,
} as const

export type GovOp = (typeof GOV_OP)[keyof typeof GOV_OP]

/** Option semantics, fixed by the contract: 0 AGAINST, 1 FOR, 2 ABSTAIN when present. */
export const GOV_OPT_AGAINST = 0
export const GOV_OPT_FOR = 1

export const GOV_MAX_BATCH = 64

export type CalldataResult =
  | {
      readonly state: 'ready'
      readonly calldata: readonly string[]
      readonly noteIdSlots: readonly number[]
    }
  | { readonly state: 'refused'; readonly because: string }

function felt(value: bigint | number | string): string | null {
  try {
    if (typeof value === 'string' && value.trim() === '') return null
    const n = BigInt(value)
    if (n < 0n) return null
    return `0x${n.toString(16)}`
  } catch {
    return null
  }
}

const U128 = 1n << 128n
const U64 = 1n << 64n

function bounded(value: bigint | number | string, ceiling: bigint): string | null {
  const f = felt(value)
  if (f === null) return null
  return BigInt(f) < ceiling ? f : null
}

const NOTE_ID_PLACEHOLDER = '0x0'

const refuse = (because: string): CalldataResult => ({ state: 'refused', because })

function envelope(
  op: number,
  payload: readonly string[],
  noteIdSlots: readonly number[] = [],
): CalldataResult {
  return {
    state: 'ready',
    calldata: [`0x${op.toString(16)}`, `0x${payload.length.toString(16)}`, ...payload],
    noteIdSlots,
  }
}

/** One commitment point, affine. The vector is one of these per option. */
export interface BallotPoint {
  readonly x: bigint
  readonly y: bigint
}

export interface BallotInput {
  houseId: number
  proposalId: number
  /** The identity's FULL committed weight after this ballot — own escrow plus any drawn pot. */
  newTotalWeight: bigint
  /**
   * The bearer secret's commitment for NEW escrow, or null for a pure change of mind (and for
   * member-mode ballots, which escrow nothing). The contract enforces the same rule from its
   * side: value without a commitment refuses, a commitment without value refuses.
   */
  reclaimCommitment: bigint | string | null
  drawPot: boolean
  /** One point per option, `mintBallotVector`'s output. */
  vector: readonly BallotPoint[]
  /** The sealed choice+blinds — `sealBallot`'s felts, opaque here. */
  sealed: readonly string[]
}

/**
 * `[house, proposal, new_total, reclaim_commitment, draw_pot, (x, y) × options, ...sealed]` —
 * `op_ballot`'s exact read order.
 */
export function ballotPayload(input: BallotInput): CalldataResult {
  const house = bounded(input.houseId, U64)
  if (house === null) return refuse('the house id is not a u64')
  const proposal = bounded(input.proposalId, U64)
  if (proposal === null) return refuse('the proposal id is not a u64')
  const weight = bounded(input.newTotalWeight, U128)
  if (weight === null) return refuse('the weight is not a u128')
  const reclaim = input.reclaimCommitment === null ? '0x0' : felt(input.reclaimCommitment)
  if (reclaim === null) return refuse('the reclaim commitment is not a felt')
  if (input.vector.length < 2 || input.vector.length > 3) {
    return refuse(`a ballot carries 2 or 3 option commitments, not ${input.vector.length}`)
  }
  if (input.sealed.length === 0) {
    return refuse('a ballot travels with its sealed choice, and this one carried none')
  }
  const points: string[] = []
  for (const [i, point] of input.vector.entries()) {
    const x = felt(point.x)
    const y = felt(point.y)
    if (x === null || y === null || BigInt(x) === 0n) {
      return refuse(`option ${i}'s commitment is not a curve point`)
    }
    points.push(x, y)
  }
  const sealed: string[] = []
  for (const [i, f] of input.sealed.entries()) {
    const s = felt(f)
    if (s === null) return refuse(`sealed felt ${i} is not a felt`)
    sealed.push(s)
  }
  return envelope(GOV_OP.ballot, [
    house,
    proposal,
    weight,
    reclaim,
    input.drawPot ? '0x1' : '0x0',
    ...points,
    ...sealed,
  ])
}

/** `[house_id, invite_secret]` — `op_join`. Zero-value; the identity is the whole payload. */
export function joinPayload(input: { houseId: number; inviteSecret: bigint | string }): CalldataResult {
  const house = bounded(input.houseId, U64)
  if (house === null) return refuse('the house id is not a u64')
  const secret = felt(input.inviteSecret)
  if (secret === null || BigInt(secret) === 0n) return refuse('the invite secret is not a felt')
  return envelope(GOV_OP.join, [house, secret])
}

/** `[house_id, delegate_handle, amount, reclaim_commitment]` — `op_delegate`. */
export function delegatePayload(input: {
  houseId: number
  delegate: bigint | string
  amount: bigint
  reclaimCommitment: bigint | string
}): CalldataResult {
  const house = bounded(input.houseId, U64)
  if (house === null) return refuse('the house id is not a u64')
  const delegate = felt(input.delegate)
  if (delegate === null || BigInt(delegate) === 0n) return refuse('the delegate handle is not a felt')
  const amount = bounded(input.amount, U128)
  if (amount === null || BigInt(amount) === 0n) return refuse('the amount is not a positive u128')
  const reclaim = felt(input.reclaimCommitment)
  if (reclaim === null || BigInt(reclaim) === 0n) return refuse('the reclaim commitment is not a felt')
  return envelope(GOV_OP.delegate, [house, delegate, amount, reclaim])
}

/** `[house_id, amount]` — `op_fund`. Given, not lent: no commitment, no way back. */
export function fundPayload(input: { houseId: number; amount: bigint }): CalldataResult {
  const house = bounded(input.houseId, U64)
  if (house === null) return refuse('the house id is not a u64')
  const amount = bounded(input.amount, U128)
  if (amount === null || BigInt(amount) === 0n) return refuse('the amount is not a positive u128')
  return envelope(GOV_OP.fund, [house, amount])
}

/**
 * `[n, (secret, note_id) × n]` — `op_reclaim` and `op_revoke` share the settling shape. The note
 * ids are the compiler's; their slots are reported, `claimPayload`'s discipline.
 */
function settlingPayload(op: number, secrets: readonly (bigint | string)[]): CalldataResult {
  if (secrets.length === 0) return refuse('nothing to reclaim')
  if (secrets.length > GOV_MAX_BATCH) {
    return refuse(`a batch settles at most ${GOV_MAX_BATCH} escrows, not ${secrets.length}`)
  }
  const payload: string[] = [`0x${secrets.length.toString(16)}`]
  const noteIdSlots: number[] = []
  for (const [i, raw] of secrets.entries()) {
    const secret = felt(raw)
    if (secret === null || BigInt(secret) === 0n) return refuse(`secret ${i} is not a felt`)
    payload.push(secret)
    // +2 for the `[op, len]` envelope; the note id follows its secret.
    noteIdSlots.push(2 + payload.length)
    payload.push(NOTE_ID_PLACEHOLDER)
  }
  return envelope(op, payload, noteIdSlots)
}

export function reclaimPayload(secrets: readonly (bigint | string)[]): CalldataResult {
  return settlingPayload(GOV_OP.reclaim, secrets)
}

export function revokePayload(secrets: readonly (bigint | string)[]): CalldataResult {
  return settlingPayload(GOV_OP.revoke, secrets)
}

/** The open notes an op mints — `market-calldata.ts`'s contract, kept: settling 1:1, else 0. */
export function expectedOpenNotes(op: number, entryCount: number): number {
  return op === GOV_OP.reclaim || op === GOV_OP.revoke ? entryCount : 0
}
