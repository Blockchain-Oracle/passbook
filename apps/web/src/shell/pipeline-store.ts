//
// The running pipeline, held above the router (story 6.5).
//
// ── WHY A MODULE-LEVEL STORE AND NOT CONTEXT ──────────────────────────────────────────────
//
// The requirement is that a pipeline survives navigation. React context would satisfy that too,
// as long as the provider sits above the outlet — but context re-renders every consumer on every
// tick of the elapsed counter, and the shell has six nav items and a header in that subtree.
// `useSyncExternalStore` re-renders only what subscribed.
//
// ── THERE IS NO SAVE AND RESTORE, ON PURPOSE ──────────────────────────────────────────────
//
// The epic already ruled that teleporting a subtree between two chromes is unimplementable in
// React and replaced it with one authored tree plus hoisted state. This is the same shape: the row
// is mounted ABOVE the outlet, so navigating swaps the outlet's children and never touches it.
// Nothing is serialised on navigate and rehydrated after, which means nothing can be rehydrated
// WRONGLY — the failure mode that a save/restore implementation would have.
//
import type { PipelineStage } from '@strk20/protocol/pipeline-stage'

export interface RunningPipeline {
  /** What the user is waiting on, in their words. Becomes the row's accessible name. */
  label: string
  stages: readonly PipelineStage[]
  reached: readonly PipelineStage[]
  failedAt: PipelineStage | null
  replaced: readonly PipelineStage[]
  /** `Date.now()` at start. The row derives elapsed from it rather than counting ticks itself. */
  startedAt: number
  /**
   * Whether anything has been handed to the relayer or the chain yet.
   *
   * THIS IS WHAT MAKES CANCEL HONEST. `send.ts` documents that a stage observer must not be able
   * to abort a transaction that is already paying for itself — so past submission there is nothing
   * truthful to offer, and the button goes away rather than becoming a lie.
   */
  submitted: boolean
  /** Supplied by whoever started the pipeline. Absent means there is nothing to cancel. */
  cancel: (() => void) | null
}

type Listener = () => void

const listeners = new Set<Listener>()

// One object identity per state. `useSyncExternalStore` compares snapshots by reference and will
// loop forever if `getSnapshot` mints a new object per call — so mutations replace this whole
// value and reads hand back exactly what is here.
let state: RunningPipeline | null = null

function emit() {
  for (const listener of listeners) listener()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPipeline(): RunningPipeline | null {
  return state
}

export function startPipeline(
  pipeline: Omit<RunningPipeline, 'reached' | 'failedAt' | 'replaced' | 'submitted'> &
    Partial<Pick<RunningPipeline, 'reached' | 'failedAt' | 'replaced' | 'submitted'>>,
): void {
  //
  // ONE PIPELINE AT A TIME, AND THE SECOND ONE LOSES. Overwriting silently would drop a live
  // pipeline's `cancel` on the floor while the transaction it belongs to kept running — the row
  // would vanish and the send would carry on, which is the worst combination available. The
  // multi-tab version of this problem is the leader lock (6.9); this is the same-tab half.
  //
  if (state !== null && state.failedAt === null) {
    throw new Error(
      `startPipeline: ${JSON.stringify(state.label)} is still running. Clear or cancel it first — ` +
        'silently replacing it would strand a transaction that is already paying for itself.',
    )
  }

  state = {
    reached: [],
    failedAt: null,
    replaced: [],
    submitted: false,
    ...pipeline,
  }
  emit()
}

/**
 * Records a stage from `onStage`.
 *
 * Idempotent: an observer that fires twice for one stage must not produce two rows or two
 * announcements. `send.ts` pushes to its own array before calling out, so a duplicate is a real
 * possibility rather than a defensive hypothetical.
 */
export function reachStage(stage: PipelineStage): void {
  if (!state || state.reached.includes(stage)) return
  state = {
    ...state,
    reached: [...state.reached, stage],
    // Once the relayer or the chain has it, cancel stops being offerable. `relay` is the boundary.
    submitted: state.submitted || stage === 'relay' || stage === 'mature' || stage === 'confirmed',
  }
  emit()
}

export function failPipeline(stage: PipelineStage): void {
  if (!state) return
  state = { ...state, failedAt: stage }
  emit()
}

/**
 * Marks a stage's earlier attempt as superseded — the expired proof case.
 *
 * The dead attempt keeps its row. History is never rewritten, so this ADDS a replaced marker
 * rather than removing the stage from `reached`.
 */
export function replaceStage(stage: PipelineStage): void {
  if (!state || state.replaced.includes(stage)) return
  state = { ...state, replaced: [...state.replaced, stage] }
  emit()
}

/** True only while cancelling is something we can actually do. */
export function canCancel(pipeline: RunningPipeline | null): boolean {
  return pipeline !== null && !pipeline.submitted && pipeline.cancel !== null
}

export function cancelPipeline(): void {
  if (!canCancel(state)) return
  // `finally`, so a throwing `cancel` still clears the row. Without it a failed cancel left the
  // state intact and un-emitted — a Cancel button still on screen for an attempt that had already
  // been told to stop, which invites a second press against a half-cancelled pipeline.
  try {
    state!.cancel!()
  } finally {
    state = null
    emit()
  }
}

export function clearPipeline(): void {
  state = null
  emit()
}

/** Test seam. Production code never needs this; a suite that leaked state into the next case does. */
export function resetPipelineStore(): void {
  state = null
  listeners.clear()
}
