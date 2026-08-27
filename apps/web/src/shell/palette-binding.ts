//
// The `/` shortcut, which is two hand-authored behaviours neither palette library provides.
//
// KEYUP, NEVER KEYDOWN. On keydown the palette opens and focuses its input DURING the same key
// event, so the browser then delivers the character to the field that now has focus and the palette
// opens with "/" already typed into it. Reproduced on one candidate library outright; on the other
// it happens not to fire, which is a timing race rather than a guarantee. Binding on keyup means
// the character has nowhere to land by construction. If this is ever put under test, the assertion
// is that the input is EMPTY, not that the palette opened — those are different facts, and only the
// first one notices the leak.
//
// NEVER INSIDE A TEXT FIELD. Neither library guards this either, and the control that removes the
// guard opens the palette from inside a real input on both. The guard has to cover
// `isContentEditable` and not just tag names: the chat composer is a contenteditable, so a
// tagName-only check passes two of the three surfaces this app has and silently swallows a
// slash in the third.
//

/** The one key that opens the palette. Named so the binding and its tests cannot disagree. */
export const PALETTE_KEY = '/'

/**
 * Whether a key event landing here is someone typing rather than someone reaching for a shortcut.
 *
 * `INPUT` is deliberately not narrowed by `type`: a `/` typed into a search box, a URL box or a
 * number box is still a `/` the user meant to see.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (/^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true
  return target instanceof HTMLElement && target.isContentEditable
}

/**
 * Binds the shortcut for as long as the returned function is not called.
 *
 * @param open called when the shortcut fires. Nothing else in here knows what a palette is.
 * @returns the unbinder, for an effect's cleanup.
 */
export function bindPaletteShortcut(open: () => void): () => void {
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== PALETTE_KEY) return
    // A modified slash is a browser or OS shortcut, not ours. Checked before the typing guard so
    // the reason a chord is ignored is the chord, not where the caret was.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.defaultPrevented) return
    if (isTypingTarget(event.target)) return
    open()
  }

  window.addEventListener('keyup', onKeyUp)
  return () => window.removeEventListener('keyup', onKeyUp)
}

//
// ── ⌘K / Ctrl+K, AND WHY IT IS BOUND ON keydown WHERE `/` IS BOUND ON keyup ───────────────
//
// The rule above is about a CHARACTER leaking into the input the palette just focused. `/` produces
// one; `⌘K` produces none — it is a chord the browser reports and no field would ever receive as
// text. So the reason for keyup does not apply, and the reason AGAINST it does: Chrome and Firefox
// both bind ⌘K/Ctrl+K to their own address-bar search, and only `preventDefault` on keydown takes
// it. On keyup the browser has already acted.
//
// It is therefore also the one binding here that fires INSIDE a text field. Someone typing in the
// swap amount who reaches for ⌘K means the palette — there is no character to swallow and no
// competing interpretation, which is exactly why every app with a palette binds it this way.
//
export const PALETTE_CHORD_KEY = 'k'

/** Binds ⌘K on macOS and Ctrl+K elsewhere. Returns the unbinder. */
export function bindPaletteChord(open: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== PALETTE_CHORD_KEY) return
    // EITHER modifier, never both required: matching only `metaKey` would leave every Linux and
    // Windows user without the shortcut, and matching only `ctrlKey` would collide with macOS
    // conventions. `altKey` is excluded because ⌥⌘K and ⌃⌥K are different chords that belong to
    // whatever else claimed them.
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    if (event.defaultPrevented) return
    // Taken from the browser deliberately — see the note above. This is the only place in this
    // module that calls it, because it is the only binding with something to take.
    event.preventDefault()
    open()
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}

//
// ── `?` FOR THE SHORTCUTS OVERLAY ─────────────────────────────────────────────────────────
//
// Shift+/ on most layouts, which makes it a CHARACTER — so it inherits `/`'s keyup rule exactly,
// for exactly the same reason. Anyone who binds this on keydown ships an overlay that opens with a
// stray `?` in whatever it focused.
//
// Read off `event.key` rather than reconstructed from `Shift` + `Slash`: on a German or French
// layout `?` is a different physical key, and a shift-plus-slash check would leave those users
// without the shortcut while silently firing on something else.
//
export const SHORTCUTS_KEY = '?'

export function bindShortcutsOverlay(open: () => void): () => void {
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== SHORTCUTS_KEY) return
    // Shift is the character's own modifier and must NOT disqualify it; the others are chords.
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.defaultPrevented) return
    if (isTypingTarget(event.target)) return
    open()
  }

  window.addEventListener('keyup', onKeyUp)
  return () => window.removeEventListener('keyup', onKeyUp)
}
