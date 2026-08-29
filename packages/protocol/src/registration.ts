//
// The free pre-flight in front of registration: which key the pool stores for an account key, and
// where an attempt goes before anything is proven or posted.
//

import { ec } from 'starknet'
import { NET } from './constants.js'
import { getPublicKey } from './pool.js'
import { deriveViewingKey } from './identity.js'

/**
 * The public key the POOL stores for a given root account key.
 *
 * NOT `getStarkKey(accountKey)`: `SetViewingKey` writes the public key of the VIEWING key, which is
 * itself derived from the account key against this chain and this pool. Comparing the account
 * key's own public key made every correct paste look like a stranger's key.
 */
export function deriveRegisteredPublicKey(accountKey: string): bigint {
  const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
  // Even-length hex: an odd-length one silently drops a leading nibble in byte decoding.
  const hex = viewingKey.toString(16)
  return BigInt(ec.starkCurve.getStarkKey(`0x${hex.padStart(hex.length + (hex.length % 2), '0')}`))
}

/**
 * Four routes and no fifth: "we could not read the chain" is its own answer and must never
 * collapse into `unregistered`, because that is the one that spends money.
 */
export type PreflightRoute =
  | { route: 'unregistered' }
  | { route: 'already-registered'; onChainKey: bigint }
  | { route: 'collision'; onChainKey: bigint }
  | { route: 'blocked-rpc-unknown'; reason: string }

/**
 * Routes; never proves, never posts, never throws on a read failure. The derivation runs OUTSIDE
 * the try: a malformed account key is a caller bug, and reporting it as `blocked-rpc-unknown`
 * would blame the network for our own defect.
 */
export async function preflightRegistration(
  accountKey: string,
  address: string,
): Promise<PreflightRoute> {
  const ours = deriveRegisteredPublicKey(accountKey)
  let onChainKey: bigint
  try {
    onChainKey = await getPublicKey(address)
  } catch (e) {
    return { route: 'blocked-rpc-unknown', reason: String(e) }
  }
  if (onChainKey === 0n) return { route: 'unregistered' }
  return onChainKey === ours
    ? { route: 'already-registered', onChainKey }
    : { route: 'collision', onChainKey }
}

/**
 * Maps a raw pool revert string to honest user copy. The pool has no dedicated "already
 * registered" error — re-registration surfaces as the generic `NON_ZERO_VALUE`. Unknown codes
 * pass through unchanged rather than being mistranslated.
 */
export function mapRegistrationError(raw: string): string {
  const table: Record<string, string> = {
    NON_ZERO_VALUE: 'This address already has a registered key.',
    PRIVATE_KEY_NOT_CANONICAL: 'That key is not in the valid range — regenerate your account key.',
    ZERO_PRIVATE_KEY: 'That key is empty — regenerate your account key.',
    ZERO_RANDOM: 'Registration randomness was zero — retry.',
    RECIPIENT_NOT_REGISTERED: 'That address has no account on this protocol yet — send them an invite.',
  }
  for (const [code, msg] of Object.entries(table)) {
    if (raw.includes(code)) return msg
  }
  return raw
}
