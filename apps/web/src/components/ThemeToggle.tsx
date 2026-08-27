//
// The chrome's one-click theme control.
//
// This TOGGLE pins; it never clears. Pinning is the only thing a two-state click can express
// honestly — "follow the OS" is a third choice (`theme.ts`'s own contract), and it stays reachable
// on /settings, which this button deliberately does not replace. The icon shows the theme a click
// would MOVE TO, and the label says so in words, because an icon-only control that shows current
// state reads as a status light, and half of every audience guesses the convention wrong.
//
import { useState } from 'react'

import { effectiveTheme, pinTheme, type Theme } from '../shell/theme'

export function ThemeToggle() {
  // Seeded from the DOM, which `index.html` painted before React existed — never from storage.
  const [theme, setTheme] = useState<Theme>(() => effectiveTheme())

  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => {
        pinTheme(next)
        setTheme(next)
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="nav-item focus-ring cursor-pointer"
    >
      {next === 'dark' ? (
        // Moon — a click takes you to dark.
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // Sun — a click takes you to light.
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}
