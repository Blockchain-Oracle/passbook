//
// The asset / note selector (DESIGN §7.2) — a search box, two sections, and one highlight.
//
// ── THE HIGHLIGHT NEVER LEAVES THE INPUT ──────────────────────────────────────────────────
//
// Arrow keys move a highlight; they do not move FOCUS. Focus stays in the search box for the whole
// interaction and the highlighted row is announced through `aria-activedescendant`. That is what
// makes "Enter activates while search keeps focus" work — move focus to the row instead and the
// next keystroke goes to the row rather than the query, so narrowing by typing and choosing by
// arrowing become two modes the user has to switch between deliberately.
//
// ── WHY THE QUERY IS TWO PIECES OF STATE ──────────────────────────────────────────────────
//
// `query` is what the input shows, updated on every keystroke — an input that lags its own
// keystrokes feels broken no matter how fast the list underneath it is. `debounced` is what the
// list filters on, 200ms behind. One state for both means choosing between a stuttering caret and a
// list that rebuilds on every letter.
//
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import {
  SEARCH_DEBOUNCE_MS,
  SECTION_HEADINGS,
  filterSections,
  nextHighlight,
  noResultsSentence,
} from '@strk20/protocol/option-row'
import type { OptionRow as OptionRowModel, OptionSection } from '@strk20/protocol/option-row'

import { OptionRow } from './OptionRow'

export interface OptionListProps {
  sections: readonly OptionSection[]
  onSelect: (row: OptionRowModel) => void
  /** The accessible name of the search box. A search input with no name is announced as "edit". */
  label: string
  placeholder?: string
  /** Called on Escape. Without it there is no keyboard way out of an open list. */
  onDismiss?: () => void
  /**
   * Whether to take focus on mount. Default true, and it is not a nicety: this list's entire
   * keyboard contract is "focus stays in the search box and the arrows move a highlight", so a
   * list that never receives focus has arrow keys that do nothing until someone clicks it.
   *
   * §7.2 asks for no autofocus below `sm` — a phone that autofocuses throws up a keyboard over the
   * list the user came to read. That viewport-conditional version belongs with the rest of the
   * deferred mobile bullet; this prop is the seam it will attach to, and a caller can opt out now.
   */
  autoFocusSearch?: boolean
}

