//
// Serialising a Launch operation into the pool's invoke calldata (story: token launches).
//
// Same envelope as `market-calldata.ts` — `[op, payload_len, ...payload]` against the fixed
// `privacy_invoke` selector — and the same purity rule: no `starknet.js`, no hashing, because the
// build gate bans the `poseidon` graph from every emitted chunk and a launch surface imports this.
// Commitments arrive already hashed; `commitment.ts` owns that step from inside the lazy graph.
//
// The two settling ops share their layout with a market claim, so they share its serialiser. That
// is not incidental tidiness: the duplicate-secret and duplicate-note checks inside it are the two
// that turn a whole reverted batch into a refusal, and one copy of them is one copy to keep right.
//

import { settlementPayload, type CalldataResult } from './market-calldata.js'

/** The ops `Launch::privacy_invoke` dispatches on. Transcribed from `launch.cairo`. */
export const LAUNCH_OP = {
  buy: 1,
  redeem: 2,
  refund: 3,
} as const

export type { CalldataResult } from './market-calldata.js'

const U64 = 1n << 64n
const U32 = 1n << 32n

export const MAX_BATCH = 64

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

function bounded(value: bigint | number | string, ceiling: bigint): string | null {
  const f = felt(value)
  if (f === null) return null
  return BigInt(f) < ceiling ? f : null
}

const refuse = (because: string): CalldataResult => ({ state: 'refused', because })

/** One purchase. `units`, never tokens — the unit is the granularity the curve is priced in. */
export interface LaunchBuy {
  launchId: number | bigint
  /**
   * Whole units. A unit is a sixteenth of an epoch's tranche, and the contract has no notion of a
   * fractional one: an epoch holds exactly sixteen, which is what makes an epoch boundary always
   * land on a unit boundary.
   */
  units: number
  commitment: bigint | string
}

/** `[n, (launch_id, units, commitment) × n]`. */
export function buyPayload(buys: readonly LaunchBuy[]): CalldataResult {
  if (buys.length === 0) return refuse('There were no purchases to send.')
  if (buys.length > MAX_BATCH) {
    return refuse(`${buys.length} purchases is more than one transaction carries; the limit is ${MAX_BATCH}.`)
  }

  const payload: string[] = [`0x${buys.length.toString(16)}`]
  const seen = new Set<string>()

  for (const [i, buy] of buys.entries()) {
    const launchId = bounded(buy.launchId, U64)
    if (launchId === null) return refuse(`Purchase ${i + 1} names a launch that is not a launch id.`)

    // The integer check runs FIRST, before parsing. `BigInt(2.5)` throws, so a fractional count
    // would otherwise come back through the generic parse failure as "buys nothing" — a true
    // refusal with a misleading reason, which is the kind a surface renders and a user cannot act on.
    if (!Number.isInteger(buy.units)) {
      return refuse(`Purchase ${i + 1} asks for ${buy.units} units, and units do not divide.`)
    }

    const units = bounded(buy.units, U32)
    if (units === null || BigInt(units) === 0n) {
      return refuse(`Purchase ${i + 1} buys nothing.`)
    }

    const commitment = felt(buy.commitment)
    if (commitment === null || BigInt(commitment) === 0n) {
      return refuse(`Purchase ${i + 1} has no commitment, so nothing could ever redeem it.`)
    }
    // The contract refuses this as `COMMITMENT_USED`. Sharing one commitment across two purchases
    // means the second one's money has no way back out.
    if (seen.has(commitment)) {
      return refuse(
        `Purchases ${i + 1} and an earlier one share a commitment, so one of them could never be redeemed.`,
      )
    }
    seen.add(commitment)

    payload.push(launchId, units, commitment)
  }

  // A buy mints no open notes, so there is no slot the compiler fills.
  return {
    state: 'ready',
    calldata: [`0x${LAUNCH_OP.buy.toString(16)}`, `0x${payload.length.toString(16)}`, ...payload],
    noteIdSlots: [],
  }
}

/**
 * `[n, (secret, note_id) × n]` — post-graduation, pays LAUNCH TOKENS into the pool.
 *
 * Day-0 verification is what makes this legal: the deployed pool has no token allowlist anywhere in
 * its deposit path (proven live against a phantom token at an address with no contract), so a token
 * that did not exist when the transaction was planned can still be deposited. The client emits an
 * `OpenSubchannel` for it in the same transaction — the pool's one real requirement
 * (`SUBCHANNEL_NOT_FOUND`).
 */
export function redeemPayload(secrets: readonly (bigint | string)[]): CalldataResult {
  return settlementPayload(LAUNCH_OP.redeem, secrets, 'redemption')
}

/** `[n, (secret, note_id) × n]` — post-failure, pays the STAKE token back. */
export function refundPayload(secrets: readonly (bigint | string)[]): CalldataResult {
  return settlementPayload(LAUNCH_OP.refund, secrets, 'refund')
}
