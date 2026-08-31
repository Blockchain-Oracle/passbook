//
// Which address has been let past the onboarding gate, and whether it stays let past.
//
// ── THIS USED TO BE A `useState` INSIDE THE GATE, AND THAT IS WHY SKIP WAS A DEAD END ─────
//
// Pressing "Skip for now" set a local flag on one component. Two consequences, both bad. It did
// not survive a reload, so the full-screen gate jumped back in front of a user who had already
// declined it. And nothing outside that component could read it, so nothing else could tell the
// difference between "still deciding" and "in the app with an unregistered account" — which is
// exactly the distinction a standing prompt needs in order to know whether to speak.
//
// Lifting it here makes both possible: the gate reads it, the banner reads it, and the banner can
// CLEAR it to hand a user back to the gate at the step they still owe.
//
// Keyed by address, never a bare boolean. One browser holds several accounts and switching to a
// fresh one must ask again — a flag set by the account you finished would silently wave the new
// one through.
//
// localStorage, not the vault. This is a UI preference: losing it costs one extra screen, and it
// must never sit anywhere that a lost key could be confused for.
//

const KEY = 'strk20.entered'

let entered: string | null = read()
const listeners = new Set<() => void>()

/** Private-mode Safari throws on read as well as write; an unreadable preference is simply absent. */
function read(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

function write(next: string | null): void {
  try {
    if (next === null) globalThis.localStorage?.removeItem(KEY)
    else globalThis.localStorage?.setItem(KEY, next)
  } catch {
    // In-memory only for this tab. The gate asks again next load, which is the safe direction.
  }
}

/** True when THIS address has already been let in — a different one has not. */
export function hasEntered(address: string | undefined): boolean {
  return Boolean(address) && entered === address
}

/** Let `address` in, or (with `null`) hand it back to the gate. */
export function setEntered(address: string | null): void {
  if (entered === address) return
  entered = address
  write(address)
  for (const l of listeners) l()
}

export function subscribeEntered(listener: () => void): () => void {
  listeners.add(listener)
  // Braced: `Set.delete` answers a boolean, and a cleanup that returns one reads to React
  // like a value it should care about. It does not, but the next reader should not have to check.
  return () => {
    listeners.delete(listener)
  }
}

/** The snapshot `useSyncExternalStore` compares. A string, so identity is value equality. */
export function enteredSnapshot(): string | null {
  return entered
}
