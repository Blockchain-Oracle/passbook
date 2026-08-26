//
// Where this browser's account WILL live (story: the wallet surface).
//
// ── STARKNET HAS NO EOAs, WHICH IS THE WHOLE REASON THIS FILE EXISTS ──────────────────────
//
// A key does not have an address here the way it does on an EVM chain. An account is a CONTRACT,
// and its address is a hash of the class it will be deployed from, a salt, and its constructor
// arguments. So an address exists before the contract does — the "counterfactual" address — and
// it is a real, exact answer: fund it and the funds are there waiting when it deploys.
//
// The convention is already established in this repository and both funded keypairs were generated
// against it (`scripts/ops/account-lib.ts:18-22`):
//
//     calculateContractAddressFromHash(publicKey, OZ_ACCOUNT_CLASS_HASH, [publicKey], 0)
//
// salt and constructor calldata both the public key, deployer zero for a self-deploying account.
// CHANGING THE CLASS HASH CHANGES EVERY ADDRESS, which is why it is pinned rather than configured.
//
// ── WHY IT IS REIMPLEMENTED HERE INSTEAD OF IMPORTED ──────────────────────────────────────
//
// `hash.calculateContractAddressFromHash` lives in `starknet`, and the ops scripts use it freely
// because they run in Node. This runs in a browser, where the SDK graph may not be fetched at first
// paint — and the wallet surface is the cold open, so it is the one place that constraint bites
// hardest.
//
// The computation is a Pedersen chain, and Pedersen is exactly the primitive the bundle gate bans.
// So this file does NOT reimplement it: it takes the hasher as an argument. The caller — which has
// already loaded the SDK for its own reasons — supplies it. That keeps one implementation of the
// hash in the app and still lets this module state the convention, name the class, and be tested.
//
import { toFeltHex } from './address.js'

/**
 * The OpenZeppelin account class declared on SN_MAIN, and the one both funded keypairs in this
 * repository were generated against.
 *
 * Not interchangeable with another account class: change it and every derived address moves.
 */
export const OZ_ACCOUNT_CLASS_HASH =
  '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'

/** `'STARKNET_CONTRACT_ADDRESS'` as a felt — the domain separator the address hash opens with. */
const CONTRACT_ADDRESS_PREFIX =
  '0x535441524b4e45545f434f4e54524143545f41444452455353'

/** The Pedersen hash of two felts, supplied by whoever already has the SDK loaded. */
export type Pedersen = (a: string, b: string) => string

/**
 * Starknet's list hash: fold from ZERO over the elements, then fold in the count.
 *
 * The seed is the part that is easy to get wrong, and it fails silently — seeding from the first
 * element instead produces a perfectly valid felt that is a different number. (It is exactly what
 * the first version of this file did, and the test against `starknet.js` is what caught it.)
 */
function hashElements(elements: readonly string[], pedersen: Pedersen): string {
  const folded = elements.reduce((acc, item) => pedersen(acc, item), toFeltHex(0))
  return pedersen(folded, toFeltHex(elements.length))
}

/**
 * The address a key's account will deploy to.
 *
 * ── THE ORDER IS THE PROTOCOL AND IT IS NOT NEGOTIABLE ────────────────────────────────────
 *
 *     hashElements([PREFIX, deployer, salt, classHash, hashElements(constructorCalldata)])
 *
 * Getting any step wrong produces a valid-looking felt that is simply a different address — there
 * is no error, only funds sent somewhere nothing will ever deploy. That is why this is pinned by a
 * test against `starknet.js`'s own implementation rather than reasoned about.
 *
 * @param publicKey the account's public key: salt AND sole constructor argument, per the convention
 * @param pedersen  the hasher, from a caller that has the SDK
 */
export function accountAddressFor(publicKey: string, pedersen: Pedersen): string {
  const key = toFeltHex(publicKey)

  return toFeltHex(
    hashElements(
      [
        CONTRACT_ADDRESS_PREFIX,
        toFeltHex(0), // deployer address: zero, because the account deploys itself
        key, // salt
        toFeltHex(OZ_ACCOUNT_CLASS_HASH),
        hashElements([key], pedersen), // the constructor calldata is `[publicKey]`
      ],
      pedersen,
    ),
  )
}
