import { ec, stark } from 'starknet'
import { getPublicKey } from './pool.js'
import { deriveIdentityPublicKey } from './identity.js'
import { CLIENT_ACTION } from './message-book.js'
import { assertActionListValid, type ValidatableAction } from './actions.js'

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

// ── ForeignKey recovery: "I have that key — paste it" (FR-011, story 1.7) ──────────────────
/**
 * Verifies a pasted account key against a public key already registered at an address, entirely
 * LOCALLY (no submit, no network) — the collision screen must confirm ownership before anything
 * is sent. Note k and ORDER−k share a public-key x-coordinate, so a pasted key is accepted iff it
 * derives the same on-chain public key. NEVER auto-submit on the strength of a paste; the UI shows
 * the phishing warning first.
 */
export function verifyClaimedKey(pastedAccountKey: string, onChainPublicKey: bigint): boolean {
  try {
    return BigInt(deriveIdentityPublicKey(pastedAccountKey)) === onChainPublicKey
  } catch {
    return false   // a malformed paste is a non-match, never a throw into the UI
  }
}

/**
 * Maps a raw pool revert string to honest user copy (FR-018). The pool has no dedicated
 * "already registered" error — re-registration surfaces as the generic `NON_ZERO_VALUE`; showing
 * that raw string to a user is a defect. Unknown codes pass through unchanged rather than being
 * mistranslated.
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

// ── Sponsored registration action list (FR-012 / AD-2 note, story 1.12) ────────────────────
export type RegistrationAction = { type: 'SetViewingKey'; random: bigint }

/**
 * Builds the registration action list: a single zero-deposit `SetViewingKey` (Account phase).
 * It sets no screening subject and mints no spendable note — there is no maturity step, and it is
 * NEVER batched with a deposit (batching registration with a first shield is the self-funded path
 * only). Registration is an Account-phase action, not a per-identity value invoke, so it is not
 * `ComputeAndInvoke` and exposes no forgeable `identity_key` surface (AD-2 note). The `random`
 * (used to encrypt the viewing key to the auditor) must be non-zero — generated here.
 */
export function buildRegistrationActions(random?: bigint): RegistrationAction[] {
  const r = random ?? BigInt(stark.randomAddress())
  if (r === 0n) throw new Error('ZERO_RANDOM')
  const actions: RegistrationAction[] = [{ type: 'SetViewingKey', random: r }]
  // The list must satisfy the protocol invariants: a lone SetViewingKey IS a valid list (it is
  // its own WriteOnce companion; no invoke present). This guards against a future edit that adds
  // an invoke without a companion or a deposit alongside it.
  assertActionListValid(actions as unknown as ValidatableAction[])
  return actions
}

/** The variant index the registration action serializes to (Account phase, index 0). */
export const REGISTRATION_VARIANT = CLIENT_ACTION.SetViewingKey

/** True while `k` is a legal Stark scalar for use as an account key input to registration. */
export function isRegisterableKey(k: string): boolean {
  try {
    const n = BigInt(k)
    return n > 0n && n < ec.starkCurve.CURVE.n
  } catch {
    return false
  }
}
