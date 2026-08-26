//
// The one progress machine (DESIGN §7.7 / EXPERIENCE §4.2).
//
// ── THIS COMPONENT KNOWS NOTHING ABOUT WHICH PIPELINE IT IS DRAWING ───────────────────────
//
// It takes rows. A registration passes four and a send passes five, and there is no
// `if (isRegistration)` anywhere below — which is what makes "registration omits Mature" a
// property of the DATA rather than a branch somebody has to remember to add to the next surface.
//
// ── FIVE REDUNDANT CHANNELS, AND WHY THAT IS NOT BELT-AND-BRACES ──────────────────────────
//
// Colour is unavailable to a meaningful share of readers, motion is unavailable to anyone who
// asked their OS to stop it, and both are unavailable in a screenshot. The five channels are icon
// treatment, slot size, title weight, right-hand content and the connector — so state survives
// losing any two of them. `data-status` carries the sixth, machine-readable channel.
//
import {
  blockCountdown,
  elapsedLabel,
  isCurrent,
  type ProgressStep,
} from '@strk20/protocol/progress'

/** How far a maturing note has come. Blocks are counted; there is no time estimate to give. */
export interface Maturation {
  confirmed: number
  required: number
}

export interface ProgressMachineProps {
  steps: readonly ProgressStep[]
  /**
   * How long the PROVE stage has been running — not the pipeline.
   *
   * The ladder's twenty-second and ten-minute rungs are statements about the hosted prover, so
   * feeding them total pipeline time would escalate the copy on the strength of time spent
   * elsewhere. Drives the label and nothing else: the ring's rate never changes, because a spinner
   * that speeds up is claiming something it cannot know.
   */
  elapsedMs?: number
  /** Present once a note is maturing. Absent means the row shows its position instead. */
  maturation?: Maturation
  /** Accessible name for the list. Surfaces say what is progressing. */
  label: string
  /**
   * The picture the wait is spent watching, mounted ABOVE the list (C08:229, DESIGN:423).
   *
   * A `ReactNode` rather than a data prop, on `OptionRow.tsx:46-57`'s `rightSlot` precedent: the
   * no-React-nodes rule binds the MODEL in `packages/protocol`, not the component, and the field
   * carries its own model already. Optional because most waits have no crowd to draw — a
   * registration is not hiding in anything.
   *
   * IT COMPOSES BESIDE THE LIST, NEVER INSIDE IT. §7.7's five redundant channels and constant 40px
   * rows are shipped and gated, and a graphic inside a `<li>` would be the sixth thing competing
   * for a row whose whole promise is that it does not move.
   */
  field?: React.ReactNode
}

export function ProgressMachine({
  steps,
  elapsedMs = 0,
  maturation,
  label,
  field,
}: ProgressMachineProps) {
  //
  // A FRAGMENT, NOT A WRAPPER `<div>`. The `<ol>` has always been this component's root, and every
  // caller mounts it as a direct child of `Surface`'s `flex flex-col gap-s8` column. A wrapper
  // would create a nested layout context and swallow that gap; a fragment leaves both children in
  // the parent's column, spaced by the same rule as everything else on the surface.
  //
  const list = (
    <ol className="step-list" aria-label={label}>
      {steps.map((step, index) => (
        <StepRow
          key={step.key}
          step={step}
          elapsedMs={elapsedMs}
          maturation={maturation}
          last={index === steps.length - 1}
        />
      ))}
    </ol>
  )

  if (!field) return list

  return (
    <>
      {field}
      {list}
    </>
  )
}

