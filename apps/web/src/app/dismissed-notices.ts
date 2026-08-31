//
// Which informational notices this address has waved away.
//
// Only the ones that are safe to lose. The registration prompt is deliberately NOT routed through
// here: an unregistered account cannot do anything, so dismissing that would leave someone in an
// app where every button fails and nothing on screen says why. What can be dismissed is news —
// the starter drip, the sponsored count — where the cost of hiding it is that the user forgets a
// convenience, not that they lose the explanation for a dead app.
//
// Per address, and persisted: a notice that reappears on every reload is not dismissible, it is
// merely slow, and people stop reading the bar entirely.
//

const KEY = 'strk20.dismissed'

type Store = Record<string, string[]>

let store: Store = read()
const listeners = new Set<() => void>()

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

export function isDismissed(address: string | undefined, kind: string): boolean {
  return Boolean(address) && (store[address!] ?? []).includes(kind)
}

export function dismiss(address: string | undefined, kind: string): void {
  if (!address || isDismissed(address, kind)) return
  store = { ...store, [address]: [...(store[address] ?? []), kind] }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store))
  } catch {
    // In-memory for this tab; it comes back next load, which is the harmless direction.
  }
  for (const l of listeners) l()
}

/** Wipes every address's dismissals. For `forget()`, which is not a per-address operation. */
export function clearDismissed(): void {
  store = {}
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Already gone from this tab's view; the next load reads an absent key as empty.
  }
  for (const l of listeners) l()
}

export function subscribeDismissed(listener: () => void): () => void {
  listeners.add(listener)
  // Braced: `Set.delete` answers a boolean, and a cleanup that returns one reads to React
  // like a value it should care about. It does not, but the next reader should not have to check.
  return () => {
    listeners.delete(listener)
  }
}

/** A value that changes whenever anything is dismissed — enough for `useSyncExternalStore`. */
export function dismissedSnapshot(): Store {
  return store
}
