//
// Registering this browser's account with the pool.
//
// ── THE PIPELINE IS UNTOUCHED; ONLY ITS SEAMS ARE FILLED ─────────────────────────────────
//
// `registerSponsored` is the one pipeline in this repository that has demonstrably worked on
// mainnet — build, prove, relay, confirm, with the proof pair on the wire. Every dependency it
// needs is an injection point with a refusing default, so making it work from a browser is a
// matter of supplying three of them rather than editing any of it:
//
//   canRegister  the backup ceremony's terminal state. Defaults to FALSE, which is why the
//                ceremony had to exist before this could.
//   submit       self-submission from the embedded key, instead of a post to a relayer.
//   onStage      so the surface can show which of the four stages is running.
//
// ── WHY SELF-SUBMIT RATHER THAN THE RELAYER ──────────────────────────────────────────────
//
// The relayer sponsors the fee, which is the better experience — and it refuses every submission
// while its balance is under twice the live pool fee (`fundingFloor`, currently 12 STRK against a
// 4.35 balance). It is also not hosted. Self-submission needs neither, and the account already
// holds STRK because it paid for its own deployment.
//
// What it costs is stated on the surface rather than here: the user pays the pool's fee and the
// gas, including on an attempt that reverts.
//
import type { RegistrationStage } from '@strk20/protocol/pipeline-stage'

import { makeSelfSubmitRegistration } from './submit'

export type RegisterOutcome =
  | { readonly ok: true; readonly transactionHash: string; readonly block: number | null }
  /** `because` is a whole sentence from the pipeline's own failure union, safe to render. */
  | { readonly ok: false; readonly because: string }

export interface RegisterOptions {
  accountKey: string
  address: string
  /** True once the backup ceremony reached its terminal state. Nothing proceeds without it. */
  backedUp: boolean
  onStage?: (stage: RegistrationStage) => void
}

/**
 * Register, from this browser, paying with this browser's account.
 *
 * NEVER THROWS. Every failure the pipeline models is already a sentence; anything it does not
 * model is caught and turned into one, because this is called from a click handler.
 */
export async function registerAccount(options: RegisterOptions): Promise<RegisterOutcome> {
  const { accountKey, address, backedUp, onStage } = options

  if (!backedUp) {
    return {
      ok: false,
      because:
        'Save the recovery file first. The pool accepts a viewing key once and never replaces it, ' +
        'so registering without a way back in is the one mistake that cannot be undone.',
    }
  }

  try {
    const [{ registerSponsored }, { Account, RpcProvider }, { NET }] = await Promise.all([
      import('@strk20/protocol/register'),
      import('starknet'),
      import('@strk20/protocol/constants'),
    ])

    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
    const account = new Account({ provider, address, signer: accountKey })

    const result = await registerSponsored(
      {
        accountKey,
        // The SDK's user shape. `registerSponsored` reads `.address` off it and hands it to the
        // prover; the signer is what proves the pre-flight probe.
        account: account as never,
        appName: 'Passbook',
      },
      {
        // The ceremony's gate, already checked above — passed anyway so the pipeline enforces it
        // too. A guard that lives only in the caller is a guard the next caller forgets.
        canRegister: () => backedUp,
        submit: makeSelfSubmitRegistration(accountKey, address),
        onStage,
      },
    )

    if (result.ok) {
      return {
        ok: true,
        transactionHash: result.transactionHash,
        block: result.registrationBlock ?? null,
      }
    }

    return { ok: false, because: describeFailure(result.failure) }
  } catch (error) {
    return {
      ok: false,
      because: error instanceof Error ? error.message : 'The registration could not be started.',
    }
  }
}

/**
 * One sentence per failure kind.
 *
 * The pipeline's union is already exhaustive and every arm carries what a reader needs; this only
 * turns each into prose. `already-registered` is deliberately NOT an error in tone — arriving there
 * means the account is usable, which is the outcome the user wanted.
 */
function describeFailure(failure: { kind: string; reason?: string; onChainKey?: bigint }): string {
  switch (failure.kind) {
    case 'backup-not-confirmed':
      return 'The recovery file has not been saved yet, so registration is still closed.'
    case 'already-registered':
      return 'This account is already registered with the pool. Nothing was submitted.'
    case 'collision':
      return 'The pool already holds a different viewing key for this address, and it cannot be replaced.'
    case 'blocked-rpc-unknown':
      return `The chain could not be read, so nothing was submitted: ${failure.reason ?? 'no reason given'}`
    case 'bad-input':
      return `Registration was refused before anything was spent: ${failure.reason ?? 'no reason given'}`
    default:
      return failure.reason ?? `Registration stopped at \`${failure.kind}\`.`
  }
}
