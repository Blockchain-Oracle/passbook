//
// One row anatomy, for every list in the app (story 6.4, DESIGN §7.2).
//
// Tokens, notes, contacts, markets, launches and routes are six different things that a user picks
// from a list in exactly the same way, and the app that gives each of them its own row ends up with
// six subtly different keyboard behaviours and six places to fix a bug. `image | title (+suffix,
// +badge) | subtitle | tag | right` covers all six, and the ones that do not need a slot leave it
// empty rather than inventing a layout.
//
// ── HOVER AND KEYBOARD ARE ONE STATE, AND THAT STARTS HERE ────────────────────────────────
//
// `nextHighlight` moves the SAME highlight the pointer sets. Two variables — one for hover, one for
// arrow-focus — is the shape that produces two highlighted rows at once the first time a user
// touches the mouse mid-keyboard, and there is no correct way to render that.
//
// ── WHY THE SEARCH DELAY IS EXPORTED ──────────────────────────────────────────────────────
//
// One constant, one import. Debounces retyped per call site drift into 150 here and 250 there, and
// the difference is invisible in review and obvious in use — the same list feels sluggish on one
// surface and twitchy on another with nothing in the diff to explain it.
//

import type { Valued } from './amount.js'
import type { ChipStatus } from './note-lifecycle.js'

/** The one search debounce. §7.2: 200ms, from one shared constant. */
export const SEARCH_DEBOUNCE_MS = 200

/**
 * One row, as plain data.
 *
 * NOTHING HERE IS A REACT NODE, on purpose. A row model that can hold arbitrary markup is a row
 * model that can be filtered wrongly (the search would have to reach into rendered children) and
 * that no test can assert against. `image` is a source, not an element; `right` is a value with its
 * confidence, not a formatted string with a colour baked in.
 */
export interface OptionRow {
  readonly id: string
  /** A real asset source. Absent means the slot collapses — never a generated placeholder glyph. */
  readonly image?: string
  readonly title: string
  /** Trails the title at the same size — a token's name beside its symbol, say. */
  readonly titleSuffix?: string
  /**
   * The badge slot. A note's lifecycle chip lives here, and it carries its status AND its
   * `notYetReal` flag with it — a bare label would leave the caller to pick a tint, which is the
   * drift `note-lifecycle.ts` keeps in one table precisely to avoid.
   *
   * `notYetReal` is here because it was once missing, and its absence was invisible: a caller
   * building a note row could only write `{ label, status }`, so the ratified "not yet real is
   * carried by structure, never by grey alone" encoding was dropped on the floor for the two
   * states that need it, and a `pending-proof` chip rendered identically to a settled one. The
   * shape of `LifecycleChip` and the shape of this slot have to match or the rule is unenforceable.
   */
  readonly badge?: { readonly label: string; readonly status: ChipStatus; readonly notYetReal?: boolean }
  readonly subtitle?: string
  /** True when the subtitle is a hash or an address and must render in the mono face. */
  readonly subtitleIsMono?: boolean
  readonly tag?: string
  /** The right-hand value, carrying its own confidence (§7.1's `{value, color}` object). */
  readonly right?: Valued<string>
  /** Rendered at 0.5 opacity, skipped by keyboard navigation, still readable. */
  readonly disabled?: boolean
}

/**
 * The two sections, verbatim.
 *
 * "Public balance (will reveal)" is disclosure-as-furniture: the consequence is stated in the
 * section header a user reads on the way past, rather than in a warning that fires after they have
 * chosen. The public header also carries the `exposed` tint — and, per the measured rule that a
 * bare tint reads as elevation rather than status, a 1px status border with it.
 */
export const SECTION_HEADINGS = {
  shielded: 'In your shielded pool',
  public: 'Public balance (will reveal)',
} as const

export type OptionSectionKey = keyof typeof SECTION_HEADINGS

export interface OptionSection {
  readonly key: OptionSectionKey
  readonly rows: readonly OptionRow[]
}

/**
 * Turns a lifecycle chip into a badge, carrying every channel it encodes.
 *
 * A one-line adapter, and it exists so that the mapping is written ONCE. Spelled out at each call
 * site, `{ label: chip.label, status: chip.status }` is what a reader naturally writes — and it
 * silently loses `notYetReal`, which is the channel that survives greyscale and colour blindness.
 */
export function badgeFromChip(chip: {
  label: string
  status: ChipStatus
  notYetReal: boolean
}): NonNullable<OptionRow['badge']> {
  return { label: chip.label, status: chip.status, notYetReal: chip.notYetReal }
}

/** The fields a query is matched against. `right` is excluded: nobody searches a list by balance. */
function haystack(row: OptionRow): string {
  return [row.title, row.titleSuffix, row.subtitle, row.tag, row.badge?.label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Filters rows by a query.
 *
 * An empty or whitespace-only query returns everything — §7.2's "empty query renders suggested
 * content". Returning nothing there is the shape that makes a list look broken before the user has
 * done anything at all.
 */
export function filterRows(rows: readonly OptionRow[], query: string): OptionRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter((row) => haystack(row).includes(needle))
}

/** Filters every section, keeping the ones that still have rows. */
export function filterSections(sections: readonly OptionSection[], query: string): OptionSection[] {
  return sections
    .map((section) => ({ key: section.key, rows: filterRows(section.rows, query) }))
    .filter((section) => section.rows.length > 0)
}

/**
 * The no-results sentence, in parts.
 *
 * Parts rather than a string because §7.2 puts the user's own query at `neutral1` inside a
 * `neutral3` sentence — the one thing they typed is the one thing worth reading. Returning
 * `"Nothing here matches zzz."` would force the component to find the query inside the sentence
 * again, which breaks the moment a query happens to contain the surrounding words.
 */
export function noResultsSentence(query: string): { before: string; query: string; after: string } {
  return { before: 'Nothing here is called ', query: query.trim(), after: '.' }
}

/**
 * The next row an arrow key should highlight — the same highlight the pointer sets.
 *
 * Wraps at both ends and skips disabled rows. The bounded loop is not defensiveness: a list where
 * EVERY row is disabled is a real state (a token list with no spendable notes), and a `while` that
 * searches for the next enabled row would not terminate on it.
 */
export function nextHighlight(
  rows: readonly OptionRow[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (rows.length === 0) return null

  const current = rows.findIndex((row) => row.id === currentId)
  // A highlight that has fallen off the list (its row was filtered away) restarts from the end the
  // key is travelling FROM, so the first Down after a filter lands on the first row.
  const start = current === -1 ? (delta === 1 ? -1 : 0) : current

  for (let step = 1; step <= rows.length; step += 1) {
    const index = (((start + delta * step) % rows.length) + rows.length) % rows.length
    const row = rows[index]
    if (row && !row.disabled) return row.id
  }
  return null
}
