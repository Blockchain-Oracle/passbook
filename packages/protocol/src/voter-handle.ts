//
// Your anonymous voter handle, derived rather than looked up.
//
// The Houses contract stores members and delegation pots under an identity handle the POOL derives
// and injects — no view returns it, and the Delegate dialog has been asking people to paste one
// that nothing in the app could produce.
//
// It does not need a view. The pool's own derivation is
//
//     identity_key = poseidon(IDENTITY_KEY_TAG, user_addr, user_private_key, contract_address)
//
// (`reference/privacy/packages/privacy/src/hashes.cairo:57`), and every input is in this browser.
// The pool's comment says the handle "can be reproduced only by the user" — which is precisely a
// statement that the user can reproduce it.
//
// ── NEVER TRUST AN UNVERIFIED HANDLE ──────────────────────────────────────────────────────
//
// A wrong handle is not a cosmetic bug: delegating to one puts weight in a pot whose secret nobody
// holds, and `revoke` drains the pot the handle names. So this module derives CANDIDATES and the
// caller proves one against the chain's own `is_member` before anything is shown or spent. The
// contract is the authority on which key the pool used; this file does not guess.
//
import { hash, shortString } from 'starknet'

/** `IDENTITY_KEY_TAG: felt252 = 'IDENTITY_KEY_TAG:V1'` — the pool's domain tag, as a felt. */
export const IDENTITY_KEY_TAG = shortString.encodeShortString('IDENTITY_KEY_TAG:V1')

export interface HandleInput {
  /** The account address the pool knows you by. */
  address: string
  /** The secret half. Which secret is exactly what the caller verifies — see `handleCandidates`. */
  privateKey: string | bigint
  /** The contract the handle is scoped to. A handle is per-contract by construction. */
  contract: string
}

/**
 * One candidate handle.
 *
 * `computePoseidonHashOnElements` is Cairo's `poseidon_hash_span` — the same pairing this codebase
 * already relies on in `deriveViewingKey`, which the pool accepts in production.
 */
export function voterHandle({ address, privateKey, contract }: HandleInput): string {
  return hash.computePoseidonHashOnElements([
    IDENTITY_KEY_TAG,
    address,
    typeof privateKey === 'bigint' ? `0x${privateKey.toString(16)}` : privateKey,
    contract,
  ])
}

/** Which secret the pool folds in. Named, because the answer decides where delegated weight lands. */
export type HandleSecret = 'account-key' | 'viewing-key'

export interface HandleCandidate {
  secret: HandleSecret
  handle: string
}

/**
 * Both readings, for the caller to settle against `is_member`.
 *
 * Returning two rather than picking one is the honest shape: the pool's circuit is the authority
 * and it is not in this repo, so the chain answers the question and a runtime check costs nothing.
 */
export function handleCandidates(input: {
  address: string
  accountKey: string
  viewingKey: bigint
  contract: string
}): HandleCandidate[] {
  const { address, accountKey, viewingKey, contract } = input
  return [
    { secret: 'account-key', handle: voterHandle({ address, privateKey: accountKey, contract }) },
    { secret: 'viewing-key', handle: voterHandle({ address, privateKey: viewingKey, contract }) },
  ]
}
