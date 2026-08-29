//
// The one progress machine, as data. Steps are an array, not JSX: a registration passes a shorter
// list to the same renderer, and a sixth step has to be added to the union first. Never reads a
// clock or a chain — the states that matter (a proof expiring, a ten-minute prove) cannot be
// reproduced on demand, so every function is pure over its arguments.
//
import {
  ownsComputation,
  STAGE_TITLES,
  type PipelineStage,
} from './pipeline-stage.js'

/**
 * The whole status vocabulary. Six, closed — a seventh string is a compile error.
 *
 * `active` and `in-progress` are BOTH "this is the current step". They differ in one thing: who is
 * computing. `active` is our own work and may carry a determinate fill; `in-progress` is somebody
 * else's and gets the indeterminate ring. Anything that asks "is this the current step" should ask
 * `isCurrent()` rather than testing one of them and silently excluding the other.
 */
export type StepStatus =
  | 'preview'
  | 'active'
  | 'in-progress'
  | 'complete'
  | 'failed'
  | 'replaced'

/** True for the two statuses that mean "this is where the pipeline is right now". */
export function isCurrent(status: StepStatus): boolean {
  return status === 'active' || status === 'in-progress'
}

export interface ProgressStep {
  /**
   * Stable per ROW, not per stage — and that is load-bearing. A replaced attempt and its live
   * retry are the same stage twice in one list, so keying on `stage` would give two DOM nodes the
   * same id and React the same key. (Story 6.4's review found exactly this defect when a token
   * appeared in two sections.)
   */
  key: string
  stage: PipelineStage
  title: string
  status: StepStatus
  /** `Step 3 of 5`, on the current row only. Null everywhere else. */
  position: string | null
  /**
   * The determinate fill, 0.005–0.995, or `null` — which is the normal case. Null means "render
   * the ring", and it is null for every stage we do not compute ourselves NO MATTER WHAT THE
   * CALLER PASSED. See `stepsFor`.
   */
  fill: number | null
}

export interface PipelineState {
  /** The pipeline's own stage list — `SEND_STAGES` or `REGISTRATION_STAGES`. */
  stages: readonly PipelineStage[]
  /** What `onStage` has reported so far. Order does not matter; the furthest one wins. */
  reached: readonly PipelineStage[]
  /** Set when the pipeline stopped. That stage renders `failed` and nothing after it activates. */
  failedAt?: PipelineStage | null
  /**
   * Stages whose earlier attempt was superseded — today only `prove`, after a proof expired and
   * was regenerated. Each adds a greyed row ABOVE the live one: history is never rewritten.
   */
  replaced?: readonly PipelineStage[]
  /** Raw determinate progress for the current stage, 0–1. Ignored unless we own that stage. */
  fill?: number | null
}

//
// THE CLAMP. 0% reads as "nothing is happening" and 100% reads as "done", and both are lies while
// work is in flight — the second one especially, because a bar that sits at 100% for eight seconds
// teaches the user that the bar means nothing.
//
export const PROGRESS_FLOOR = 0.005
export const PROGRESS_CEILING = 0.995

/**
 * Clamps into the honest band.
 *
 * NaN AND INFINITY ARE NOT THE SAME CASE. `NaN` means the estimate is unknown, so it starts at the
 * floor. `Infinity` means the estimate overshot, and floor-ing it would drive the bar BACKWARDS at
 * the moment a step finished. Comparisons against NaN are all false, so `Math.max`/`Math.min`
 * would otherwise let it through untouched.
 */
export function clampProgress(raw: number): number {
  if (Number.isNaN(raw)) return PROGRESS_FLOOR
  return Math.min(PROGRESS_CEILING, Math.max(PROGRESS_FLOOR, raw))
}

/**
 * Turns a pipeline state into rows.
 *
 * THE HONESTY RULE IS ENFORCED HERE, not at the call site: `fill` comes back `null` for every
 * stage `ownsComputation()` rejects, even when the caller passed a number. A component cannot
 * render a determinate bar over the hosted prover by mistake, because it never receives one.
 */
