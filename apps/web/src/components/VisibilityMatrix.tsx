//
// The visibility matrix (story 6.7, DESIGN §7.5 part 2) — one of the two primitives the design
// brief calls original work with no reference implementation anywhere.
//
// EVERY VALUE IT RENDERS COMES FROM `packages/protocol/src/visibility-matrix.ts`, and so does every
// DECISION about how a value reaches a reader. There is no cell literal in this file and no ternary
// deciding what a cell announces: `cellAnnouncement`, `matrixNotes`, `noteNumber` and `footnoteText`
// are all module functions with tests over them. That is not tidiness — the test runner collects
// this package's siblings and nothing under `apps/web`, so a decision made here is a privacy
// decision no runner executes.
//
// The version of this file that shipped first got that wrong in one place, and it is worth naming:
// the conditional cell's qualifier reached the user through a ternary written here. Collapsing it to
// `CELL_LABEL[cell.state]` is a one-word edit that makes `markets-bet` announce "Conditional" with
// its condition nowhere on screen — the exact false guarantee the discriminated union was built to
// make unspellable — with the whole suite and `build:web` still green.
//
// ── A REAL TABLE, AND `<th scope>` ON BOTH AXES ───────────────────────────────────────────
//
// The meaning of a cell is the intersection of its row and its column. Read as a grid of divs it is
// twenty unrelated words; read as a table with both headers scoped, a screen reader announces
// "Amount, Relayer, Hidden" and the cell says what it means.
//
// ── AND EVERY CELL CARRIES THREE CHANNELS ─────────────────────────────────────────────────
//
// A shape (fill · hollow · half · dash, from the stylesheet), a word (`CELL_LABEL`, visually hidden
// but present for assistive technology), and colour LAST. DESIGN §2.3 measured `settled` and
// `irreversible` collapsing toward each other under red-green colour vision deficiency and ruled
// that the icon-and-word rule is load-bearing and must be enforced in code; twenty cells separated
// by nothing but hue is the densest possible place to break it.
//
import {
  ACTOR_LABELS,
  cellAnnouncement,
  CONTEXT_LABELS,
  FACT_LABELS,
  footnoteText,
  matrixFor,
  matrixNotes,
  noteNumber,
  VISIBILITY_ACTORS,
  VISIBILITY_FACTS,
  type VisibilityCell,
  type VisibilityContext,
} from '@strk20/protocol/visibility-matrix'
import { WHO_CAN_READ } from '@strk20/protocol/disclosure-copy'

export interface VisibilityMatrixProps {
  context: VisibilityContext
  /**
   * Whatever prose the caller has already rendered directly above this table.
   *
   * A footnote that repeats a sentence four lines above it is how a reader learns to stop reading
   * footnotes — and the Markets headline IS the qualifier on its own sender cell, in full, so the
   * panel printed the same twenty-seven words twice. `footnoteText` makes that decision in the
   * module; this prop is the only thing the component contributes to it. Default `''` because the
   * receipt renders the table with nothing above it, and there the note must print in full or the
   * qualifier is nowhere at all.
   */
  statedAbove?: string
}

/**
 * The heading is rendered HERE rather than by each caller, which is the second thing this file got
 * wrong first: the panel labelled the section with a `<p aria-label>` and the receipt with an
 * `<h2 id="who-can-read" aria-labelledby>` — two accessibility trees for one component, plus a
 * hardcoded global DOM id that would collide the moment two panels mounted on one screen. One shape,
 * owned by the thing it names, and no id to collide.
 */
export function VisibilityMatrix({ context, statedAbove = '' }: VisibilityMatrixProps) {
  const matrix = matrixFor(context)

  //
  // AN UNAUTHORED CONTEXT RENDERS ITS REASON, NEVER AN EMPTY GRID. A blank matrix reads as "we
  // checked and there is nothing to see", which is the opposite of what is true: nobody has written
  // this one down. The sentence is the module's, not this file's.
  //
  if (!matrix.authored) {
    return (
      <>
        <h2 className="disclosure-body">{WHO_CAN_READ}</h2>
        <p className="disclosure-body">{matrix.because}</p>
      </>
    )
  }

  const notes = matrixNotes(matrix)

  return (
    <>
      <h2 className="disclosure-body">{WHO_CAN_READ}</h2>

      {/*
        THE TABLE SCROLLS INSIDE ITS OWN BOX. Five columns at 320px, minus the surface's own
        padding, is less room than the header row needs — and a table that overflows its container
        makes the PAGE scroll sideways, which moves every other surface under the reader's thumb.
      */}
      <div className="visibility-scroll">
        <table className="visibility-matrix">
          <caption className="sr-only">{CONTEXT_LABELS[context]} — who can read what</caption>
          <thead>
            <tr>
              {/* The corner cell names nothing, so it is EMPTY rather than labelled "Fact". A
                  header over the row-header column would be announced before every row name. */}
              <td />
              {VISIBILITY_ACTORS.map((actor) => (
                <th key={actor} scope="col">
                  {ACTOR_LABELS[actor]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {VISIBILITY_FACTS.map((fact) => (
              <tr key={fact}>
                <th scope="row">{FACT_LABELS[fact]}</th>
                {VISIBILITY_ACTORS.map((actor) => {
                  const cell = matrix.cells[fact][actor]
                  return (
                    <td key={actor}>
                      <Mark cell={cell} note={noteNumber(notes, cell)} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notes.length === 0 ? null : (
        // `list-style` is reset by the preflight, so the number is rendered rather than generated —
        // it has to match the superscript in the cell, and a marker the browser draws would not.
        <ol className="disclosure-body">
          {notes.map((note, index) => (
            <li key={note}>
              <sup>{index + 1}</sup> {footnoteText(note, statedAbove)}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

/**
 * One cell: a shape, a footnote number when it is qualified, and the word.
 *
 * The dot is `aria-hidden` because it is the sighted channel and the word beside it is the same
 * fact — announcing both would read every cell twice. What the word SAYS is `cellAnnouncement`'s
 * decision, not this component's, and a qualified cell says its qualifier there as well as in the
 * footnote: a listener hears the condition at the cell rather than being sent to the bottom of the
 * table for it.
 */
function Mark({ cell, note }: { cell: VisibilityCell; note: number | null }) {
  return (
    <>
      <span className="visibility-dot" data-state={cell.state} aria-hidden="true" />
      {note === null ? null : <sup aria-hidden="true">{note}</sup>}
      <span className="sr-only">{cellAnnouncement(cell)}</span>
    </>
  )
}
