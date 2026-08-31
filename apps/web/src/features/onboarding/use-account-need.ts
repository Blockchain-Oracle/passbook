//
// The one thing this account still needs, or nothing at all.
//
// ── ONE VALUE, SO THE SURFACES CANNOT DISAGREE ────────────────────────────────────────────
//
// Before this, "are you set up?" was answered in two places that could not see each other: the
// full-screen gate, and a wallet headline that deliberately stopped short of prompting. Nothing
// in the shell knew, so a user who skipped the gate landed in an app where every button failed
// and no screen said why — the register button existed only inside the modal they had dismissed.
//
// This returns AT MOST ONE need, already ranked. A bar that stacks three asks is a bar people
// stop reading, and the ranking is not cosmetic: an unregistered account cannot use a drip, and a
// sponsored count means nothing to someone who cannot transact yet.
//
// SILENCE IS A RESULT, NOT A FAILURE. Every "we cannot say" resolves to `null` — an unread rung, a
// relayer that did not answer, a gate still on screen. Guessing here produces the two worst
// outcomes this file exists to prevent: nagging an account that is already finished, and offering
// a faucet drip that is going to be refused.
//
import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import { dismissedSnapshot, isDismissed, subscribeDismissed } from '@/app/dismissed-notices'
import { enteredSnapshot, hasEntered, subscribeEntered } from '@/app/onboarding-entry'
import { useSession } from '@/app/session'
import { accountStatusQuery, allowanceQuery, faucetOfferQuery } from '@/queries'
import type { AccountRung } from '@/queries/account'
import type { FaucetOffer } from '@/queries/pool'

export type AccountNeed =
  /** Not on chain, or on chain without a viewing key. Both end at the same door. */
  | { kind: 'register' }
  /** No STRK, and the starter drip is still available to this address. */
  | { kind: 'drip' }
  /** No STRK and no drip left — the only way forward is their own wallet. */
  | { kind: 'fund' }
  /** Finished. Purely informational, and the only kind that reports a number. */
  | { kind: 'sponsored'; remaining: number; of: number }
  /** The chain did not answer, so nothing is known — including whether anything is wrong. */
  | { kind: 'unknown' }

/** Which needs an × may hide. `register` is absent on purpose — see `NEEDS_REGISTER_TITLE`. */
export const DISMISSIBLE: ReadonlySet<AccountNeed['kind']> = new Set(['drip', 'fund', 'sponsored'])

/** Everything the decision depends on, so the decision itself can be read — and checked — alone. */
interface NeedInputs {
  /** False while the gate is still on screen. It is already asking; two asks is one too many. */
  entered: boolean
  rung: AccountRung | undefined
  /** `undefined` = still loading, `null` = the relayer could not say. Neither means "available". */
  faucet: FaucetOffer | null | undefined
  faucetLoading: boolean
  allowance: { remaining: number; of: number } | null | undefined
  isDismissed: (kind: AccountNeed['kind']) => boolean
}

/**
 * The ranking, as one pure function.
 *
 * Split out of the hook because this is the part that can be WRONG in a way nobody would notice:
 * every branch returns a plausible-looking banner, and the failures are all of the form "nagged an
 * account that was fine" or "offered a drip that was already spent". Neither throws, so neither
 * shows up anywhere except in front of a user.
 */
function pickNeed(i: NeedInputs): AccountNeed | null {
  // A READY account is never behind the gate, so it does not need to have "entered" to be spoken
  // to. Requiring it silenced every account that was already finished before this store existed —
  // they have no entry flag and never will, so the sponsored count would have been invisible.
  if (!i.entered && i.rung !== 'ready') return null
  if (!i.rung) return null
  // The one branch that used to be silent. `unknown` is a FAILED read, not a pending one, and
  // somebody who pressed past it is sitting in an app where nothing works and nothing says why.
  if (i.rung === 'unknown') return { kind: 'unknown' }

  const unless = (need: AccountNeed): AccountNeed | null => (i.isDismissed(need.kind) ? null : need)

  // Not on chain and no viewing key end at the same door, and the ladder behind it does both.
  if (i.rung === 'undeployed' || i.rung === 'unregistered') return { kind: 'register' }

  if (i.rung === 'unfunded') {
    // Say nothing rather than offer a drip we are not sure is there: a button that answers 429 is
    // how a working faucet gets mistaken for a broken one.
    if (i.faucetLoading) return null
    return unless(i.faucet && !i.faucet.claimed ? { kind: 'drip' } : { kind: 'fund' })
  }

  if (!i.allowance) return null
  return unless({ kind: 'sponsored', remaining: i.allowance.remaining, of: i.allowance.of })
}

export function useAccountNeed(): AccountNeed | null {
  const session = useSession()
  const address = session.status === 'ready' ? session.address : undefined

  // Both stores are plain module state; subscribing is what re-renders the bar when the user
  // presses Skip, presses ×, or is handed back to the gate.
  useSyncExternalStore(subscribeEntered, enteredSnapshot, enteredSnapshot)
  useSyncExternalStore(subscribeDismissed, dismissedSnapshot, dismissedSnapshot)

  // The rung moves without us: a drip lands, a deploy confirms. Polling is what makes the bar
  // disappear on its own instead of waiting for a navigation.
  const status = useQuery({ ...accountStatusQuery(address), refetchInterval: 15_000 })
  const allowance = useQuery(allowanceQuery(address))
  const faucet = useQuery(faucetOfferQuery(address))

  return pickNeed({
    entered: Boolean(address) && hasEntered(address),
    rung: status.data?.rung,
    faucet: faucet.data,
    faucetLoading: faucet.isLoading,
    allowance: allowance.data,
    isDismissed: (kind) => isDismissed(address, kind),
  })
}
