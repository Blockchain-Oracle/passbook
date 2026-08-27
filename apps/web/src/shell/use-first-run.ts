//
// When the conversion panel opens, and when it must not.
//
// ── CONVERSION TRIGGERS ON INTENT, NEVER ON ARRIVAL ───────────────────────────────────────
//
// `context/11-product-experience.md` §1 is explicit and this hook is its enforcement: the first
// ninety seconds are read-heavy and nothing asks who the visitor is. The whole app is live on a
// published account — they can open chat, type in the swap form, read a market — and EXACTLY THREE
// things open conversion:
//
//   1. pressing a primary action CTA with no account of their own
//   2. pressing Receive
//   3. arriving on an invite link
//
// Anything else — a page load, a scroll, a timer, a second visit — must not. A panel that opens on
// arrival is the "Launch app" interstitial the brief spent its first paragraph refusing.
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
export type FirstRunTrigger = 'primary-action' | 'receive' | 'invite'

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
