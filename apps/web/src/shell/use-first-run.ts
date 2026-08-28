//
// When the conversion panel opens, and when it must not.
//
// ── THE FIRST ARRIVAL OPENS IT; EVERY LATER ONE NEEDS INTENT ──────────────────────────────
//
// SUPERSEDES §1's "on intent, never on arrival" — Abu's 28-Aug review, on the deployed app as a
// first-time visitor: "the onboarding flow... it's my first time on this site and I don't even
// know. None of it is even happening." A first-timer landing on a wallet full of empty panels
// with no guide IS the broken experience, whatever the old doctrine said. So:
//
//   1. the FIRST visit ever (no completion flag, no registered account) opens the flow on
//      arrival, once per page load — dismissing it sticks for the visit
//   2. after that, the original three intents reopen it: a primary action CTA with no account,
//      Receive, an invite link
//
// A second visit, a scroll, a timer still must not — the interstitial the brief refused was the
// one that NEVER stops appearing, not the one that greets you once.
//
// ── AND IT IS A ROW, NOT A MODAL ──────────────────────────────────────────────────────────
//
// The brief: "an inline bordered row above the button — never a scrimmed modal, the page stays
// interactive, the composed form stays filled". That is why this hook returns a state a surface
// renders INLINE rather than something that mounts a dialog. The form the visitor composed is the
// thing they came back to; a scrim that discards it would make conversion cost them their work.
//
import { useCallback, useSyncExternalStore } from 'react'

/** The one flag this hook persists, and it records a COMPLETION rather than a viewing. */
const SEEN_KEY = 'passbook.first-run-seen'

/** What opened the panel. Carried so screen 4 can attribute a sponsored registration. */
export type FirstRunTrigger = 'primary-action' | 'receive' | 'invite' | 'arrival'

/**
 * The once-per-page-load latch for the arrival open. A module flag rather than state: dismissing
 * the panel must hold for the whole visit, and remounting the wallet route must not re-greet.
 */
let arrivalOffered = false

/**
 * Open the flow for a first-ever visitor, once. The caller supplies what it already knows —
 * whether an account is registered — and this refuses everywhere the greeting would be wrong:
 * a finished conversion, a registered account, or a visit that was already greeted.
 */
export function offerFirstRunOnArrival(options: { registered: boolean }): void {
  if (arrivalOffered || options.registered || hasSeenFirstRun() || state.open) return
  arrivalOffered = true
  emit({ open: true, trigger: 'arrival', inviter: null })
}

export interface FirstRunState {
  /** True while the panel should be on screen. */
  open: boolean
  /** Why it opened — `null` when it is closed. */
  trigger: FirstRunTrigger | null
  /** Whoever is paying, when an invite brought them here. */
  inviter: string | null
}

let state: FirstRunState = { open: false, trigger: null, inviter: null }
const listeners = new Set<() => void>()

function emit(next: FirstRunState) {
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/**
 * Has this browser already finished a conversion?
 *
 * Read through a try/catch because `localStorage` throws rather than returning null in a partitioned
 * or blocked context — Safari's Lockdown Mode and an embedded frame both do it. A storage failure
 * must mean "we do not know", which here is the same as "not seen", so the panel can still open. The
 * alternative — treating a throw as `seen` — would silently lock a real new user out of the only
 * path to an account.
 */
export function hasSeenFirstRun(): boolean {
  try {
    return globalThis.localStorage?.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Record that conversion FINISHED.
 *
 * Deliberately not called when the panel is merely dismissed. A user who closes the panel to look
 * around is exactly the visitor the cold open is designed for, and they must be able to open it
 * again from the same three triggers. The flag exists to stop a walkthrough re-running at somebody
 * who already has an account — nothing more.
 */
export function markFirstRunSeen(): void {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, '1')
  } catch {
    // A browser that cannot persist this will offer the panel again on the next intent, which is a
    // repeated offer rather than a broken account. Worth nothing more than a silent catch.
  }
}

/**
 * Open the panel.
 *
 * `hasAccount` is passed by the CALLER rather than read here, because this module must not reach
 * into the session — the surfaces already hold session state and a second reader would be a second
 * source of truth about whether an account exists. A caller with an account never opens conversion:
 * pressing Send with a real account is a send, not a signup.
 */
export function openFirstRun(
  trigger: FirstRunTrigger,
  options: { hasAccount: boolean; inviter?: string | null } = { hasAccount: false },
): void {
  if (options.hasAccount) return
  emit({ open: true, trigger, inviter: options.inviter ?? null })
}

export function closeFirstRun(): void {
  emit({ open: false, trigger: null, inviter: null })
}

/**
 * The panel's state, and the two controls a surface needs.
 *
 * `useSyncExternalStore` rather than context: the trigger fires from a button deep inside a form and
 * the panel renders near the top of the route, and threading a provider between them would put this
 * concern into every component in the middle.
 */
export function useFirstRun(): FirstRunState & {
  open: FirstRunState['open']
  start: (trigger: FirstRunTrigger, options?: { hasAccount: boolean; inviter?: string | null }) => void
  dismiss: () => void
  complete: () => void
} {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state)

  const start = useCallback(
    (trigger: FirstRunTrigger, options?: { hasAccount: boolean; inviter?: string | null }) =>
      openFirstRun(trigger, options ?? { hasAccount: false }),
    [],
  )

  const complete = useCallback(() => {
    markFirstRunSeen()
    closeFirstRun()
  }, [])

  return { ...snapshot, start, dismiss: closeFirstRun, complete }
}
