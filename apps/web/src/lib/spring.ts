//
// A spring that inherits its velocity, and the two-follower trick built on it.
//
// Ported from `reference/yosuku/lib/animation/useSpring.ts` — the mechanics, not the file. Four
// things in it are load-bearing and every one of them is the kind of detail that gets "simplified"
// out by somebody who reads it as a lerp with extra steps.
//
// ── WHY A FIXED SUBSTEP AND NOT THE FRAME DELTA ──────────────────────────────────────────
//
// A stiff spring integrated with a variable `dt` goes numerically unstable the moment the tab
// stutters — the value explodes rather than degrading. Time is therefore consumed in 4 ms slices
// small enough to stay stable at any frame rate, which is what makes this safe on a 30 fps phone
// and a 144 Hz monitor alike.
//
// ── AND A CATCH-UP CAP, BECAUSE A BACKGROUNDED TAB HANDS BACK SECONDS ────────────────────
//
// Without the cap, returning to a tab that slept for ten seconds would run 2,500 substeps in one
// frame and freeze the main thread. The gap is skipped rather than simulated.
//
// ── VELOCITY BEFORE POSITION ─────────────────────────────────────────────────────────────
//
// Semi-implicit (symplectic) Euler. The explicit form — position from the OLD velocity — injects
// energy and drifts; the order is free correctness.
//
// ── AND THE OVERSHOOT CLAMP IS A SIGN TEST ───────────────────────────────────────────────
//
// Not a distance test: if the sign of `x - target` flipped during a step, the spring crossed its
// target, so it lands exactly on it and stops. A price line that rings past the real number is
// rendering a trade that never happened.
//
import { useEffect, useRef, useState } from 'react'

export interface SpringConfig {
  stiffness?: number
  damping?: number
  mass?: number
  /** Stop dead on the target rather than ringing past it. */
  clamp?: boolean
  restDelta?: number
}

/**
 * The defaults, and they are a chosen feel rather than a physical ideal.
 *
 * Critical damping for k=210, m=1 is 2·√210 ≈ 29, so 26 is slightly under-damped — it would ring.
 * `clamp` truncates that ring, and the result reads as fast and decisive with no bounce.
 */
const STIFFNESS = 210
const DAMPING = 26
const MASS = 1
const REST_DELTA = 0.001

/** The integration slice. Small enough that a stiff spring stays stable at any frame rate. */
const STEP_MS = 4

/** The most simulated time one frame may consume. A slept tab skips its gap rather than replaying it. */
const MAX_CATCHUP_MS = 64

export interface Spring {
  value: number
  velocity: number
}

export function useSpring(target: number, config: SpringConfig = {}): Spring {
  const stiffness = config.stiffness ?? STIFFNESS
  const damping = config.damping ?? DAMPING
  const mass = config.mass ?? MASS
  const clamp = config.clamp ?? true
  const restDelta = config.restDelta ?? REST_DELTA

  // Seeded AT the first target, so there is no entry animation from zero — a price strip that
  // counted up from 0 on every mount would be theatre.
  const [value, setValue] = useState(target)
  const [velocity, setVelocity] = useState(0)
  const state = useRef({ x: target, v: 0, target })
  const raf = useRef<number | null>(null)
  const last = useRef<number | null>(null)

  //
  // VELOCITY INHERITANCE, AND IT IS THIS ONE LINE.
  //
  // The target is written during render and `v` is never touched, so a new target mid-flight
  // changes only the destination — momentum from the previous leg carries into the next. Ticks
  // pushing the same way compound into visible acceleration; chop cancels itself and stays calm.
  // The naive version restarts the animation with `v = 0` on every retarget, which makes every
  // tick look identical and destroys the sense of a trend.
  //
  // Safe during render because it is an idempotent ref write for a given `target`, and the
  // retarget has to be visible to the NEXT rAF tick — an effect would be a frame late.
  //
  state.current.target = target

  useEffect(() => {
    const tick = (now: number) => {
      const s = state.current
      const dt = Math.min(now - (last.current ?? now), MAX_CATCHUP_MS)
      last.current = now

      let remaining = dt
      while (remaining > 0) {
        const h = Math.min(STEP_MS, remaining) / 1000
        remaining -= STEP_MS

        const displacement = s.x - s.target
        const acceleration = (-stiffness * displacement - damping * s.v) / mass

        s.v += acceleration * h
        s.x += s.v * h

        if (clamp && displacement !== 0 && Math.sign(s.x - s.target) !== Math.sign(displacement)) {
          s.x = s.target
          s.v = 0
        }
      }

      const atRest = Math.abs(s.x - s.target) < restDelta && Math.abs(s.v) < restDelta
      if (atRest) {
        s.x = s.target
        s.v = 0
        last.current = null
      }

      setValue(s.x)
      setVelocity(s.v)
      // A flat market burns ZERO frames: at rest the loop simply stops scheduling. The effect's
      // `target` dependency is what re-arms it, which is why that dep must not be dropped.
      raf.current = atRest ? null : requestAnimationFrame(tick)
    }

    if (raf.current === null) raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
      last.current = null
    }
  }, [target, stiffness, damping, mass, clamp, restDelta])

  return { value, velocity }
}

export interface PriceFollow {
  /** The sprung value, for rendering. */
  value: number
  /** 0–1, for glow and brightness. */
  intensity: number
}

/**
 * One spring, plus the speed readout a surface actually renders.
 *
 * ── IT WAS TWO SPRINGS, AND THE SECOND ONE WAS DELETED ───────────────────────────────────
 *
 * Yosuku's version runs a stiff follower and a loose one against the same target so the gap
 * between them reads as speed. It is a good trick and nothing here consumed it: only `value` and
 * `intensity` were ever read, so the second spring was a full requestAnimationFrame loop, with two
 * `setState` calls per frame, per price cell, producing a number that reached no pixel. Three
 * extra render-per-frame loops for an effect that was not on screen.
 *
 * Restoring it is four lines the day a surface renders the separation. Shipping it unread is a
 * cost with no picture attached.
 *
 * @param velocityScale units-per-second that should read as "full speed". A PARAMETER because the
 *   right value is a property of what is being sprung: 40 suits a dollar price and is meaningless
 *   for a percentage or for an asset trading at three cents.
 */
export function usePriceFollow(target: number, velocityScale: number): PriceFollow {
  const spring = useSpring(target, { stiffness: 210, damping: 26 })

  return {
    value: spring.value,
    // Guarded: a zero or negative scale would divide to Infinity and pin every dot at full glow.
    intensity:
      velocityScale > 0 ? Math.min(1, Math.abs(spring.velocity) / velocityScale) : 0,
  }
}
