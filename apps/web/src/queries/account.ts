import { queryOptions, skipToken } from '@tanstack/react-query'
import { NET, PROVING_BLOCK_LAG, STRK_TOKEN } from '@strk20/protocol/constants'

export interface AccountProvable {
  head: number
  provingBlock: number
  /** The account contract exists at `provingBlock`, where the prover will look for it. */
  visible: boolean
}

/** Whether a registration proof could be built right now. Polled by the caller until `visible`. */
export function accountProvableQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['account-provable', address ?? null],
    queryFn: address
      ? async (): Promise<AccountProvable> => {
          const { withFallback } = await import('@strk20/protocol/rpc')
          const head = await withFallback((p) => p.getBlockNumber())
          const provingBlock = Math.max(0, head - PROVING_BLOCK_LAG)
          const classHash = await withFallback((p) => p.getClassHashAt(address, provingBlock)).catch(() => null)
          return { head, provingBlock, visible: typeof classHash === 'string' }
        }
      : skipToken,
    staleTime: 0,
  })
}

export type AccountRung = 'unfunded' | 'undeployed' | 'unregistered' | 'ready' | 'unknown'

export interface AccountStatus {
  rung: AccountRung
  /** Public STRK at the address. `null` when the read failed — never zero. */
  strkWei: bigint | null
  deployed: boolean
  registered: boolean
  because: string | null
}

/**
 * The onboarding ladder: funded → deployed → registered. Three reads in parallel; an unreadable
 * balance is `unknown`, because "unfunded" is a claim this must not make on a dead RPC.
 */
export function accountStatusQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['account-status', address ?? null],
    queryFn: address
      ? async (): Promise<AccountStatus> => {
          const { withFallback } = await import('@strk20/protocol/rpc')
          try {
            const [balance, classHash, publicKey] = await Promise.all([
              withFallback((p) =>
                p.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [address] }),
              ).catch(() => null),
              withFallback((p) => p.getClassHashAt(address)).catch(() => null),
              withFallback((p) =>
                p.callContract({ contractAddress: NET.pool, entrypoint: 'get_public_key', calldata: [address] }),
              ).catch(() => null),
            ])
            const deployed = typeof classHash === 'string'
            const registered = Array.isArray(publicKey) && typeof publicKey[0] === 'string' && BigInt(publicKey[0]) !== 0n
            const strkWei =
              Array.isArray(balance) && typeof balance[0] === 'string'
                ? (typeof balance[1] === 'string' ? BigInt(balance[1]) << 128n : 0n) + BigInt(balance[0])
                : null
            if (strkWei === null && !registered) {
              return { rung: 'unknown', strkWei, deployed, registered, because: 'The STRK balance could not be read.' }
            }
            const rung: AccountRung = registered ? 'ready' : deployed ? 'unregistered' : strkWei && strkWei > 0n ? 'undeployed' : 'unfunded'
            return { rung, strkWei, deployed, registered, because: null }
          } catch (error) {
            return {
              rung: 'unknown',
              strkWei: null,
              deployed: false,
              registered: false,
              because: error instanceof Error ? error.message : 'The account could not be read.',
            }
          }
        }
      : skipToken,
    staleTime: 10_000,
  })
}