export function OptionList({
  sections,
  onSelect,
  label,
  placeholder,
  onDismiss,
  autoFocusSearch = true,
}: OptionListProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const listId = useId()
  const inputId = useId()
  const highlightedRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const visible = useMemo(() => filterSections(sections, debounced), [sections, debounced])

  //
  // The flat order the arrow keys travel, which is the reading order. A highlight that moved
  // between sections in a different order than the eye does is worse than no highlight at all.
  //
  // KEYED BY SECTION **AND** ROW, because a row id is only unique within its section. The same
  // token legitimately appears in both "In your shielded pool" and "Public balance (will reveal)" —
  // that is the entire point of having two sections — and keying on `row.id` alone gave the two
  // copies the same DOM id, painted both highlighted at once, and left `aria-activedescendant`
  // pointing at whichever the browser found first.
  //
  // The null filter is not defensiveness either: the spec's matrix has a row for it, and the
  // command palette carries the same guard with a comment saying it was written for this list.
  //
  const flat = useMemo(
    () =>
      visible.flatMap((section) =>
        section.rows.filter(Boolean).map((row) => ({ key: `${section.key}:${row.id}`, row })),
      ),
    [visible],
  )

  // A highlight whose row was filtered away is dropped rather than left pointing at nothing — a
  // dangling `aria-activedescendant` is announced as an empty option. The next arrow key then
  // starts from the top, which is what `nextHighlight` does with a null.
  useEffect(() => {
    setHighlighted((current) => (flat.some((entry) => entry.key === current) ? current : null))
  }, [flat])

  // Keeps the highlighted row in view when the arrow keys walk past the fold. `block: 'nearest'`
  // scrolls the minimum distance, so a highlight already on screen does not jerk the list under a
  // reader who is only glancing down it.
  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // `nextHighlight` navigates by `id`, and the id that is unique across this list is the composite
  // key — so it walks a view of the rows wearing those keys rather than their own ids.
  const navigable = useMemo(() => flat.map(({ key, row }) => ({ ...row, id: key })), [flat])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Prevented so the caret does not ALSO jump to the start or end of the query — the default
      // for an arrow key in a text field, and invisible until someone tries to edit mid-word.
      event.preventDefault()
      setHighlighted(nextHighlight(navigable, highlighted, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Enter') {
      const entry = flat.find((candidate) => candidate.key === highlighted)
      if (entry && !entry.row.disabled) {
        event.preventDefault()
        onSelect(entry.row)
      }
      return
    }
    if (event.key === 'Escape' && onDismiss) {
      // A list a keyboard user can open and cannot close is a trap. `Escape` is where every reader
      // reaches first, and without this they have to find the toggle with a pointer.
      event.preventDefault()
      onDismiss()
    }
  }

  // THE DEBOUNCED QUERY, not the live one. `flat` is derived from `debounced`, so naming the live
  // query here means the two disagree for 200ms — clear a no-match query and the sentence reads
  // "Nothing here is called ." with a blank subject until the debounce catches up.
  const nothing = noResultsSentence(debounced)

  return (
    <div className="pb-palette">
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- see `autoFocusSearch`: this list's
        // keyboard contract is unreachable without it. The below-`sm` opt-out is the caller's.
        autoFocus={autoFocusSearch}
        className="focus-ring"
        // Not `type="search"`: the UA clear button it adds duplicates the dismissal this list
        // already has, and it lands exactly where a reader's eye goes for the first result.
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={highlighted ? `${listId}-${highlighted}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <div id={listId} role="listbox" aria-label={label}>
        {visible.map((section) => (
          <div key={section.key} role="group" aria-label={SECTION_HEADINGS[section.key]}>
            {/*
              The visible header is `aria-hidden` and the GROUP carries the accessible name, so the
              sentence is announced once rather than twice. "Public balance (will reveal)" is a
              consequence, not an option — announcing it as a selectable row would be a lie about
              what pressing Enter on it does.
            */}
            <div
              className="option-section-heading"
              data-exposed={section.key === 'public' ? '' : undefined}
              aria-hidden
            >
              {SECTION_HEADINGS[section.key]}
            </div>

            {section.rows.filter(Boolean).map((row) => {
              const key = `${section.key}:${row.id}`
              return (
                <OptionRow
                  key={key}
                  id={`${listId}-${key}`}
                  row={row}
                  highlighted={key === highlighted}
                  elementRef={key === highlighted ? highlightedRef : undefined}
                  onHighlight={() => setHighlighted(key)}
                  onSelect={onSelect}
                />
              )
            })}
          </div>
        ))}

        {/*
          No card, no illustration (§7.2). One left-aligned sentence with the user's own query at
          full contrast inside it — the one thing worth reading is the thing they typed.

          `neutral2`, NOT `neutral3`: the faint grey measures 2.12–2.18:1 and the design authority
          forbids it from carrying meaning alone, which a whole sentence plainly does. The command
          palette's equivalent uses `neutral2` for the same reason.

          Rendered unconditionally as a live region, with only its CONTENTS conditional. A region
          that mounts at the same moment its text appears is missed entirely by several screen
          readers, because there was nothing there to be watching — the same shape, and the same
          reason, as the palette's `Autocomplete.Empty`.
        */}
        <p className="p-s12 text-body3 text-neutral2" role="status">
          {flat.length === 0 && debounced.trim() !== '' ? (
            <>
              {nothing.before}
              <span className="text-neutral1">{nothing.query}</span>
              {nothing.after}
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}
