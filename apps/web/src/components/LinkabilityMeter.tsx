//
// The linkability meter (story 6.7b, DESIGN §7.6, EXPERIENCE §4.4).
//
// THREE PARTS, IN ORDER: a count, a sentence, and a picture. Anything more is a privacy claim
// FR-051 bans — there is no score here, no gauge, and no scale anybody invented.
//
// ── IT OWNS NO BUTTON ─────────────────────────────────────────────────────────────────────
//
// Severity leaves as a value on `LinkabilityModel` and the SURFACE applies it to the CTA it
// already has. A meter rendering its own primary action would put a second CTA on a review screen,
// and the never-disable rule lives on `BlockedButton`, which is where the thumb is.
//
// ── THE ALTERNATIVES ARE WORDS UNTIL SOMEONE CAN FULFIL THEM ──────────────────────────────
//
// `Disclosure.tsx:88`'s rule, copied exactly: a control renders only when the caller supplies the
// action behind it. `Split the amount`'s mechanics are an explicit GAP (EXPERIENCE:800) — tranche
// sizes and spacing in time, with timing correlation as the NAMED attack — so it ships as a label.
// Wiring either to a no-op is the overclaim 6.10 exists to catch.
//
// ── THE UNMEASURABLE STATE IS NOT A WARNING ───────────────────────────────────────────────
//
// No count, no verdict, no amber. A warning with no measurement behind it is exactly the invented
// claim FR-051 bans, and it is the tempting mistake: a failed read FEELS like bad news. It is not
// news at all.
//
import { getPrivacyColor } from '@strk20/protocol/privacy'
import type { LinkabilityModel } from '@strk20/protocol/linkability'
import {
  SPLIT_THE_AMOUNT,
  UNMEASURABLE_CONSEQUENCE,
  WAIT_FOR_DEPOSITS,
  caretDelta,
} from '@strk20/protocol/linkability-copy'

import { NoteField } from './NoteField'
import { Odometer } from './Odometer'

export interface LinkabilityMeterProps {
  meter: LinkabilityModel
  /** Rendered only when supplied — the never-a-no-op rule, by signature. */
  onWaitForDeposits?: () => void
  onSplitAmount?: () => void
  /**
   * `row` collapses the meter to a single detail line, for a form that is not yet an action.
   *
   * ── WHY THIS EXISTS, AND IT IS A LAYOUT FACT RATHER THAN A PREFERENCE ────────────────────
   *
   * The full meter is a count, a sentence AND a 320px picture. On an idle swap form that is more
   * vertical space than the form itself, and the picture ends up rendered twice on one screen when
   * the waiting steps below it draw the same field — which is what it looked like.
   *
   * The picture earns its space at the moment of ACTION (the review step) and during the WAIT,
   * which is exactly where `C08:229` puts it. On the form it is a line: the count, the verdict, and
   * nothing else.
   */
  variant?: 'full' | 'row'
}

export function LinkabilityMeter({
  meter,
  onWaitForDeposits,
  onSplitAmount,
  variant = 'full',
}: LinkabilityMeterProps) {
  if (meter.state === 'unmeasurable') {
    // The row form says the one thing that matters — we could not measure — and does not spend
    // three lines saying it on a form where nothing is being decided yet.
    if (variant === 'row') {
      return (
        <div className="flex items-baseline justify-between gap-s12 px-s4">
          <span className="text-body4 text-neutral2">Anonymity set</span>
          <span className="text-body4 text-neutral2">{meter.because}</span>
        </div>
      )
    }
    return (
      <section className="linkability-meter" aria-label="Anonymity set">
        <p className="meter-sentence text-body3">{meter.because}</p>
        <p className="meter-provenance text-body4 text-neutral2">{UNMEASURABLE_CONSEQUENCE}</p>
      </section>
    )
  }

  if (variant === 'row') {
    return (
      <div
        className="flex items-baseline justify-between gap-s12 px-s4"
        // Same channel as the panel, so a Tier 1 reading tints this line the way it tints the CTA.
        data-severity={meter.severity === null ? undefined : getPrivacyColor(meter.severity)}
      >
        <span className="text-body4 text-neutral2">Anonymity set</span>
        <span className="meter-row-value numeric text-body4">
          {/* The COUNT and the denominator, which is the meter's whole grammar in one line. The
              odometer is deliberately absent here: it is rationed to two numbers in the app and
              spending a roll on a line nobody is watching wastes the one place it means something. */}
          {`${meter.candidates} possible sources`}
        </span>
      </div>
    )
  }

  // Each label maps to exactly ONE caller-supplied action, and an unrecognised label maps to none.
  // Written as a lookup rather than a `??` chain because a fallback here would silently wire the
  // wrong handler to a label — a button that says "Split the amount" and waits for deposits.
  const actionFor = (label: string): (() => void) | undefined => {
    if (label === WAIT_FOR_DEPOSITS) return onWaitForDeposits
    if (label === SPLIT_THE_AMOUNT) return onSplitAmount
    return undefined
  }

  return (
    <section
      className="linkability-meter"
      aria-label="Anonymity set"
      // Absent at a null tier, because no verdict means no colour to spend. `getPrivacyColor` is
      // the one mapping; a second one here would be the drift 6-7a's whole story was about.
      data-severity={meter.severity === null ? undefined : getPrivacyColor(meter.severity)}
    >
      <p className="meter-count">
        <Odometer value={meter.candidates} label="Possible sources" />
        {meter.caretDelta === null ? null : (
          // The sentence comes from the copy module, not from a template literal here. A component
          // that spells its own authored copy is a component that can quietly reword it.
          <span className="meter-caret text-body4">{caretDelta(meter.caretDelta)}</span>
        )}
      </p>

      <p className="meter-sentence text-body3">{meter.headline}</p>

      {meter.lines.map((line) => (
        // Keyed on the sentence: these are authored strings, and two identical ones would be a
        // duplicate on screen rather than a key collision worth papering over.
        <p className="meter-line text-body4" key={line}>
          {line}
        </p>
      ))}

      <NoteField field={meter.field} label={`${meter.candidates} possible sources, including yours`} />

      <p className="meter-provenance text-body4 text-neutral2">{meter.provenance}</p>

      {meter.alternatives.length > 0 ? (
        <ul className="meter-alternatives">
          {meter.alternatives.map((label) => {
            const handler = actionFor(label)
            return (
              <li key={label}>
                {handler ? (
                  <button type="button" className="meter-alternative focus-ring" onClick={handler}>
                    {label}
                  </button>
                ) : (
                  // A NAMED ALTERNATIVE WITH NOBODY BEHIND IT IS A SENTENCE, NOT A CONTROL. It
                  // still tells the user what would help; it does not offer a press that does
                  // nothing.
                  <span className="meter-alternative-stated text-body4">{label}</span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
