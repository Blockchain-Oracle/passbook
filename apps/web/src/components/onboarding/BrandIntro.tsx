//
// The cold open (Abu's ruling 2026-08-28, taken from ZK Freighter's `intro.tsx`).
//
// ── IT DOES NOT GATE THE APP, AND THAT IS THE WHOLE RECONCILIATION ────────────────────────
//
// `use-first-run.ts` is explicit: the first ninety seconds are read-heavy and NOTHING asks who the
// visitor is. Exactly three things may interrupt them, and a page load is not one — a panel that
// opens on arrival is the "Launch app" interstitial `context/11-product-experience.md` §1 spent
// its opening paragraph refusing.
//
// This is not that panel, and the distinction is load-bearing rather than a loophole. It ASKS
// NOTHING: no field, no choice, no account. It paints over a shell that has already rendered, it
// dismisses on its own timer whether or not anybody touches it, and every tap or key anywhere on
// it means "go". Three seconds of brand before a live page is atmosphere; three seconds of brand
// in front of a form is a gate. Only the second one is banned.
//
// ── ONCE PER BROWSER ──────────────────────────────────────────────────────────────────────
//
// A cold open that plays on every navigation is a cold open somebody disables. The `localStorage`
// key is written when the intro FINISHES rather than when it mounts, so a hard refresh mid-intro
// still gets the whole thing next time instead of half of it once.
//
// ── AND THE SOUND IS THE POINT ────────────────────────────────────────────────────────────
//
// `../../shell/sound.ts` owns the autoplay dance; see its header for why the gesture listeners are
// attached before the first attempt rather than inside the failure. What matters here is the
// TIMING: the dissolve starts at 2.8 s and takes 500 ms, so it lands inside the asset's own fade
// and the two read as one event rather than as a chime that outlives the picture.
//
import { useCallback, useEffect, useRef, useState } from 'react'

import { INTRO_SOUND, arm } from '../../shell/sound'

/** Written on COMPLETION, never on mount — see the header. */
const SEEN_KEY = 'passbook.intro-seen'

/** Hold, then dissolve. The dissolve duration must match `.intro-stage`'s transition. */
const HOLD_MS = 2_800
const FADE_MS = 500

/**
 * Has this browser already seen the cold open?
 *
 * Through a try/catch because `localStorage` THROWS rather than returning null in a partitioned or
 * blocked context. A storage failure means "we do not know" — and the honest reading of that is
 * "not seen", so the intro plays. Showing a three-second flourish twice is a smaller failure than
 * a first-run experience nobody in Lockdown Mode ever gets.
 */
function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export interface BrandIntroProps {
  /** The line under the wordmark. Mono, uppercase, wide-tracked — the `.kicker` voice. */
  tagline?: string
  /** Fires once the stage is gone, for anything that wants to sequence behind it. */
  onDone?: () => void
}

export function BrandIntro({ tagline = 'Private money that behaves like money', onDone }: BrandIntroProps) {
  //
  // THE INITIAL STATE IS COMPUTED IN THE INITIALISER, NOT IN AN EFFECT. Reading storage in a
  // `useEffect` would render the stage for one frame before hiding it — a black flash on every
  // single navigation for the returning user this check exists to spare.
  //
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>(() => (alreadySeen() ? 'gone' : 'in'))

  // Latched rather than derived from `phase`, because `finish` is reachable from a click, a
  // keystroke and a timer at the same instant and only the first may run.
  const doneRef = useRef(false)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // storage unavailable; the intro simply is not remembered
    }
    setPhase('out')
    window.setTimeout(() => {
      setPhase('gone')
      onDone?.()
    }, FADE_MS)
  }, [onDone])

  useEffect(() => {
    if (phase !== 'in') return

    const sound = arm(INTRO_SOUND)
    sound.play()
    const timer = window.setTimeout(finish, HOLD_MS)

    // Any key ends it, including Escape and Tab — a keyboard user's first instinct on an
    // unexpected overlay is to press something, and every one of those means "go".
    const onKey = () => finish()
    window.addEventListener('keydown', onKey)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      // StrictMode double-mounts in development. Without this the second mount layers a second
      // copy of the chime over the first, which is audible and sounds like a bug because it is.
      sound.dispose()
    }
    // Mount only: `finish` is stable and `phase` is read once to decide whether to run at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      /*
        `presentation`, and NOT a dialog. A dialog role promises focus containment and a labelled
        surface with something to do in it; this has neither and announcing it as one would trap a
        screen reader in three seconds of decoration. The shell underneath is the real content and
        it is already rendered, so the honest thing is to expose nothing here at all.
      */
      role="presentation"
      aria-hidden="true"
      data-phase={phase}
      onClick={finish}
      className="intro-stage"
    >
      {/* Same gold wash as the conversion takeover, so the two surfaces are visibly one family. */}
      <div className="onboarding-glow pointer-events-none absolute inset-s0" />

      <span className="intro-mark">
        <span className="intro-ring" />
        <span className="intro-ring intro-ring-2" />
        <span className="intro-ring intro-ring-3" />
      </span>

      <span className="intro-word">
        <span className="display text-display1 text-neutral1">Passbook</span>
        <span className="kicker">{tagline}</span>
      </span>
    </div>
  )
}
