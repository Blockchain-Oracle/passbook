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
