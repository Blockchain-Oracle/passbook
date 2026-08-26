import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'
import { pinTheme, storedChoice, themeChoice } from '../shell/theme'
import type { ThemeChoice } from '../shell/theme'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

//
// THREE OPTIONS, NOT A TOGGLE. "Follow the system" is a real state and the one a user who has
// pinned a theme by accident needs to get back to — a two-way switch cannot express it, so it
// strands them. `null` is that state; the radio group carries it as a value like any other.
//
// Radios rather than buttons because the browser already knows how to do this: one tab stop for the
// group, arrow keys between options, the current choice announced. Nothing here is re-implemented.
//
const THEME_OPTIONS = [
  { id: 'light', value: 'light', label: 'Light' },
  { id: 'dark', value: 'dark', label: 'Dark' },
  { id: 'system', value: null, label: 'Follow system' },
] as const satisfies readonly { id: string; value: ThemeChoice; label: string }[]

/**
 * The two facts this screen is allowed to speak from, read fresh every time it renders.
 *
 * NEITHER OF THEM IS "WHAT THE USER JUST CLICKED", and that is the whole design. `choice` is what
 * the document is painted as; `stored` is what a reload would restore. Every sentence below is a
 * comparison of those two, so the copy cannot drift from reality — not on a remount, not when a
 * write half-succeeded, not when the click never took at all.
 */
function readThemeState() {
  return { choice: themeChoice(), stored: storedChoice() }
}

function Settings() {
  //
  // Seeded from the DOM and from storage, never from click history. The bug this shape removes:
  // click-session state resets on remount, so navigating away from `/settings` and back used to
  // fall through to the durable sentence — claiming a pin was stored on a device that had refused
  // to store it. `choice` also cannot advance past a write that did not land, because it IS the
  // document's own attribute rather than the value that was requested.
  //
  const [state, setState] = useState(readThemeState)

  const choose = (next: ThemeChoice) => {
    pinTheme(next)
    setState(readThemeState())
  }

  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Settings</h1>

      <fieldset className="flex flex-col gap-s8">
        <legend className="text-body3 font-medium">Theme</legend>
        {THEME_OPTIONS.map((option) => (
          <label key={option.id} className="flex items-center gap-s8 text-body3">
            <input
              type="radio"
              name="theme"
              value={option.id}
              checked={state.choice === option.value}
              onChange={() => choose(option.value)}
              className="focus-ring"
            />
            {option.label}
          </label>
        ))}

        {/*
          What is actually true, said in the user's terms. `aria-live` because this text changes
          without the focus moving, and the paragraph is always rendered — describing the current
          state before any click — so choosing an option does not push the rest of the page down.
        */}
        <p className="text-body4 text-neutral2" aria-live="polite">
          <ThemeStatus choice={state.choice} stored={state.stored} />
        </p>
      </fieldset>
    </Surface>
  )
}

/**
 * The honest sentence for each of the three relationships between "painted" and "stored".
 *
 * The durable promise is made in exactly one branch — the one where the two agree — and the other
 * two say what a reload will really do. The failures this closes are both real and both were
 * shipped: private mode, where nothing was stored and the copy claimed it had been; and a failed
 * CLEAR, where the page now follows the system while storage still holds the pin it just dropped,
 * so the reload the copy described would have brought the old theme back.
 *
 * Written as JSX rather than as returned strings on purpose: prose in a string literal is scanned by
 * the token lint as a possible class list, and a sentence containing an ordinary word like "to" is
 * indistinguishable from one.
 */
function ThemeStatus({ choice, stored }: { choice: ThemeChoice; stored: ThemeChoice | 'unreadable' }) {
  if (stored === 'unreadable') {
    return choice === null ? (
      <>Following your system setting. This device will not store a preference, so a reload does the same.</>
    ) : (
      <>
        Applied to this tab. It could not be stored on this device, so a reload will follow your
        system setting again.
      </>
    )
  }

  if (stored === choice) {
    return choice === null ? (
      <>Following your system setting. Changing it there changes this app.</>
    ) : (
      <>Stored on this device. Passbook opens in this theme until you change it here.</>
    )
  }

  return (
    <>
      Applied to this tab. It is not what this device has stored, so a reload will use{' '}
      {stored === null ? <>your system setting</> : <>the {stored} theme</>} instead.
    </>
  )
}
