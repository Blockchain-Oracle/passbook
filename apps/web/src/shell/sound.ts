//
// The app's one audio channel (Abu's ruling 2026-08-28, taken from ZK Freighter's intro).
//
// ── AUTOPLAY IS BLOCKED, AND THE FIX IS A LISTENER ATTACHED BEFORE THE FAILURE ────────────
//
// Every browser refuses audible playback until the page has seen a user gesture. A bare
// `audio.play()` on mount therefore rejects on a cold open — which is EXACTLY the moment the
// brand intro wants a chime — and the naive repair (retry inside the rejected promise's
// `.catch`) loses the race: the rejection resolves a microtask or two after the click that
// would have unblocked it, so the first gesture is consumed by the failure rather than by the
// retry.
//
// `arm()` therefore attaches `pointerdown`/`keydown` listeners UP FRONT, before the first
// attempt, and makes the attempt idempotent. The gesture that skips the intro is the gesture
// that lands the sound. This is `reference/zk-freighter/packages/ui/src/intro.tsx:73-90`'s
// mechanism, carried over intact because it is the only part of that file that is load-bearing.
//
// ── SOUND IS OPT-OUT, AND THE PREFERENCE IS READ ON EVERY PLAY ────────────────────────────
//
// Default on: the chime is a first-run flourish and a muted-by-default flourish is one nobody
// hears. But it is one key in `localStorage` and Settings owns the toggle, so a user who does
// not want it never hears it twice. The preference is read at PLAY time rather than cached at
// module load, so muting takes effect on the next sound instead of the next reload.
//
// ── AND IT IS QUIETER THAN THE SOURCE ──────────────────────────────────────────────────────
//
// ZK Freighter plays this asset at 0.75. On a laptop at ordinary system volume that is loud
// enough to make someone reach for the mute key, which is the opposite of the intended effect.
// 0.45 is the shipped level — audible on speakers, not startling on headphones.
//

/** The shipped level. Deliberately below ZK Freighter's 0.75 — see the header. */
const DEFAULT_VOLUME = 0.45

/** The one preference key. Absent means "on", so a fresh browser hears the intro. */
const MUTED_KEY = 'passbook.sound-muted'

/**
 * Is sound off?
 *
 * Read through a try/catch because `localStorage` THROWS rather than returning null in a
 * partitioned or blocked context — Safari's Lockdown Mode and an embedded frame both do it. A
 * storage failure must not be read as "muted"; the honest fallback is the default, which is on.
 */
export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

/** Writes the preference. Silent on failure — a browser that cannot store it still plays. */
export function setMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTED_KEY, '1')
    else localStorage.removeItem(MUTED_KEY)
  } catch {
    // storage unavailable; the preference simply does not survive this session
  }
  for (const listener of listeners) listener()
}

const listeners = new Set<() => void>()

/** `useSyncExternalStore` subscription, so a Settings toggle re-renders on change. */
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** What `arm` hands back: play it when ready, and tear it down on unmount. */
export interface ArmedSound {
  /** Attempt playback now. Idempotent, and a rejected attempt re-arms for the next gesture. */
  play: () => void
  /** Detach the gesture listeners and stop the element. Safe to call twice. */
  dispose: () => void
}

/**
 * Load a sound and arm it against the autoplay policy.
 *
 * Returns immediately; nothing is audible until `play()` succeeds, which may be on the first
 * call or on the first user gesture after it. Call `dispose()` on unmount — React's StrictMode
 * double-mounts in development, and without it the second mount layers a second copy of the
 * chime over the first.
 */
export function arm(src: string, volume = DEFAULT_VOLUME): ArmedSound {
  if (typeof window === 'undefined' || isMuted()) {
    return { play: () => {}, dispose: () => {} }
  }

  const audio = new Audio(src)
  audio.volume = volume
  audio.preload = 'auto'
  audio.load()

  let started = false
  let disposed = false

  const play = () => {
    if (started || disposed || isMuted()) return
    started = true
    // A rejection means the gesture has not landed yet. Clearing the latch is what lets the
    // listeners below retry rather than giving up after one refused attempt.
    audio.play().catch(() => {
      started = false
    })
  }

  window.addEventListener('pointerdown', play, { capture: true })
  window.addEventListener('keydown', play, { capture: true })

  const dispose = () => {
    if (disposed) return
    disposed = true
    window.removeEventListener('pointerdown', play, { capture: true })
    window.removeEventListener('keydown', play, { capture: true })
    audio.pause()
  }

  return { play, dispose }
}

/**
 * Fire-and-forget a short sound in response to something the user just did.
 *
 * Unlike `arm`, this needs no gesture plumbing: it is called FROM a gesture handler, so the page
 * is already unblocked. Failures are swallowed — a missing asset must never break the action the
 * sound was decorating.
 */
export function play(src: string, volume = DEFAULT_VOLUME): void {
  if (typeof window === 'undefined' || isMuted()) return
  const audio = new Audio(src)
  audio.volume = volume
  void audio.play().catch(() => {})
}

/** The intro chime, reused from ZK Freighter. Lives in `public/`, so the path is absolute. */
export const INTRO_SOUND = '/intro-welcome.mp3'
