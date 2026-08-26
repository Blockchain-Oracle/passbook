//
// The theme writer — the half of the theme contract that did not exist until this story.
//
// `apps/web/index.html` carries the READER: a blocking inline script that copies a stored pin onto
// `<html data-theme>` before the first paint. Nothing anywhere wrote that value. This file does.
//
// THREE THINGS THAT ARE EASY TO GET BACKWARDS, each measured rather than reasoned about:
//
//   DOM FIRST, STORAGE SECOND. The attribute is what repaints the live page this frame; storage is
//   what survives to the next cold load. Writing storage first and the DOM afterwards produces the
//   same end state on a healthy browser and the WRONG one in Safari's private mode, where the
//   storage write throws and the page is never repainted at all.
//
//   THE ATTRIBUTE GOES ON `documentElement`. The generated sheet selects `:root[data-theme="dark"]`
//   and `:root:not([data-theme="light"])`. The same attribute on `<body>` pins nothing, silently.
//
//   ABSENCE IS A REAL STATE. No attribute means "follow the OS", which is a third choice and not a
//   missing one — `themeChoice()` returns `null` for it and the settings control is three-way. A
//   two-way toggle cannot express follow-system and strands anyone who wants it back.
//
// And `effectiveTheme()` reads the DOM, never storage. In private mode the pin lands on the
// document and does NOT reach storage, so a storage-first read reports the opposite of what the
// user is looking at.
//
export const THEME_STORAGE_KEY = 'passbook-theme'
export const THEME_ATTRIBUTE = 'data-theme'

export type Theme = 'light' | 'dark'

/** `null` is "follow the OS" — a choice, not an absent one. */
export type ThemeChoice = Theme | null

/**
 * What actually happened, as far as the write itself can tell.
 *
 *   `true`       the page repainted AND storage accepted the change
 *   `'dom-only'` the page repainted and STORAGE DID NOT RECEIVE THE CHANGE
 *   `false`      nothing was written at all — there was no document to write to.
 *
 * READ `'dom-only'` PRECISELY: it says storage did not take the change. It does NOT say storage is
 * empty. Clearing a pin while `removeItem` throws returns `'dom-only'` with the OLD pin still
 * stored — so a reload restores the pin the user just cleared, and any copy derived from this value
 * alone would promise the opposite. Whether the current state survives a reload is a question about
 * two places at once, and `storedChoice()` below is the only thing that can answer it.
 */
export type ThemePinResult = true | 'dom-only' | false

/** Just enough of `Storage` to pin a theme, so a test can hand in one that throws. */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ThemeIo {
  /** Defaults to `document.documentElement`. */
  root?: Element | null
  /** Defaults to `window.localStorage`; `null` means "there is none", not "use the default". */
  storage?: ThemeStorage | null
  /** Defaults to `window`. Only `matchMedia` is used. */
  media?: Pick<Window, 'matchMedia'> | null
}

function defaultRoot(): Element | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

/**
 * Reading `window.localStorage` can itself throw — it is not only the item access that does — so
 * even getting hold of the object is inside the try.
 */
function defaultStorage(): ThemeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function defaultMedia(): Pick<Window, 'matchMedia'> | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window
}

function resolve<T>(given: T | undefined | null, fallback: () => T | null): T | null {
  return given === undefined ? fallback() : given
}

/**
 * Pins the theme, or clears the pin. DOM first, storage second.
 *
 * @returns what was actually achieved — see `ThemePinResult`. Never throws.
 */
export function pinTheme(choice: ThemeChoice, io: ThemeIo = {}): ThemePinResult {
  const root = resolve(io.root, defaultRoot)
  if (!root) return false

  try {
    if (choice === null) root.removeAttribute(THEME_ATTRIBUTE)
    else root.setAttribute(THEME_ATTRIBUTE, choice)
  } catch {
    return false
  }

  const storage = resolve(io.storage, defaultStorage)
  if (!storage) return 'dom-only'
  try {
    if (choice === null) storage.removeItem(THEME_STORAGE_KEY)
    else storage.setItem(THEME_STORAGE_KEY, choice)
    return true
  } catch {
    return 'dom-only'
  }
}

/**
 * The current choice, read from the DOM.
 *
 * The attribute IS the pin: `index.html` sets it from storage before first paint and `pinTheme()`
 * sets it afterwards, so the document always carries whatever pin is in force. Reading storage here
 * instead would report a pin that private mode never persisted as though it had.
 */
export function themeChoice(io: ThemeIo = {}): ThemeChoice {
  const root = resolve(io.root, defaultRoot)
  const value = root?.getAttribute(THEME_ATTRIBUTE)
  return value === 'light' || value === 'dark' ? value : null
}

/**
 * What a RELOAD would restore — the pin storage is holding, independent of what is painted now.
 *
 * `null` is "storage holds no pin, so a reload follows the OS". `'unreadable'` is "this browser will
 * not tell us", which is a third answer and not a synonym for either: private mode reads throw, and
 * treating that as "no pin" would state a reload's outcome we do not know.
 *
 * This exists because `pinTheme()`'s return value cannot answer the only question the user actually
 * has — "will this still be true tomorrow?" — for the case where the write failed and storage still
 * holds something ELSE. Comparing this against `themeChoice()` is what makes that answerable.
 */
export function storedChoice(io: ThemeIo = {}): ThemeChoice | 'unreadable' {
  const storage = resolve(io.storage, defaultStorage)
  if (!storage) return 'unreadable'
  let value: string | null
  try {
    value = storage.getItem(THEME_STORAGE_KEY)
  } catch {
    return 'unreadable'
  }
  return value === 'light' || value === 'dark' ? value : null
}

/** What the operating system is asking for. `light` when nothing can be asked. */
export function systemTheme(io: ThemeIo = {}): Theme {
  const media = resolve(io.media, defaultMedia)
  return media?.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** What the page is actually painted as: the pin if there is one, the OS otherwise. */
export function effectiveTheme(io: ThemeIo = {}): Theme {
  return themeChoice(io) ?? systemTheme(io)
}
