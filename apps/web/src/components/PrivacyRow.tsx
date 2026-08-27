//
// ONE privacy row, replacing three always-on panels (Wave 4).
//
// ── WHAT THIS REPLACES, AND WHY ───────────────────────────────────────────────────────────
//
// Every review used to stack a disclosure panel, a visibility matrix, a linkability meter and a
// 320px dot-canvas — permanently open, above the confirm button. Abu's verdict on it was "nodes I
// don't even understand", and the diagnosis in that sentence is exact: four privacy widgets shown
// at once, unasked, do not add up to four times the understanding. They add up to noise a reader
// scrolls past to reach the button, which means the honest disclosure gets skipped along with the
// decoration.
//
// So the furniture collapses into one row: a headline sentence that is ALREADY the most important
// thing any of those panels said, and a chevron for everything else.
//
// ── THE COPY SURVIVES BYTE-FOR-BYTE; ONLY THE FURNITURE MOVED ─────────────────────────────
//
// This is the line that matters. Nothing here rewords a claim: the collapsed headline is
// `disclosure.lines[0]`, authored in `disclosure-copy.ts` and reproduced exactly as `Disclosure`
// itself reproduces it. Expanding renders the SAME `Disclosure` and the SAME `LinkabilityMeter`
// that were there before, unmodified. Nothing was deleted from `packages/protocol`, and the copy
// tests that pin those sentences pass unchanged — which is the check that says this was a layout
// change and not a quiet softening of what the app admits to.
//
// ── AND THE SEVERITY STAYS VISIBLE WHILE COLLAPSED ────────────────────────────────────────
//
// A collapsed row that hid a Tier-2 warning until you opened it would be worse than the noise it
// replaced. The row carries the same `data-severity` channel the panel does, from the same
// `getPrivacyColor` call, so the worst thing the expanded detail would say is legible on the
// closed row — and the CTA beside it is already tinted from the same value.
//
// ── DEFAULT-OPEN WHEN IT IS BAD NEWS ──────────────────────────────────────────────────────
//
// At the two severities that mean "this leaks more than you may expect", the row starts expanded.
// A user can still close it; what they cannot do is miss it. Collapsing by default is a decision
// about ATTENTION, not about disclosure, and it only applies where there is nothing alarming to
// pay attention to.
//
import { useId, useState } from 'react'

import { getPrivacyColor } from '@strk20/protocol/privacy'
import { panelSeverity, type Disclosure as DisclosureModel } from '@strk20/protocol/disclosure'
import type { LinkabilityModel } from '@strk20/protocol/linkability'
import {
  FIELD_DOT_MEANING,
  FIELD_DOT_YOURS,
  PRIVACY_ROW_LABEL,
} from '@strk20/protocol/linkability-copy'

import { cn } from '../lib/cn'
import { Disclosure } from './Disclosure'
import { LinkabilityMeter } from './LinkabilityMeter'
import { Text } from './ui/Text'

export interface PrivacyRowProps {
  disclosure: DisclosureModel
  /** Absent on surfaces with no anonymity set to measure — registration, for one. */
  meter?: LinkabilityModel
  /** The disclosure's way out, if the caller can actually perform it. */
  onWayOut?: () => void
}

/** The severities that open the row on arrival. See the header. */
const ALARMING = new Set(['exposed', 'caution'])

export function PrivacyRow({ disclosure, meter, onWayOut }: PrivacyRowProps) {
  const severity = disclosure.authored ? getPrivacyColor(panelSeverity(disclosure)) : 'quiet'
  const [open, setOpen] = useState(() => ALARMING.has(severity))
  const panelId = useId()

  // The headline is the disclosure's own first line — the same string `Disclosure` renders as its
  // headline when expanded. Unauthored contexts say why instead, exactly as the panel does.
  const headline = disclosure.authored ? disclosure.lines[0]?.text : disclosure.because

  return (
    <section
      className="privacy-row rounded-card bg-inset"
      data-severity={severity}
      aria-label={PRIVACY_ROW_LABEL}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="focus-ring flex w-full items-center gap-s12 rounded-card px-s12 py-s12 text-left"
      >
        <ShieldMark />
        <span className="flex min-w-0 flex-1 flex-col gap-s2">
          <Text variant="body4" className="text-neutral2">
            {PRIVACY_ROW_LABEL}
          </Text>
          {/* The claim itself, at rest. Truncated to one line closed — the full sentence is one
              press away and the row must not become the thing it replaced. */}
          <Text variant="body3" className="privacy-row-headline truncate text-neutral1">
            {headline}
          </Text>
        </span>
        <Chevron open={open} />
      </button>

      {/* Unmounted rather than hidden when closed. The dot-scatter is a canvas that measures and
          paints on mount; leaving it mounted-but-hidden would do that work on every review for a
          picture nobody asked to see, which is the cost this collapse exists to remove. */}
      {open ? (
        <div id={panelId} className="flex flex-col gap-s16 px-s12 pb-s12">
          <Disclosure disclosure={disclosure} onWayOut={onWayOut} />
          {meter ? (
            <div className="flex flex-col gap-s8">
              <LinkabilityMeter meter={meter} />
              {/* THE LEGEND THE PICTURE NEVER HAD. Rendered only alongside a drawn field: at the
                  unmeasurable state there is no scatter, and explaining a picture that is not
                  there is worse than saying nothing. */}
              {meter.state === 'unmeasurable' ? null : (
                <div className="flex flex-col gap-s2 px-s4">
                  <Text variant="body4" className="text-neutral2">
                    {FIELD_DOT_MEANING}
                  </Text>
                  <Text variant="body4" className="text-neutral2">
                    {FIELD_DOT_YOURS}
                  </Text>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** A shield, because this row is one thing and the icon should say which. */
function ShieldMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-neutral2"
    >
      <path
        d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 text-neutral3 transition-transform', open && 'rotate-180')}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
