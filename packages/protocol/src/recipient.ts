//
// The recipient gate: where an address routes, decided for free before anything is built.
//
// ── WHY THIS IS ITS OWN FILE AND NOT A SECTION OF `send.ts` ───────────────────────────────
//
// `address.ts` records the same move and the same reason. `send.ts` imports the privacy SDK and
// `starknet`, so a form that wanted to ask "can this address receive a private transfer?" while the
// user was still typing would pull the entire crypto graph into the chunk that renders a text box.
// The question itself needs one permissionless view call and no cryptography at all.
//
// So the gate moves DOWN into a leaf whose only import is the pool client, and `send.ts` consumes
// it from there — the direction is the fix, not the duplication. `send.ts` re-exports every name
// below, so nothing that already imported them has to change.
//
// ── IT ROUTES; IT NEVER PROVES AND NEVER POSTS ────────────────────────────────────────────
//
// Free, in both senses: no fee and no side effect. That is what lets a surface call it on a paste
// rather than on a press, and it is why the unregistered answer can be a state of the form instead
// of the outcome of a transaction the user already paid for.
//
import { getPublicKey } from './pool.js'

/**
 * The Door-A transform's copy, byte-exact.
 *
 * It is a TRANSFORM, not an error: the form becomes an invitation rather than turning red,
 * because the user did nothing wrong and the recipient is reachable — just not yet here. The
 * sentence names the protocol as the thing refusing, which is true and is the only framing that
 * does not read as our bug.
 */
export interface DoorAInvite {
  message: string
  primaryAction: string
  secondaryAction: string
}

export const DOOR_A_INVITE: DoorAInvite = {
  message:
    'This address has no account on this protocol. Private funds cannot reach it — ' +
    'the protocol rejects transfers to an unregistered key.',
  primaryAction: 'Send them an invite',
  secondaryAction: 'we pay their registration',
}

/** Where a recipient address routes, decided for free before anything is built. */
export type RecipientRoute =
  | { route: 'registered'; publicKey: bigint }
  | { route: 'unregistered'; door: DoorAInvite }
  | { route: 'blocked-rpc-unknown'; reason: string }

/**
 * The free gate in front of a shielded transfer. Routes; never proves, never posts.
 *
 * FAILS CLOSED. A read that did not land is its own route and must never collapse into either
 * answer: calling it `registered` builds a note nobody can decrypt, and calling it
 * `unregistered` shows a stranger the invite screen for an account they already have.
 *
 * Not called for a WITHDRAW. A withdraw names a public address and the pool transfers to it
 * directly; requiring registration there would refuse the one send that works for anybody.
 */
export async function preflightRecipient(
  recipient: string,
  read: (address: string) => Promise<bigint> = getPublicKey,
): Promise<RecipientRoute> {
  let publicKey: bigint
  try {
    publicKey = await read(recipient)
  } catch (e) {
    return { route: 'blocked-rpc-unknown', reason: String(e) }
  }
  return publicKey === 0n
    ? { route: 'unregistered', door: DOOR_A_INVITE }
    : { route: 'registered', publicKey }
}