export function stepsFor(state: PipelineState): ProgressStep[] {
  const { stages, reached, failedAt = null, replaced = [], fill = null } = state

  const furthest = stages.reduce(
    (best, stage, index) => (reached.includes(stage) ? index : best),
    -1,
  )

  //
  // A FAILURE THAT IS NOT IN THIS PIPELINE IS A BUG, AND IT MUST NOT RENDER AS SUCCESS.
  //
  // `PipelineStage` is the send union, so a registration pipeline can legally be handed `mature` —
  // a stage its own list does not contain. `indexOf` answers -1, which the old code read as "no
  // failure" and rendered as a pipeline still cheerfully running. Silence about a failure is the
  // worst possible direction to fail in, so this throws rather than guessing which stage was meant.
  //
  if (failedAt !== null && !stages.includes(failedAt)) {
    throw new Error(
      `stepsFor: failedAt ${JSON.stringify(failedAt)} is not one of this pipeline's stages ` +
        `(${stages.join(', ')})`,
    )
  }

  const failedIndex = failedAt ? stages.indexOf(failedAt) : -1
  const current = failedIndex >= 0 ? failedIndex : furthest

  // Reaching the LAST stage means the pipeline finished — `onStage('confirmed')` is not a step in
  // flight, it is the end. Without this the terminal row would render as forever-active.
  const finished = failedIndex < 0 && current === stages.length - 1 && current >= 0

  const rows: ProgressStep[] = []

  stages.forEach((stage, index) => {
    // One row per replaced attempt, each with its own key: a proof can expire twice, and
    // `${stage}#replaced` for both would give two rows one React key.
    const attempts = replaced.filter((s) => s === stage).length
    for (let attempt = 0; attempt < attempts; attempt++) {
      rows.push({
        key: `${stage}#replaced-${attempt}`,
        stage,
        title: STAGE_TITLES[stage],
        status: 'replaced',
        position: null,
        fill: null,
      })
    }

    let status: StepStatus
    if (finished) status = 'complete'
    else if (index < current) status = 'complete'
    else if (index === current) status = failedIndex >= 0 ? 'failed' : liveStatus(stage)
    else status = 'preview'

    rows.push({
      key: stage,
      stage,
      title: STAGE_TITLES[stage],
      status,
      position: isCurrent(status) ? `Step ${index + 1} of ${stages.length}` : null,
      fill: status === 'active' && fill !== null ? clampProgress(fill) : null,
    })
  })

  return rows
}

function liveStatus(stage: PipelineStage): StepStatus {
  return ownsComputation(stage) ? 'active' : 'in-progress'
}

// ── The copy ladder ───────────────────────────────────────────────────────────────────────
//
// Escalation is a LABEL SWAP and nothing else: a visual that intensifies with time is a claim that
// something is going wrong, and usually nothing is.

/** Past this, "how long has it been" stops reassuring and starts needing an instruction. */
export const PROVING_PATIENCE_MS = 20_000

/** Past this we say so. Ten minutes on a hosted prover is outside normal, and pretending otherwise
 *  leaves the user deciding on their own whether we have hung. */
export const PROVING_ABNORMAL_MS = 600_000

/**
 * `m:ss`. Seconds always two digits; minutes never padded and allowed past 59, so a long wait
 * reads `12:07` rather than rolling over into a wrong hour.
 */
export function elapsedLabel(ms: number): string {
  // `Math.max(0, NaN)` is NaN, so the negative guard alone let `NaN:NaN` reach the row. A clock
  // that has not started yet is zero elapsed, which is both true and renderable.
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** The three-rung proving ladder. No prover-status link: nobody authored a URL, and a link to nowhere is worse than none. */
export function provingLabel(elapsedMs: number): string {
  if (elapsedMs >= PROVING_ABNORMAL_MS) return 'This is taking longer than normal.'
  if (elapsedMs >= PROVING_PATIENCE_MS) return "Still proving. Don't close this tab."
  return `Proving — ${elapsedLabel(elapsedMs)} elapsed`
}

/**
 * Block waits are COUNTED, never expressed as a percentage, and a countdown never goes negative.
 * No "(about 7 seconds)": no duration ships until a real proof has been timed.
 */
export function blockCountdown(confirmed: number, required: number): string {
  const remaining = required - confirmed
  if (!Number.isFinite(remaining) || remaining <= 0) return 'Available shortly'
  return remaining === 1
    ? 'Spendable in 1 more block.'
    : `Spendable in ${remaining} more blocks.`
}
