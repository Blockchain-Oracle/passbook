//
// The disclosure panel (story 6.7, DESIGN §7.5) — "required on every Review; a surface renders one
// or explicitly asserts none".
//
// Three parts, in the design authority's order: what leaks, who can read it, and a way out.
//
// ── ONE COLOUR, PICKED ONCE ───────────────────────────────────────────────────────────────
//
// `getPrivacyColor(panelSeverity(panel))` runs here and nowhere else on this surface. §7.5: panel
// severity is the max of its lines "so two shades of 'bad' never coexist", and the same value goes
// on the CTA through `ctaSeverity` — the headline and the thumb carry ONE colour or the screen is
// telling the reader two different things about the same action.
//
// ── THE WAY OUT IS RENDERED ONLY IF IT CAN ACTUALLY BE TAKEN ──────────────────────────────
//
// The model carries a LABEL; the caller carries the action. A button wired to a no-op is a stated
// recovery that does nothing, which is the overclaim story 6.10 exists to catch — so where the
// action does not exist yet, the button is not rendered at all rather than rendered inert.
//
// ── AND THE PANEL HOLDS STILL ─────────────────────────────────────────────────────────────
//
// EXPERIENCE §4.3: it "appears at {motion.quick} opacity and then holds still — disclosure never
// animates on polls, never pulses". Nothing here schedules anything; the stylesheet declares one
// opacity transition and no animation, and `disclosureProblems` in the build gate reads the emitted
// rule to prove it.
//
import { getPrivacyColor } from '@strk20/protocol/privacy'
import { panelSeverity, type Disclosure as DisclosureModel, type DisclosureLine } from '@strk20/protocol/disclosure'
import { CONTEXT_LABELS } from '@strk20/protocol/visibility-matrix'

import { VisibilityMatrix } from './VisibilityMatrix'

export interface DisclosureProps {
  disclosure: DisclosureModel
  /**
   * What the way out actually does. ABSENT MEANS NO BUTTON — see the header. The label is the
   * model's; this is the only thing that can make it real.
   */
  onWayOut?: () => void
}

export function Disclosure({ disclosure, onWayOut }: DisclosureProps) {
  //
  // A CONTEXT NOBODY WROTE RENDERS ITS REASON. `quiet` rather than `neutral`: there is no claim
  // here to colour, and grey is what a fact renders in when the most severe state renders calmest.
  //
  if (!disclosure.authored) {
    return (
      <section className="disclosure-panel" data-severity="quiet" aria-label={CONTEXT_LABELS[disclosure.context]}>
        <p className="disclosure-body">{disclosure.because}</p>
      </section>
    )
  }

  const severity = getPrivacyColor(panelSeverity(disclosure))
  const [headline, ...rest] = disclosure.lines

  return (
    <section
      className="disclosure-panel"
      data-severity={severity}
      aria-label={CONTEXT_LABELS[disclosure.context]}
    >
      {/* The first line is the headline BY POSITION, and it is the one that inherits the panel's
          semantic colour. Every other line takes `.disclosure-body`, which forces neutral2 body3 —
          §7.5's "coloured claim, neutral explanation".

          KEYED ON THE INDEX, not on the text. Two lines that happen to share a sentence — the same
          escrow paragraph on two contexts, a copy edit that briefly duplicates one — would collide
          on a text key and React would drop one of them silently. The list is fixed and ordered, so
          the index IS the identity here. */}
      {headline ? <Line line={headline} /> : null}
      {rest.map((line, index) => (
        <Line key={index} line={line} muted />
      ))}

      {/*
        THE PANEL'S OWN LINES ARE HANDED DOWN so the matrix's footnotes can stop repeating them.
        A Markets headline IS FR-009 in full, and FR-009's second clause is the qualifier on that
        matrix's sender cell — printed twice, four lines apart, on the same screen. The dedupe
        decision itself is `footnoteText`'s, in the module where it can be tested.
      */}
      <VisibilityMatrix
        context={disclosure.context}
        statedAbove={disclosure.lines.map((line) => line.text).join(' ')}
      />

      {disclosure.wayOut && onWayOut ? (
        <button type="button" className="disclosure-way-out focus-ring" onClick={onWayOut}>
          {disclosure.wayOut.label}
        </button>
      ) : null}
    </section>
  )
}

/**
 * One stated consequence, with its marker.
 *
 * ↗ and ✓ are `aria-hidden` and the word travels in `.sr-only` text instead: an arrow glyph is
 * announced as "north east arrow", which tells a listener the shape of the character rather than
 * what it means about their money.
 */
function Line({ line, muted }: { line: DisclosureLine; muted?: boolean }) {
  const leaves = line.marker === 'leaves'
  return (
    <p className="disclosure-line">
      <span className="disclosure-marker" data-marker={line.marker} aria-hidden="true">
        {leaves ? '↗' : '✓'}
      </span>
      <span className="sr-only">{leaves ? 'Leaves the private domain:' : 'Stays private:'}</span>
      <span className={muted ? 'disclosure-body' : undefined}>{line.text}</span>
    </p>
  )
}
