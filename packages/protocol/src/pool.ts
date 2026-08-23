import { NET } from './constants.js'
import { withFallback } from './rpc.js'

async function call(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return withFallback((p) =>
    p.callContract({ contractAddress: NET.pool, entrypoint, calldata }),
  )
}

// ── Degraded-mode substrate (FR-052 / AD-9) ──────────────────────────────────────────────
// Classification precedes copy: an unreachable service and a real "paused" determination must
// never share a string. These classifiers are pure so the (un-forceable-live) paused/upgraded
// paths are unit-tested deterministically; readPoolHealth() wires them to live reads.

/** A user-facing pool state. Each maps to exactly one honest string in the UI. */
export type PoolHealth =
  | { state: 'ok'; feeWei: bigint; proofValidityBlocks: number; blockNumber: number }
  | { state: 'paused' }                                            // "paused by its operator"
  | { state: 'upgraded'; pinned: string; onchain: string }          // "pool was upgraded"
  | { state: 'unreachable' }                                        // "you're offline / RPC down"

/**
 * Pause requires TWO consecutive positive reads. A single positive read can be a transient;
 * more importantly a single *failed* read must classify as unreachable, never as paused —
 * "the pool stopped you" and "we couldn't reach the pool" are different sentences (FR-052).
 */
export function classifyPause(read1: boolean, read2: boolean): boolean {
  return read1 && read2
}

/** Normalizes two felt hashes and compares; a mismatch is the "pool upgraded" state. */
export function classHashMatches(onchain: string, pinned: string): boolean {
  const norm = (h: string) => BigInt(h).toString(16)
  return norm(onchain) === norm(pinned)
}

/** True when the on-chain error means "this entrypoint does not exist on the deployed class". */
export function isEntrypointNotFound(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err).toLowerCase()
  return /entry ?point|not found|-32601|invalid message selector|selector.*not found/.test(m)
}

/**
 * Canary for the unreleased default-deny screening rewrite. `get_open_note_screening_policy`
 * does not exist on the deployed class (block-list model), so today this returns `false`. When
 * the pool upgrades to the `OpenNoteScreeningPolicy { Required }` class the entrypoint appears
 * and this returns `true` — the signal for value-bearing surfaces to surface the *named*
 * blocked-deposit degraded mode instead of a silent revert. Chat (zero-deposit) ignores it.
 */
export async function screeningPolicyPresent(): Promise<boolean> {
  try {
    await call('get_open_note_screening_policy')
    return true
  } catch (e) {
    if (isEntrypointNotFound(e)) return false
    throw e   // a real RPC failure is not a "no" — let the caller classify it as unreachable
  }
}

/**
 * One honest read of pool health. Any RPC failure → `unreachable` (never `paused`); a class-hash
 * mismatch → `upgraded` (checked first — an upgraded pool's other reads are not trustworthy); two
 * positive pause reads → `paused`; otherwise `ok` with the live mutable numbers.
 */
export async function readPoolHealth(): Promise<PoolHealth> {
  try {
    const onchain = await withFallback((p) => p.getClassHashAt(NET.pool))
    if (NET.poolClassHash && !classHashMatches(onchain, NET.poolClassHash)) {
      return { state: 'upgraded', pinned: NET.poolClassHash, onchain }
    }
    const paused1 = BigInt((await call('is_paused'))[0]) !== 0n
    if (paused1) {
      const paused2 = BigInt((await call('is_paused'))[0]) !== 0n
      if (classifyPause(paused1, paused2)) return { state: 'paused' }
    }
    const [fee, validity, blockNumber] = await Promise.all([
      call('get_fee_amount'),
      call('get_proof_validity_blocks'),
      withFallback((p) => p.getBlockNumber()),
    ])
    return {
      state: 'ok',
      feeWei: BigInt(fee[0]),
      proofValidityBlocks: Number(BigInt(validity[0])),
      blockNumber,
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
}

/**
 * Reads every mutable protocol number in one shot.
 * The fee is NOT a constant: it was 4 STRK earlier in this pool's history and the
 * upgrade delay is zero, so it can change between two page loads. Always read it.
 */
export async function readPoolConstants(): Promise<PoolConstants> {
  const [fee, paused, validity, blockNumber] = await Promise.all([
    call('get_fee_amount'),
    call('is_paused'),
    call('get_proof_validity_blocks'),
    withFallback((p) => p.getBlockNumber()),
  ])
  return {
    feeWei: BigInt(fee[0]),
    paused: BigInt(paused[0]) !== 0n,
    proofValidityBlocks: Number(BigInt(validity[0])),
    blockNumber,
  }
}

/** 0n means "never registered". Non-zero from another app means ForeignKey — see registration.ts. */
export async function getPublicKey(address: string): Promise<bigint> {
  const r = await call('get_public_key', [address])
  return BigInt(r[0])
}
