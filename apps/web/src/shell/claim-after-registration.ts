//
// Claiming the name the visitor typed on the conversion panel's first screen.
//
// ── WHY IT RUNS AFTER REGISTRATION AND NOT BEFORE ─────────────────────────────────────────
//
// The relayer verifies a claim against the public key the POOL stores for that address
// (`directory.ts`'s `verifyClaim` re-derives it from `get_public_key`). Before registration the
// pool holds nothing, so a claim submitted on the name screen would be rejected — correctly — and
// the user would have watched their chosen name fail for a reason that had nothing to do with the
// name. The signature is only checkable once the key is on-chain.
//
// ── AND WHY A FAILURE HERE IS A TOAST, NEVER A BLOCKER ────────────────────────────────────
//
// By the time this runs, the registration has CONFIRMED. Somebody's sponsored transaction has been
// spent and the account exists and works. A directory entry is a nicety on top of that — it makes
// the account findable by name, and nothing else in the app depends on it.
//
// So a failure must never be allowed to make a successful registration look failed. That is not
// politeness, it is accuracy: a user who sees an error at the end of onboarding will reasonably
// conclude their account was not created, and the true state — registered, working, unnamed — is
// the one thing the screen would have stopped saying. The account is real either way, the name is
// retryable from Settings forever, and the toast says so.
//

import { toast } from './toast-store'
// Static since the palette put the directory in the eager chunk (people-as-commands,
// `__root.tsx`): `use-directory` is plain fetch over pure types, and a dynamic import of a
// module the entry already carries is the exact INEFFECTIVE_DYNAMIC_IMPORT the gate flags.
import { claimName } from './use-directory'

export interface ClaimAfterRegistrationInput {
  /** What they typed on the name screen. Empty or absent means they did not opt in. */
  name: string
  /** Whether the opt-in checkbox was ticked. A local label is not a public claim. */
  claimPublicly: boolean
  address: string
  viewingKey: bigint
}

/**
 * Claim the name, and swallow every failure into a toast.
 *
 * Deliberately returns `void` rather than an outcome: there is no caller that should branch on
 * this. A signature that returned success/failure would invite exactly the `if (!ok) show an error
 * state` that the header rules out.
 */
export async function claimAfterRegistration(input: ClaimAfterRegistrationInput): Promise<void> {
  const name = input.name.trim()
  if (!input.claimPublicly || name === '') return

  try {
    // Dynamic for the build gate's reason, copied from `NameClaim.tsx`: `directory.ts` reaches
    // `starknet` for the curve signature, and a static import would drag the crypto graph into the
    // chunk that only wanted an onboarding panel.
    const { signClaim } = await import('@strk20/protocol/directory')

    const signature = signClaim(name, input.address, input.viewingKey)
    const outcome = await claimName({ name, address: input.address, signature })

    if (!outcome.ok) {
      // The relayer's OWN sentence, verbatim — it knows why (name taken, budget spent, malformed)
      // and this module does not. Paraphrasing it here would be a second, worse explanation.
      toast({
        kind: 'info',
        title: 'Your account is ready',
        detail: `The name @${name} was not claimed: ${outcome.because} You can claim one in Settings.`,
      })
      return
    }

    toast({
      kind: 'success',
      title: `You are @${name}`,
      detail: 'Anyone can now find this address by that name.',
    })
  } catch (e) {
    // A thrown network error lands here rather than anywhere the user can mistake for a failed
    // registration. Same sentence shape: the account first, the name second.
    toast({
      kind: 'info',
      title: 'Your account is ready',
      detail: `The name @${name} could not be claimed just now (${String(e)}). You can claim one in Settings.`,
    })
  }
}
