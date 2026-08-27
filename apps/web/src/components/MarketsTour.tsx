//
// The first-run walkthrough for Markets.
//
// ── ~150 LINES OF OUR OWN CODE, NOT A TOUR LIBRARY ───────────────────────────────────────
//
// Yosuku's `Tutorial.tsx` is the model and its shape is the whole argument: a step array, ONE
// localStorage flag, a progress dot per step, Escape and a Skip on every step, and a last step
// that ends IN the product rather than on a "done" screen. Every tour library ships a positioning
// engine, a spotlight overlay and a step DSL to do that, and none of it survives contact with a
// layout that changes at a breakpoint.
//
// ── THE FLAG IS SET ON DISMISSAL, NOT ON THE LAST STEP ───────────────────────────────────
//
// Somebody who skips has seen it; somebody who reads to the end has seen it. Both are done. Setting
// it only at the end means a skipper is shown the same tour on every visit, which is how a helpful
// thing becomes an obstacle.
//
// ── AND IT NEVER BLOCKS THE SURFACE ──────────────────────────────────────────────────────
//
// It is a panel inside the page, not a modal over it. The prices behind it are live and readable
// while it is open, which matters because step one is about those prices being real — a spotlight
// that dimmed them would be arguing against itself.
//
import { useCallback, useEffect, useState } from 'react'

import {
  TOUR_DONE,
  TOUR_SKIP,
  TOUR_STEP_CROWD_BODY,
  TOUR_STEP_CROWD_TITLE,
  TOUR_STEP_PRICES_BODY,
  TOUR_STEP_PRICES_TITLE,
  TOUR_STEP_SIDES_BODY,
  TOUR_STEP_SIDES_TITLE,
} from '@strk20/protocol/markets-copy'

import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

/** One flag, one key. Versioned so a materially different tour can be shown again. */
const SEEN_KEY = 'passbook.markets-tour.v1'

const STEPS = [
  { title: TOUR_STEP_PRICES_TITLE, body: TOUR_STEP_PRICES_BODY },
  { title: TOUR_STEP_SIDES_TITLE, body: TOUR_STEP_SIDES_BODY },
  { title: TOUR_STEP_CROWD_TITLE, body: TOUR_STEP_CROWD_BODY },
] as const

/** Read once, defensively: private-mode storage throws on ACCESS, not just on write. */
function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== null
  } catch {
    // A browser that cannot remember shows the tour every time. That is the right failure: the
    // alternative is suppressing it forever on the guess that it was probably seen.
    return false
  }
}

export function MarketsTour() {
  // The initializer runs once, so the flag is read before the first paint and a returning visitor
  // never sees a frame of the tour.
  const [step, setStep] = useState<number | null>(() => (alreadySeen() ? null : 0))

  const dismiss = useCallback(() => {
    setStep(null)
    try {
      window.localStorage.setItem(SEEN_KEY, String(Date.now()))
    } catch {
      // Nothing to do. The tour will reappear next visit, which is a repeated panel rather than a
      // broken surface.
    }
  }, [])

  // Escape closes it, from anywhere on the surface. A panel with a Skip button and no Escape is
  // the one people press Escape at anyway.
  useEffect(() => {
    if (step === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step, dismiss])

  if (step === null) {
    return (
      <button
        type="button"
        onClick={() => setStep(0)}
        className="focus-ring self-start text-body4 text-neutral3 underline"
      >
        How this works
      </button>
    )
  }

  const current = STEPS[step]!
  const last = step === STEPS.length - 1

  return (
    <section
      className="flex flex-col gap-s12 rounded-card bg-inset p-s12"
      aria-label="How markets work"
    >
      <div className="flex flex-col gap-s4">
        <Text variant="body2" className="font-medium">
          {current.title}
        </Text>
        <Text variant="body3" className="text-neutral2">
          {current.body}
        </Text>
      </div>

      <div className="flex items-center gap-s8">
        {/*
          GROWING DOTS: the current step is wider rather than merely brighter, so the position in
          the sequence survives greyscale — the same two-channel rule the rest of the app keeps.
        */}
        <span className="flex items-center gap-s4" aria-hidden="true">
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={cn(
                'h-s4 rounded-pill transition-all duration-[var(--transition-duration-quick)] ease-glide',
                index === step ? 'w-s16 bg-neutral1' : 'w-s4 bg-neutral3',
              )}
            />
          ))}
        </span>

        <span className="ml-auto flex items-center gap-s8">
          <button
            type="button"
            onClick={dismiss}
            className="focus-ring text-body4 text-neutral3 underline"
          >
            {TOUR_SKIP}
          </button>
          {/*
            THE LAST STEP ENDS IN THE PRODUCT. Yosuku's version finishes in "connect a wallet";
            ours finishes by getting out of the way, because the thing to do next on this surface
            is watch a real price — which is already behind this panel.
          */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (last ? dismiss() : setStep(step + 1))}
          >
            {last ? TOUR_DONE : 'Next'}
          </Button>
        </span>
      </div>

      {/* The step count as text, for a reader who cannot see the dots. */}
      <span className="sr-only">{`Step ${step + 1} of ${STEPS.length}`}</span>
    </section>
  )
}
