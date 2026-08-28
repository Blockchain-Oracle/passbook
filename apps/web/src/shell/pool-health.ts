//
// The app-wide degraded reading, and the one seam a chain read will write into (story 6.5).
//
// ── WHY THERE IS NO CHAIN READ IN THIS FILE, AFTER AN ATTEMPT AT ONE ──────────────────────
//
// The first implementation polled `readPoolHealth()` through a dynamic `import()`, on the theory
// that a lazy boundary keeps the chain client out of the eager chunk. `build:web` refuted it. The
// rule in `assertAppChunkStaysLean` is stronger than "not eager": it scans EVERY emitted chunk for
// the starknet crypto markers and sums ALL emitted JavaScript against the budget. The lazy chunk
// was real — a separate 227 kB `pool-*.js` — and the build still failed at 655,436 B of 560,000,
// which is the correct answer. Every visitor would have downloaded a quarter-megabyte of crypto on
// mount to ask one boolean.
//
// So this file holds the STATE and the MAPPING, and no transport. `degradedFromHealth` is pure and
// tested, and the day a `PoolHealth` reading exists in the browser — the Wallet epic owns bringing
// chain reads across with a real budget for them — wiring it is one `setHealth()` call.
//
// ── WHAT DOES WORK TODAY, AND WHY IT IS NOT A CONSOLATION PRIZE ───────────────────────────
//
// `offline` needs no chain and no bytes: the browser already knows, and `You're offline` is one of
// the three offline strings §3 rule 4 sanctions. So the strip has a real, live, reachable state
// from day one rather than being a component waiting for a consumer.
//
import { degradedCopy, type DegradedReading } from '@strk20/protocol/degraded'

// The mapping itself lives in `@strk20/protocol/degraded` — it is logic, and only `packages/*` is
// collected by the test runner. This file holds the STATE and the browser-only transport signal.
export type PoolHealthReading = DegradedReading

//
// ── THE READING IS SHARED, BECAUSE THE STATE IS GLOBAL ────────────────────────────────────
//
// A paused pool stops all seven surfaces at once. If each surface re-derived that for itself there
// would be six readers and six chances to disagree, and the first surface to forget would render a
// live CTA over a dead pool. Worse in the other direction: a surface that hardcodes a degraded
// blocker to demonstrate the wiring claims the pool is paused when it is not — which is the exact
// overclaim the anti-demo gate exists to catch, and it was committed once in `/chat` before being
// caught here.
//
// One writer, many readers. `null` means "nothing wrong, or nothing known yet", and both of those
// correctly render no strip and no blocker.
//
type HealthListener = () => void

const healthListeners = new Set<HealthListener>()

// One object identity per state — `useSyncExternalStore` compares snapshots by reference and loops
// forever if the getter mints a new object per call.
let reading: PoolHealthReading = { mode: null }

export function subscribeHealth(listener: HealthListener): () => void {
  healthListeners.add(listener)
  return () => {
    healthListeners.delete(listener)
  }
}

export function getHealth(): PoolHealthReading {
  return reading
}

export function setHealth(next: PoolHealthReading): void {
  reading = next
  for (const listener of healthListeners) listener()
}

/**
 * The blocker sentence a surface's CTA should carry right now, or `null` when nothing is wrong.
 *
 * Only GLOBAL modes produce one. An `action`-scoped state like a declined deposit is about one
 * attempt and belongs on that attempt's own failure, not on every button in the app.
 */
export function currentBlocker(from: PoolHealthReading = reading): string | null {
  if (from.mode === null) return null
  const copy = degradedCopy(from.mode)
  return copy.scope === 'global' ? copy.blocker : null
}

/**
 * Watches the one degraded state the browser can answer on its own.
 *
 * Returns a teardown. Deliberately does not touch any other mode: a chain-backed reading that
 * arrives later must not be stamped out by a transport event, so this only ever moves between
 * `offline` and whatever the last non-offline reading was.
 */
export function watchConnectivity(): () => void {
  // Guarded, because this module is importable from a test runner with no DOM — an unguarded
  // `window` here is a ReferenceError inside anything that so much as imports the store.
  if (typeof window === 'undefined') return () => {}

  const goOffline = () => {
    // Re-entrant on purpose: browsers fire `offline` repeatedly on a flaky connection, and without
    // this guard the second one would overwrite the saved reading with `offline` itself — so
    // reconnecting would "restore" offline and the strip would stay stuck on after the connection
    // came back.
    if (reading.mode === 'offline') return
    setHealth({ mode: 'offline' })
  }

  const goOnline = () => {
    if (reading.mode !== 'offline') return
    //
    // CLEARS TO UNKNOWN, RATHER THAN RESTORING WHAT WAS THERE BEFORE.
    //
    // The first version snapshotted the pre-offline reading and put it back. That re-asserts a
    // pool state measured before a connection drop that may have lasted minutes — and it discards
    // anything written while offline, which is the very "a later reading must not be stamped out"
    // case the docstring promised to protect. `null` is the honest answer: we knew, then we lost
    // the connection, and now we do not know until something reads again.
    //
    setHealth({ mode: null })
  }

  if (!navigator.onLine) goOffline()

  window.addEventListener('offline', goOffline)
  window.addEventListener('online', goOnline)

  return () => {
    window.removeEventListener('offline', goOffline)
    window.removeEventListener('online', goOnline)
    // An unmount while offline must not leave the strip asserting a state nothing is watching any
    // more — StrictMode's double-invoke makes this reachable in development on every mount.
    if (reading.mode === 'offline') setHealth({ mode: null })
  }
}

/** Test seam, and the reset a suite needs so one case cannot leak into the next. */
export function resetHealthStore(): void {
  reading = { mode: null }
  healthListeners.clear()
}
