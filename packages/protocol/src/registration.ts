//
// The free pre-flight in front of registration: which key the pool stores for an account key, and
// where an attempt goes before anything is proven or posted.
//

import { cairoPanic } from './rpc-error.js'
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
 * registered" error — re-registration surfaces as the generic `NON_ZERO_VALUE`.
 *
 * ── NOTHING RAW LEAVES HERE ANY MORE ──────────────────────────────────────────────────────
 *
 * Unknown codes used to `return raw`, and raw is a sequencer revert: the same contract address,
 * class hash and selector printed twice inside nested "Error in the called contract" framing,
 * with the one readable clause at the very end. On screen it reads as four stacked errors that
 * say nothing a person can act on. The felt-encoded panic beside it is the only part written in
 * words, so that is what comes out — and when there is not even one, this says so in a sentence
 * rather than pasting the payload and hoping.
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
  const panic = cairoPanic(raw)
  // The pool unwinding an inner call it would not run. It is about the ACTION LIST, never the
  // key, so it must not read as "your account is wrong" — and the fee is not charged, because
  // `collect_fee` sits behind the call that failed.
  if (panic === 'Result::unwrap failed.') {
    return (
      'The pool would not accept this registration, so nothing was written and the pool fee was ' +
      'not charged. Your key and balance are unchanged. Try again.'
    )
  }
  if (panic) return `The pool refused this registration: ${panic} Nothing was written.`
  return 'The pool refused this registration and gave no reason. Nothing was written.'
}
