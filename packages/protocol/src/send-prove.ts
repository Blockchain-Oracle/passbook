//
// The one place a send meets the SDK builder. Each kind's leg adds its actions; the builder does
// the composing (setup, note selection, surplus, open notes, invoke calldata args); `execute()`
// proves and hands back the `apply_actions` call with its proof.
//

import type { Call } from 'starknet'
import {
  ProvingServiceError,
  ProvingServiceHttpError,
  ScreeningRejected,
  ScreeningUnavailable,
  type PrivateRegistry,
  type PrivateTransfersUser,
} from '@starkware-libs/starknet-privacy-sdk'

import { EXECUTE_DEFAULTS, createPoolClient } from './client.js'
import { STRK_TOKEN } from './constants.js'
import type { SendFailure } from './pipeline.js'
import { appLeg } from './send-app.js'
import { bridgeLeg } from './send-bridge.js'
import { isAppKind, type FeeLeg, type SendKind, type SendLeg, type SendRequest, type SendWalletData } from './send-plan.js'
import { swapLeg } from './send-swap.js'
import { transferLeg, withdrawLeg } from './send-transfer.js'
import { proofDetailsFrom } from './submit.js'

/** The kind's leg, or `null` for a kind nothing here knows how to build. */
export function legFor(kind: SendKind): SendLeg | null {
  if (kind === 'transfer') return transferLeg
  if (kind === 'withdraw') return withdrawLeg
  if (kind === 'swap') return swapLeg
  if (kind === 'bridge') return bridgeLeg
  return isAppKind(kind) ? appLeg : null
}

export interface ProveSendInput {
  accountKey: string
  account: PrivateTransfersUser
  request: SendRequest
  wallet: SendWalletData
  /** The reimbursement leg in relayer mode; `null` in self mode. */
  fee: FeeLeg | null
}

export interface ProvedSend {
  /** The pool's `apply_actions` call. */
  call: Call
  proofFacts: string[]
  proof: string
  provingBlockId: number
  /** Notes this send minted for the sender, by id — what the maturity watch looks for. */
  mintedNoteIds: bigint[]
}

/** Notes the SDK's refreshed registry holds that the walk the user looked at did not. */
export function mintedNoteIds(registry: PrivateRegistry, wallet: SendWalletData): bigint[] {
  const had = new Set(wallet.notes.map((n) => n.id.toString()))
  const out: bigint[] = []
  for (const [, notes] of registry.notes.entries()) {
    for (const note of notes) {
      const id = BigInt(note.id as string | number | bigint)
      if (!had.has(id.toString())) out.push(id)
    }
  }
  return out
}

/** Builds, proves and returns the proven call. Throws on any prover or composition error. */
export async function proveSend(input: ProveSendInput): Promise<ProvedSend> {
  const leg = legFor(input.request.kind)
  if (!leg) throw new Error(`no builder for a ${input.request.kind}`)
  const client = createPoolClient({ accountKey: input.accountKey, account: input.account })
  const blockId = await client.provingBlockId()
  const self = client.address

  // Change comes back to us; that is also what makes the SDK fail fast on a shortfall.
  const builder = client.transfers.build({ ...EXECUTE_DEFAULTS, provingBlockId: blockId.block_number }).surplusTo(self)
  leg.compose(builder, input.request, self)
  if (input.fee) {
    // The reimbursement leg, frozen into the proof: the relayer cannot add it after the fact.
    builder.with(STRK_TOKEN, (t) => {
      t.withdraw({ recipient: input.fee!.recipient, amount: input.fee!.feeWei })
    })
  }

  const { callAndProof, registry } = await builder.execute()
  const details = proofDetailsFrom(callAndProof.proof)
  return {
    call: callAndProof.call,
    proofFacts: details.proofFacts,
    proof: details.proof,
    provingBlockId: blockId.block_number,
    mintedNoteIds: mintedNoteIds(registry, input.wallet),
  }
}

/** What a thrown prove means. Screening verdicts and prover faults are all "nothing was signed". */
export function proveFailureFrom(e: unknown): SendFailure {
  if (e instanceof ScreeningRejected) {
    return { kind: 'prover-failed', reason: `the prover's screening rejected this send and will keep rejecting it: ${e.message}` }
  }
  if (e instanceof ScreeningUnavailable) {
    return { kind: 'prover-failed', reason: `the prover's screening could not be reached; try again in a moment: ${e.message}` }
  }
  if (e instanceof ProvingServiceError) {
    return { kind: 'prover-failed', reason: `the prover refused (${e.code}): ${e.message}${e.data ? ` — ${e.data}` : ''}` }
  }
  if (e instanceof ProvingServiceHttpError) {
    return { kind: 'prover-failed', reason: `the prover answered ${e.status}: ${e.message}` }
  }
  return { kind: 'prover-failed', reason: String(e) }
}