function StepRow({
  step,
  elapsedMs,
  maturation,
  last,
}: {
  step: ProgressStep
  elapsedMs: number
  maturation: Maturation | undefined
  last: boolean
}) {
  const current = isCurrent(step.status)

  return (
    <li>
      <div
        className="step-row"
        data-status={step.status}
        // A presence attribute, not `data-current="false"` — the stylesheet's other presence
        // selectors (`.option-row[data-highlighted]`) are written the same way, and a literal
        // "false" string would match every one of them.
        {...(current ? { 'data-current': '' } : {})}
      >
        <div className="step-slot">
          {step.status === 'in-progress' ? (
            <span className="step-ring" />
          ) : (
            <span className="step-icon" />
          )}
        </div>

        <span className="step-title text-body3">
          {step.title}
          {/*
            The status word, for readers who get no colour and no icon. `sr-only` rather than
            visible because the visible channels already carry it for everyone else — but a
            screen reader announcing "Prove" with no state at all is the row saying nothing.
          */}
          <span className="sr-only">{` — ${statusWord(step.status)}`}</span>
        </span>

        <span className="step-right text-body4">
          {step.fill !== null ? (
            <span className="step-fill">
              <span
                className="step-fill-bar"
                // The ONE inline style in this component, and it is unavoidable: the width is a
                // runtime number, and a token vocabulary cannot enumerate a continuum. The value
                // is already clamped to 0.5–99.5% by `stepsFor` before it arrives.
                style={{ width: `${step.fill * 100}%` }}
              />
            </span>
          ) : (
            <span className="numeric">{rightSlotText(step, elapsedMs, maturation)}</span>
          )}
        </span>
      </div>

      {/* The connector belongs BETWEEN rows, so the last one does not trail into nothing. */}
      {last ? null : <div className="step-connector" aria-hidden="true" />}
    </li>
  )
}

/**
 * What the right slot says, chosen by STAGE and not merely by status.
 *
 * ── THE DEFECT THIS REPLACED ──────────────────────────────────────────────────────────────
 *
 * The first version rendered `provingLabel(elapsedMs)` for every `in-progress` row. `liveStatus`
 * assigns that status to every stage we do not compute — `prove`, `relay`, `mature` and
 * `confirmed` — so the machine told the user "Still proving. Don't close this tab." while the
 * RELAYER was queuing, and "Proving — 0:42 elapsed" while a note MATURED. Meanwhile
 * `blockCountdown`, written and tested for exactly the maturity row, had no caller anywhere.
 *
 * Three reviewers found it independently. It is the same class of error as a determinate fill over
 * someone else's computation: copy that names a specific activity, rendered over a different one.
 */
function rightSlotText(
  step: ProgressStep,
  elapsedMs: number,
  maturation: Maturation | undefined,
): string {
  if (isCurrent(step.status)) {
    //
    // THE COUNTDOWN SLOT IS `mm:ss`, NOT THE LADDER SENTENCE. §7.7 is explicit that the right side
    // carries "Step 3 of 5 + countdown slot (mm:ss)" and that the escalating copy is the BUTTON's
    // job — "the button label is the narrator". An earlier version put the whole sentence here, so
    // "Still proving. Don't close this tab." had to fit a 40px row beside a title at 320px. It
    // wrapped, which broke the one thing this row promises. `provingLabel` lives in the shell row
    // and the CTA, where there is width for a sentence.
    //
    if (step.stage === 'prove') return `${step.position} · ${elapsedLabel(elapsedMs)}`

    // Maturity is COUNTED IN BLOCKS, never in time and never as a percentage (§7.7). Without a
    // real block count there is nothing honest to count, so it falls through to the position.
    if (step.stage === 'mature' && maturation) {
      return blockCountdown(maturation.confirmed, maturation.required)
    }
  }

  // `Step 3 of 5` — present on current rows, absent everywhere else. Previously unreachable for
  // four of the five stages, because the proving branch above used to swallow them all.
  return step.position ?? ''
}

/** One word per status, for the channel that survives everything else being stripped. */
function statusWord(status: ProgressStep['status']): string {
  switch (status) {
    case 'preview':
      return 'not started'
    case 'active':
      return 'in progress'
    case 'in-progress':
      return 'in progress'
    case 'complete':
      return 'done'
    case 'failed':
      return 'failed'
    case 'replaced':
      // History is never rewritten, and the word has to say why the row is still here.
      return 'replaced by a later attempt'
  }
}
