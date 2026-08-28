import { queryOptions, skipToken } from '@tanstack/react-query'
import { NET, STRK_TOKEN } from '@strk20/protocol/constants'

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
