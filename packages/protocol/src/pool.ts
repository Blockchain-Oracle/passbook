import { NET } from './constants.js'
import { withFallback } from './rpc.js'

async function call(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return withFallback((p) =>
    p.callContract({ contractAddress: NET.pool, entrypoint, calldata }),
  )
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
