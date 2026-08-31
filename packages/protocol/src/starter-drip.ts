//
// The starter drip: the shielded balance a new account is given, as its OWN transaction.
//
// ── WHY IT IS NOT FOLDED INTO REGISTRATION ANY MORE ───────────────────────────────────────
//
// It used to be. `proveRegistration` still takes a `starterWei` that compiles SetViewingKey +
// self-channel setup + Deposit + CreateEncNote into one span, and on mainnet the pool refused it:
// tx 0x2ef58d17…42cb, block 14149266, REVERTED on `Result::unwrap failed.` at 77.4M of a 120M l2
// bound — not gas. A deposit whose note-owner is the account being registered, inside the
// transaction that registers it, is one thing too many. The registration that has ever landed
// (`evidence/sponsored-registration.json`) is zero-deposit.
//
// Registered first, the same deposit is ordinary: the owner exists, `get_public_key` answers, and
// `autoSetup` opens the channel the note lands in. That is this file. It costs one extra
// `collect_fee` — the fee is per submission, not per action — and that is the price of the ordering
// the pool actually accepts.
//
// ── WHOSE MONEY, AND WHO SIGNS ────────────────────────────────────────────────────────────
//
// A Deposit pulls `transferFrom(caller)`, and the caller is the RELAYER, so this is our public STRK
// becoming a private note owned by the user. We never hold or move a private balance to do it — the
// pool mints the note from a public transfer, which is the same mechanic as a shield with someone
// else's STRK. The proof, though, can only be built by the RECIPIENT's client: the note is theirs
// and the channel is theirs. So the browser builds and proves; the relayer signs and pays.
//
import type { Call } from 'starknet'
import { createEmptyRegistry, type PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'

import { NET, STRK_TOKEN } from './constants.js'
import { createPoolClient } from './client.js'
import { CLIENT_ACTION } from './message-book.js'
import {
  decodeClientActions,
  extractClientActionSpan,
  proofBlobFrom,
  starterDiscovery,
  type ProvedRegistration,
} from './register-prove.js'

/** The SDK takes addresses as felt strings; a bigint would serialise as a decimal it rejects. */
const toFelt = (v: bigint) => `0x${v.toString(16)}`

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

export interface ProveStarterDripInput {
  accountKey: string
  account: PrivateTransfersUser
  provingBlockId: number
  /** What lands in the note, in wei. Our principal, not the user's — bounded by the approve ceiling. */
  amountWei: bigint
}

/**
 * The span of a standalone starter drip: the self-channel setup this account may still need, then
 * `Deposit` + `CreateEncNote`.
 *
 * ── NO SetViewingKey, AND THAT IS THE POINT ───────────────────────────────────────────────
 *
 * This runs against an account that is ALREADY registered, so a compiled `SetViewingKey` would mean
 * the builder decided to register someone — `SetViewingKey` is single-use, a second one is a
 * transaction that reverts, and it would be OUR fee paying for it. Refusing the variant outright is
 * cheaper than discovering that on chain.
 *
 * Everything else is `assertRegistrationWithStarter`'s reasoning: our key pays this batch, the user
 * names the amount, so the guard is what makes the compiled amount the amount asked for and the
 * compiled owner the account that asked.
 */
export function assertStarterDripSpan(
  span: readonly bigint[],
  expect: { self: bigint; token: bigint; amount: bigint },
): void {
  const actions = decodeClientActions(span, 'starter drip')
  // Deposit + CreateEncNote is the floor; the two channel-setup actions are the ceiling.
  if (actions.length < 2 || actions.length > 4) {
    throw new Error(`refusing a starter drip span declaring ${actions.length} actions`)
  }
  if (actions.some((a) => a.variant === CLIENT_ACTION.SetViewingKey)) {
    throw new Error(
      'refusing a starter drip carrying SetViewingKey: this account is already registered, and ' +
        'the pool takes exactly one — a second would revert at our expense',
    )
  }
  const tail = actions.slice(-2)
  if (tail[0]?.variant !== CLIENT_ACTION.Deposit || tail[1]?.variant !== CLIENT_ACTION.CreateEncNote) {
    throw new Error('a starter drip must end with exactly Deposit + CreateEncNote')
  }
  const middle = actions.slice(0, -2).map((a) => a.variant)
  const legalMiddle =
    middle.length === 0 ||
    (middle.length === 1 && middle[0] === CLIENT_ACTION.OpenSubchannel) ||
    (middle.length === 2 && middle[0] === CLIENT_ACTION.OpenChannel && middle[1] === CLIENT_ACTION.OpenSubchannel)
  if (!legalMiddle) throw new Error('a starter drip carried actions outside the permitted self-channel setup prefix')

  for (const action of actions.slice(0, -2)) {
    if (action.fields[0] !== expect.self) throw new Error('starter drip setup was compiled for a different recipient')
    if (action.variant === CLIENT_ACTION.OpenSubchannel && action.fields[4] !== expect.token) {
      throw new Error('starter drip setup was compiled for a different token')
    }
  }
  const [deposit, note] = [tail[0]!, tail[1]!]
  if (deposit.fields[0] !== expect.token || deposit.fields[1] !== expect.amount) {
    throw new Error('the compiled starter Deposit does not match the token and amount this drip asked for')
  }
  if (note.fields[0] !== expect.self || note.fields[2] !== expect.token || note.fields[3] !== expect.amount) {
    throw new Error('the compiled starter note is not a note to the account that asked for it')
  }
}

/**
 * Builds and proves the drip. `proveRegistration`'s starter recipe, minus the registration.
 *
 * The options are the starter path's, and each one is load-bearing: `autoSetup` is what compiles
 * the `OpenChannel`/`OpenSubchannel` this account needs before a note can land (SDK
 * `internal/compiler.js` adds one per recipient that has no channel key — it is NOT limited to the
 * registering case, which is what makes a standalone drip possible at all), and
 * `autoDiscover.channels` is what looks first so an account that already has one does not open a
 * second. `autoSelectNotes` stays absent: this spends no notes.
 */
export async function proveStarterDrip(input: ProveStarterDripInput): Promise<ProvedRegistration> {
  if (input.amountWei <= 0n) {
    throw new Error(`refusing a starter drip of ${input.amountWei} wei: it must be positive`)
  }
  const self = BigInt(String(input.account.address))
  const { transfers } = createPoolClient(
    { accountKey: input.accountKey, account: input.account },
    { discovery: starterDiscovery() },
  )
  const invocation = await transfers
    .build({
      registry: createEmptyRegistry(),
      autoDiscover: { channels: 'refresh' },
      autoSetup: true,
      provingBlockId: input.provingBlockId,
    })
    .with(STRK_TOKEN, (t) => {
      t.deposit({ recipient: toFelt(self), amount: input.amountWei })
    })
    .createProofInvocation({ provingBlockId: input.provingBlockId })

  assertStarterDripSpan(extractClientActionSpan(invocation.invocation.calldata), {
    self,
    token: BigInt(STRK_TOKEN),
    amount: input.amountWei,
  })

  const { call, proof } = (await transfers.executeWithInvocation(invocation, input.provingBlockId)).callAndProof
  if (BigInt(call.contractAddress) !== BigInt(NET.pool) || call.entrypoint !== 'apply_actions') {
    throw new Error(`refusing a proven ${call.entrypoint} on ${call.contractAddress}: expected apply_actions on the pool`)
  }
  const proofFacts = [...proof.proofFacts]
  if (proofFacts.length === 0) throw new Error('the prover returned no proof facts; the pool will not accept the transaction')
  const bad = proofFacts.findIndex((f) => typeof f !== 'string' || !FELT.test(f))
  if (bad !== -1) throw new Error(`the prover returned a proof fact that is not a felt at index ${bad}: ${String(proofFacts[bad])}`)

  return { call, proofFacts, proof: proofBlobFrom(proof), provingBlockId: input.provingBlockId }
}

export type { Call }
