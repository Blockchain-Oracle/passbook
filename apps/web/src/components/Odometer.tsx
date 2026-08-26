//
// The digit machine (story 6.7b, DESIGN:242, EXPERIENCE:138).
//
// ── THIS COMPONENT DECIDES NOTHING ────────────────────────────────────────────────────────
//
// Which glyphs move, in what order, and in which direction all come from `rollPlan` in
// `packages/protocol/src/odometer.ts`, because `vitest.config.ts` collects `packages/*/test/**`
// only — a rule written here is a rule no runner executes. What is left in this file is the parts
// that genuinely need a DOM: the previous value, the hover, and the media query.
//
// ── THE ODOMETER IS RATIONED TO TWO NUMBERS ───────────────────────────────────────────────
//
// DESIGN:242: anonymity-set size and the block counter, and "widening is a canon change only Abu
// can make". This component existing does not make it general-purpose furniture. A third call site
// is a conversation, not an import.
//
// ── REDUCED MOTION IS GATED TWICE, WHICH IS NOT BELT-AND-BRACES ───────────────────────────
//
// The stylesheet names this component's animated class in its reduced-motion block, which stops
// the movement. But the DOM would still carry a two-deep track per digit, and a reader who asked
// their OS to stop motion should get the simpler tree, not a stilled version of the complex one.
// EXPERIENCE:138 asks for both spellings explicitly: "reduced-motion honored in CSS *and* JS".
//
import { useEffect, useRef, useState } from 'react'
import { rollPlan } from '@strk20/protocol/odometer'

export interface OdometerProps {
  value: number
  /** Accessible name. The figure alone is not a sentence. */
  label: string
}

/** `true` when the reader has asked the OS to stop motion. Subscribed, not sampled once. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    // Guarded because a render can happen before a `window` exists in some toolchains, and a
    // component that throws in that window takes the whole surface with it.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])

  return reduced
}

export function Odometer({ value, label }: OdometerProps) {
  const reduced = useReducedMotion()
  const [frozen, setFrozen] = useState(false)

  // The value at the last PAINT, not the last render. `null` until the first commit, which is what
  // makes a first paint produce no roll — a figure that rolled in from nothing on mount would be
  // claiming a change we have no history for.
  const painted = useRef<number | null>(null)
  const previous = painted.current

  useEffect(() => {
    painted.current = value
  }, [value])

  // HOVER-FREEZE (EXPERIENCE:138: "so chart scrubbing never fires 60 rolls/sec"). Also the honest
  // behaviour for a reader trying to actually read the number while it is being polled.
  const still = reduced || frozen
  const plan = rollPlan(still ? null : previous, value)

  return (
    <span
      className="odometer numeric"
      role="img"
      aria-label={`${label}: ${value}`}
      onMouseEnter={() => setFrozen(true)}
      onMouseLeave={() => setFrozen(false)}
    >
      {plan.digits.map((digit, index) => {
        const roll = plan.rolls.find((r) => r.index === index)
        if (!roll) {
          return (
            <span className="odometer-digit" key={index} aria-hidden="true">
              {digit.char}
            </span>
          )
        }
        return (
          <span
            className="odometer-digit"
            key={index}
            aria-hidden="true"
            data-rolling=""
            data-direction={plan.direction}
            // The stagger ORDINAL, not a delay. CSS multiplies it by the one place the 40ms lives,
            // so the number the design authority owns is never retyped into a component.
            style={{ '--roll-step': roll.step } as React.CSSProperties}
          >
            <span className="odometer-track">
              {/* Rising shows the old glyph first and travels up; falling is the same keyframes
                  played in reverse, which is why the pair is ordered by direction here. */}
              <span>{plan.direction === 'up' ? (roll.from ?? '') : roll.to}</span>
              <span>{plan.direction === 'up' ? roll.to : (roll.from ?? '')}</span>
            </span>
          </span>
        )
      })}
    </span>
  )
}
