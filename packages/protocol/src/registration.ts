import { getPublicKey } from './pool.js'

export type RegistrationState = 'Unregistered' | 'Registered' | 'ForeignKey'

export interface RegistrationCheck {
  state: RegistrationState
  onChainKey: bigint
}

/**
 * Free pre-flight. MUST run before every create and every restore.
 *
 * If the RPC is down this THROWS rather than returning a guess. Proceeding on an
 * unknown risks a paid revert, or worse, registering over a state we could not read.
 */
export async function checkRegistration(
  address: string,
  ourPublicKey: string,
): Promise<RegistrationCheck> {
  const onChainKey = await getPublicKey(address)
  if (onChainKey === 0n) return { state: 'Unregistered', onChainKey }
  return {
    state: onChainKey === BigInt(ourPublicKey) ? 'Registered' : 'ForeignKey',
    onChainKey,
  }
}
