//
// THE row. Not "a row for the selector" — the one every list in the app renders (DESIGN §7.2).
//
// Tokens, notes, contacts, markets, launches and routes are six different things a user picks from
// a list in exactly the same way. Six bespoke rows would be six subtly different keyboard
// behaviours, six ellipsis bugs and six places to fix each one. The anatomy is
// `image | title (+suffix, +badge) | subtitle | tag | right`, and a list that does not need a slot
// leaves it out rather than inventing a layout for it.
//
// ── WHY THIS IS TWO EXPORTS AND NOT ONE ───────────────────────────────────────────────────
//
// The command palette's rows are `Autocomplete.Item`s: the component library owns that element, sets
// `data-highlighted` on it and needs its own props on it. Our own selector owns its outer element.
// So the OUTER box is the caller's and the ANATOMY is shared — `OptionRowBody` is the part that must
// never be written twice, and `OptionRow` is the convenience wrapper for callers who have no library
// element to supply. Both render the same body, which is what makes "one row implementation" a fact
// about the code rather than a rule someone has to remember.
//
// ── WHY EVERY ELEMENT HERE IS A `div` ─────────────────────────────────────────────────────
//
// A listbox with sections wants `listbox > group > option`. Expressed as `ul > li > ul > li` the
// HTML is valid but the implicit list semantics fight the explicit roles, and the honest fix — a
// `div` for the group — is then an invalid child of `ul`. Neutral elements carrying explicit roles
// say exactly one thing about the structure instead of two things that have to agree.
//
import type { ReactNode, Ref } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'

import type { OptionRow as OptionRowModel } from '@strk20/protocol/option-row'
import type { Confidence } from '@strk20/protocol/amount'

/**
 * How sure we are, as ink.
 *
 * `unknown` gets BOTH the faint colour and the dotted underline, never the colour alone: `neutral3`
 * measures 2.12–2.18:1 on light surfaces and the design authority forbids it from being the sole
 * carrier of "not yet real" for exactly that reason.
 */
export function confidenceClass(confidence: Confidence): string {
  return confidence === 'unknown' ? 'text-neutral3 not-yet-real' : 'text-neutral2'
}

/**
 * The shared anatomy. Everything inside the row's own box.
 *
 * ── WHY `rightSlot` IS A PROP AND NOT A FIELD ON THE MODEL ────────────────────────────────
 *
 * `OptionRow.right` is a `Valued<string>` — a formatted value carrying its confidence. The
 * activity row's right edge is not a value, it is a STATE: a block, a spinner, a still ring, a
 * failure, or "not indexed yet". Widening the model to hold either would put a React node in a
 * data type whose own header (`option-row.ts:36`) explains why it must never hold one — the search
 * would have to reach into rendered children, and no test could assert against it.
 *
 * So the model stays data and the slot stays markup, and the ANATOMY is shared, which is the part
 * that must never be written twice. The design authority agrees the two rows are one:
 * `tokens.yaml`'s `components.activityRow` is `{ radius: 16, py: 8, gap: 12, icon: 40 }` and
 * `.option-row-inner` already ships all four.
 */
