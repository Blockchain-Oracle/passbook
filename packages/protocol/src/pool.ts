//
// Pool view calls. Every mutable protocol number (fee, pause, proof validity, auditor key) is
// read at call time — none is a constant (the fee was 4 STRK once; the upgrade delay is zero).
//

import { NET } from './constants.js'
import type { GasPrices } from './fee-ceiling.js'
import { withFallback } from './rpc.js'

async function call(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return withFallback((p) => p.callContract({ contractAddress: NET.pool, entrypoint, calldata }))
}

/** The head and its gas prices from one block read: bounds are priced against the block they will land in. */
export async function readHead(): Promise<{ blockNumber: number; gasPrices: GasPrices }> {
  return withFallback(async (p) => {
    const block = (await p.getBlockWithTxHashes('latest')) as {
      block_number?: unknown
      l1_gas_price?: { price_in_fri?: unknown }
      l2_gas_price?: { price_in_fri?: unknown }
      l1_data_gas_price?: { price_in_fri?: unknown }
    }
    const fri = (name: string, v: unknown): bigint => {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'bigint') throw new Error(`the latest block carries no ${name}`)
      const n = BigInt(v)
      if (n <= 0n) throw new Error(`the latest block reports a ${name} of ${n}`)
      return n
    }
    if (typeof block.block_number !== 'number') throw new Error('the latest block carries no block_number')
    return {
      blockNumber: block.block_number,
      gasPrices: {
        l1GasFri: fri('l1_gas_price', block.l1_gas_price?.price_in_fri),
        l2GasFri: fri('l2_gas_price', block.l2_gas_price?.price_in_fri),
        l1DataGasFri: fri('l1_data_gas_price', block.l1_data_gas_price?.price_in_fri),
      },
    }
  })
}

/** A user-facing pool state. Each maps to exactly one honest string in the UI. */
export type PoolHealth =
  | { state: 'ok'; feeWei: bigint; proofValidityBlocks: number; blockNumber: number; gasPrices: GasPrices }
  | { state: 'paused' }
  | { state: 'upgraded'; pinned: string; onchain: string }
  | { state: 'unreachable' }

/** Pause needs TWO consecutive positive reads; a failed read is unreachable, never paused. */
export function classifyPause(read1: boolean, read2: boolean): boolean {
  return read1 && read2
}

/** Numeric compare — two spellings of one hash are one hash. */
export function classHashMatches(onchain: string, pinned: string): boolean {
  const norm = (h: string) => BigInt(h).toString(16)
  return norm(onchain) === norm(pinned)
}

/**
 * Class hash vs pin FIRST (an upgraded pool's other reads are untrustworthy), then pause ×2,
 * then fee / validity / block in parallel. Any throw → `unreachable`, never `paused`.
 */
export async function readPoolHealth(): Promise<PoolHealth> {
  try {
    const onchain = await withFallback((p) => p.getClassHashAt(NET.pool))
    if (NET.poolClassHash && !classHashMatches(onchain, NET.poolClassHash)) {
      return { state: 'upgraded', pinned: NET.poolClassHash, onchain }
    }
    const paused1 = BigInt((await call('is_paused'))[0]!) !== 0n
    if (paused1) {
      const paused2 = BigInt((await call('is_paused'))[0]!) !== 0n
      if (classifyPause(paused1, paused2)) return { state: 'paused' }
    }
    const [fee, validity, head] = await Promise.all([call('get_fee_amount'), call('get_proof_validity_blocks'), readHead()])
    return {
      state: 'ok',
      feeWei: BigInt(fee[0]!),
      proofValidityBlocks: Number(BigInt(validity[0]!)),
      blockNumber: head.blockNumber,
      gasPrices: head.gasPrices,
    }
  } catch {
    return { state: 'unreachable' }
  }
}

export interface PoolConstants {
  feeWei: bigint
  paused: boolean
  proofValidityBlocks: number
  blockNumber: number
  gasPrices: GasPrices
}

/** Every mutable protocol number in one shot. Throws on an unreachable RPC. */
export async function readPoolConstants(): Promise<PoolConstants> {
  const [fee, paused, validity, head] = await Promise.all([
    call('get_fee_amount'),
    call('is_paused'),
    call('get_proof_validity_blocks'),
    readHead(),
  ])
  return {
    feeWei: BigInt(fee[0]!),
    paused: BigInt(paused[0]!) !== 0n,
    proofValidityBlocks: Number(BigInt(validity[0]!)),
    blockNumber: head.blockNumber,
    gasPrices: head.gasPrices,
  }
}

/** 0n means "never registered". Non-zero from another app is a ForeignKey — see registration.ts. */
export async function getPublicKey(address: string): Promise<bigint> {
  const r = await call('get_public_key', [address])
  return BigInt(r[0]!)
}

/**
 * Is the note in pool storage? `get_note` on an unknown id ANSWERS `["0x0","0x0"]` rather than
 * reverting (probed live), which is what makes polling this usable. Not a maturity view — the
 * deployed class has none.
 */
export async function noteExists(noteId: bigint): Promise<boolean> {
  return notePresentIn(await call('get_note', [`0x${noteId.toString(16)}`]), noteId)
}

/** Present iff `packed_value != 0` — the pool's own existence test throughout `privacy.cairo`. */
export function notePresentIn(result: readonly string[], noteId: bigint): boolean {
  const packed = result?.[0]
  if (packed === undefined) throw new Error(`the pool returned no value for get_note(${noteId})`)
  try {
    return BigInt(packed) !== 0n
  } catch {
    throw new Error(
      `the pool returned a non-numeric packed value for get_note(${noteId}): ` +
        JSON.stringify(String(packed).slice(0, 64)),
    )
  }
}

/** Empty, non-numeric (a proxy's HTML-as-200) and zero are all refused — none is an auditor key. */
export function auditorKeyFrom(result: readonly string[], atBlock?: number): bigint {
  const raw = result?.[0]
  if (raw === undefined) throw new Error('the pool returned no value for get_auditor_public_key')
  let key: bigint
  try {
    key = BigInt(raw)
  } catch {
    throw new Error(`the pool returned a non-numeric auditor key: ${JSON.stringify(String(raw).slice(0, 64))}`)
  }
  if (key === 0n) {
    const where = atBlock === undefined ? 'at the current head' : `at block ${atBlock}`
    throw new Error(`the pool reported an auditor key of 0 ${where}`)
  }
  return key
}

/**
 * The auditor key AT a block — the pair a Recovery File header records. Height and pinned call
 * from ONE provider in ONE attempt: the two hosts routinely differ by a block.
 */
export async function readAuditorKeyAtBlock(): Promise<{ blockNumber: number; auditorKey: bigint }> {
  return withFallback(async (p) => {
    const blockNumber = await p.getBlockNumber()
    const r = await p.callContract(
      { contractAddress: NET.pool, entrypoint: 'get_auditor_public_key', calldata: [] },
      blockNumber,
    )
    return { blockNumber, auditorKey: auditorKeyFrom(r, blockNumber) }
  })
}
