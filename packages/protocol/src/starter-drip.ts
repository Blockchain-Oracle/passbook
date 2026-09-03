//
// The starter drip: the shielded balance a new account is given.
//
// ── WHO THE DEPOSITOR IS, WHICH IS THE WHOLE STORY ────────────────────────────────────────
//
// A Deposit is paid by THE ACCOUNT THAT PROVED IT, never by the account that submits the
// transaction. The SDK says so plainly: "the prover reads the depositor's token balance at its
// base block… the deposit fails on-chain due to insufficient balance" (README, "Sequencing after
// transparent state changes"), and our own shield approves `amount + fee` from the shielding
// account for the same reason.
//
// TWO MAINNET REVERTS WERE THAT ONE FACT, and both were read as something else first:
//
//   - tx 0x2ef58d17…42cb — registration with a folded starter, REVERTED `Result::unwrap failed.`
//     Diagnosed as "a deposit cannot ride inside a registration". It was not.
//   - tx 0x671add5d… — the standalone drip, proven in the recipient's browser, submitted and paid
//     by the relayer. Same panic, and registration was nowhere near it. The account being given
//     3 STRK held 1.94, the proof asserted it could pay, and the pool checked.
//
// So the relayer cannot buy someone else a note by submitting their proof. It has to BE the
// depositor: it proves with its own key, its own balance is what the pool checks, and the note is
// created in the recipient's name. That is this file — the recipient never signs anything.
//
import type { Call } from 'starknet'
import { createEmptyRegistry, type PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'

import { NET, STRK_TOKEN } from './constants.js'
import { createPoolClient } from './client.js'
import { CLIENT_ACTION } from './client-action-index.js'
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
  /** THE DEPOSITOR'S key — the relayer's. Its balance is what the pool checks. */
  accountKey: string
  account: PrivateTransfersUser
  provingBlockId: number
  /**
   * Who ends up owning the note. Defaults to the depositor, which is an ordinary self-shield;
   * a gift names someone else, and they need to be registered so a channel can be opened to them.
   */
  recipient?: string
  /** What lands in the note, in wei. Our principal — bounded by the approve ceiling. */
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
  /** `self` is the note's OWNER — the recipient of a gift, or the depositor on a self-shield. */
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
  // The note's owner. The depositor is `input.account` either way — see the header.
  const owner = BigInt(String(input.recipient ?? input.account.address))
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
      t.deposit({ recipient: toFelt(owner), amount: input.amountWei })
    })
    .createProofInvocation({ provingBlockId: input.provingBlockId })

  assertStarterDripSpan(extractClientActionSpan(invocation.invocation.calldata), {
    self: owner,
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
