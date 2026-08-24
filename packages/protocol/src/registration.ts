import { ec, stark } from 'starknet'
import { NET } from './constants.js'
import { getPublicKey } from './pool.js'
import { deriveViewingKey } from './identity.js'
import { CLIENT_ACTION } from './message-book.js'
import { assertActionListValid, type ValidatableAction } from './actions.js'

export type RegistrationState = 'Unregistered' | 'Registered' | 'ForeignKey'

export interface RegistrationCheck {
  state: RegistrationState
  onChainKey: bigint
}

/**
 * The public key the POOL stores for a given root account key.
 *
 * NOT `getStarkKey(accountKey)`. `SetViewingKey` writes the public key of the VIEWING
 * key — the SDK's own simulator derives it as `derivePublicKey(userViewingKey)` in
 * `internal/pool-simulator.js` `handleSetViewingKey` — and the viewing key is itself
 * derived from the account key against this chain and this pool (identity.ts). Story 1.7
 * compared the account key's own public key, so every correct paste looked like a
 * stranger's key and the collision screen could never be passed. This function is the
 * single place that derivation lives; both the pre-flight and the paste check use it.
 */
export function deriveRegisteredPublicKey(accountKey: string): bigint {
  const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
  // Even-length hex. `getStarkKey` takes a hex string, and an odd-length one is the
  // classic way a byte-decoding path silently drops a leading nibble — a key that is
  // wrong for one input in sixteen is far worse than one that is wrong always.
  const hex = viewingKey.toString(16)
  return BigInt(ec.starkCurve.getStarkKey(`0x${hex.padStart(hex.length + (hex.length % 2), '0')}`))
}

/**
 * Free pre-flight, in throwing form. MUST run before every create and every restore.
 * `preflightRegistration` below is the routing wrapper the sponsored pipeline uses.
 *
 * RENAMED FROM `checkRegistration`, and the rename is the point. That function took
 * `(address, ourPublicKey)`; this one takes `(accountKey, address)` — the arguments both
 * swapped places AND changed meaning, while staying two bare strings, so every stale call
 * site would have kept compiling and silently compared the wrong key against the wrong
 * thing. A name nothing calls yet is the cheapest way to make that a build error. The
 * argument order matches `preflightRegistration` deliberately: two adjacent
 * `(string, string)` functions with opposite orders is the same trap one level down.
 *
 * If the RPC is down this THROWS rather than returning a guess. Proceeding on an
 * unknown risks a paid revert, or worse, registering over a state we could not read.
 */
export async function checkRegistrationState(
  accountKey: string,
  address: string,
): Promise<RegistrationCheck> {
  // A THIN WRAPPER, not a second implementation. These two were near-identical
  // derive-read-compare bodies, which is precisely how the pair drifts: someone fixes the
  // comparison in one and the other keeps quietly answering with the old rule. The route
  // is computed once, below, and this only re-labels it and re-raises the read failure.
  const route = await preflightRegistration(accountKey, address)
  switch (route.route) {
    case 'unregistered':
      return { state: 'Unregistered', onChainKey: 0n }
    case 'already-registered':
      return { state: 'Registered', onChainKey: route.onChainKey }
    case 'collision':
      return { state: 'ForeignKey', onChainKey: route.onChainKey }
    case 'blocked-rpc-unknown':
      throw new Error(route.reason)
  }
}

/**
 * Where a registration attempt goes, decided before anything is proven or posted.
 *
 * Four routes and no fifth: "we could not read the chain" is its own answer and must
 * never collapse into `unregistered`, because that is the one that spends money.
 */
export type PreflightRoute =
  | { route: 'unregistered' }
  | { route: 'already-registered'; onChainKey: bigint }
  | { route: 'collision'; onChainKey: bigint }
  | { route: 'blocked-rpc-unknown'; reason: string }

/**
 * The free gate in front of the whole sponsored pipeline (AC4). Routes; never proves,
 * never posts, never throws on a read failure.
 *
 * The derivation happens OUTSIDE the try on purpose. A malformed account key here is a
 * caller bug — on this path the key comes from `generateIdentity` or an 1.8 restore that
 * already decrypted it, never from a paste — and reporting it as `blocked-rpc-unknown`
 * would blame the network for our own defect. The paste surface is `verifyClaimedKey`,
 * which is the one that must never throw.
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

// ── ForeignKey recovery: "I have that key — paste it" (FR-011, story 1.7) ──────────────────
/**
 * Verifies a pasted account key against a public key already registered at an address, entirely
 * LOCALLY (no submit, no network) — the collision screen must confirm ownership before anything
 * is sent. Note k and ORDER−k share a public-key x-coordinate, so a pasted key is accepted iff it
 * derives the same on-chain public key. NEVER auto-submit on the strength of a paste; the UI shows
 * the phishing warning first.
 *
 * The comparison runs through `deriveRegisteredPublicKey`, so it compares what the pool
 * actually stores. See that function for the derivation this used to get wrong.
 */
export function verifyClaimedKey(pastedAccountKey: string, onChainPublicKey: bigint): boolean {
  try {
    return deriveRegisteredPublicKey(pastedAccountKey) === onChainPublicKey
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