export function OptionRowBody({
  row,
  rightSlot,
  titleTo,
}: {
  row: OptionRowModel
  rightSlot?: ReactNode
  /**
   * Makes the TITLE a link, rather than the caller wrapping the whole row in one.
   *
   * The activity feed's rows navigate to a receipt AND carry an explorer link or a Retry button in
   * their right slot. Interactive content may not nest inside an anchor — the parser hoists an
   * inner `<a>` out on any hydrated path and the tab order stops matching what is on screen — so
   * the link goes on the one part of the row that is unambiguously the thing being named.
   */
  titleTo?: Pick<LinkProps, 'to' | 'params'>
}) {
  return (
    <div className="option-row-inner">
      {/*
        No fallback glyph when there is no image. A generated monogram or a coloured circle is a
        picture of a token this app has never seen, and the empty slot is the honest version — the
        row simply starts at its title.
      */}
      {row.image ? <img className="option-row-image" src={row.image} alt="" /> : null}

      <div className="option-row-main">
        <div className="option-row-title">
          {titleTo ? (
            <Link {...titleTo} className="option-row-title-text option-row-title-link focus-ring">
              {row.title}
            </Link>
          ) : (
            <span className="option-row-title-text">{row.title}</span>
          )}
          {row.titleSuffix ? (
            <span className="option-row-title-text text-neutral2">{row.titleSuffix}</span>
          ) : null}
          {row.badge ? (
            // `not-yet-real` beside the status, never instead of it. A `pending-proof` or
            // `maturing` chip is grey — and grey is the one ink the design authority forbids from
            // carrying meaning by itself, because `neutral3` measures 2.12–2.18:1 on light
            // surfaces. The dotted underline is the channel that survives greyscale and CVD, so
            // without it those two states are indistinguishable from a settled one.
            <span
              className={`chip${row.badge.notYetReal ? ' not-yet-real' : ''}`}
              data-status={row.badge.status}
            >
              {row.badge.label}
            </span>
          ) : null}
        </div>

        {row.subtitle ? (
          // A hash or an address goes in the mono face — under proportional digits two different
          // addresses settle into the same shape and stop being distinguishable at a glance.
          <div className={`option-row-subtitle truncate${row.subtitleIsMono ? ' font-mono' : ''}`}>
            {row.subtitle}
          </div>
        ) : null}
      </div>

      {row.tag ? <span className="text-body4 text-neutral2">{row.tag}</span> : null}

      {/*
        ONE RIGHT-HAND ELEMENT, EVER. `row.right` is a formatted value carrying its confidence and
        `rightSlot` is a state; a row has one or the other and never both, so the slot wins when it
        is supplied rather than the two rendering side by side. Written as an either/or rather than
        two independent conditionals because the silent version of this bug is two right-hand
        elements crowding each other, which reads as a layout fault rather than a caller mistake.
      */}
      {rightSlot ??
        (row.right ? (
          <span className={`option-row-right ${confidenceClass(row.right.confidence)}`}>
            {row.right.value}
          </span>
        ) : null)}
    </div>
  )
}

export interface OptionRowProps {
  row: OptionRowModel
  /** Required when a listbox points `aria-activedescendant` at this row. */
  id?: string
  /** The ONE highlight — set by the pointer and by the arrow keys alike. */
  highlighted?: boolean
  onSelect?: (row: OptionRowModel) => void
  onHighlight?: (row: OptionRowModel) => void
  elementRef?: Ref<HTMLDivElement>
}

/**
 * A row that owns its own box, for lists with no library element of their own.
 *
 * `data-highlighted` is written as a BOOLEAN attribute — present or absent — to match the component
 * library's own spelling, so one CSS rule covers rows from both sources. `data-highlighted="false"`
 * would be *present*, and the same selector would then paint every row in the list.
 */
export function OptionRow({ row, id, highlighted, onSelect, onHighlight, elementRef }: OptionRowProps) {
  return (
    <div
      id={id}
      ref={elementRef}
      className="option-row"
      role="option"
      aria-selected={Boolean(highlighted)}
      aria-disabled={row.disabled ? true : undefined}
      data-highlighted={highlighted ? '' : undefined}
      data-disabled={row.disabled ? '' : undefined}
      // Pointer and keyboard write the SAME state. Hovering does not select — it highlights, which
      // is what Enter then acts on, so the two input methods cannot disagree about where the user
      // is. `pointermove` rather than `mouseenter`: a list that scrolls under a still cursor should
      // not silently re-aim the highlight at whatever slid beneath it.
      onPointerMove={() => {
        if (!row.disabled) onHighlight?.(row)
      }}
      onClick={() => {
        if (!row.disabled) onSelect?.(row)
      }}
    >
      <OptionRowBody row={row} />
    </div>
  )
}
