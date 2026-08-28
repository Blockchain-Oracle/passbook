import { useSyncExternalStore } from 'react'
import type { PipelineStage, RegistrationStage } from '@strk20/protocol/pipeline-stage'

// The running pipeline, held above the router so it survives navigation. Module-level because it
// is live UI state for a transaction that is paying for itself — not a cacheable read.

export type PipelineSubmitter = 'embedded' | 'wallet' | 'relayer'
export type PipelineTerminal = 'confirmed' | 'failed' | 'confirmation-unknown'
export type PipelineStageName = PipelineStage | RegistrationStage

export interface RunningPipeline {
  id: string
  /** The send kind, `'registration'` or `'shield'`. */
  operation: string
  route: string
  /** What the user is waiting on, in their words. */
  label: string
  stages: readonly PipelineStageName[]
  reached: readonly PipelineStageName[]
  failedAt: PipelineStageName | null
  replaced: readonly PipelineStageName[]
  startedAt: number
  stageStartedAt: Partial<Record<PipelineStageName, number>>
  transactionHash: string | null
  explorerUrl: string | null
  submittedBy: PipelineSubmitter | null
  terminal: PipelineTerminal | null
  /** Past `relay` there is nothing truthful to cancel — the button must go away, not lie. */
  submitted: boolean
  cancel: (() => void) | null
}

const listeners = new Set<() => void>()
let state: RunningPipeline | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPipeline(): RunningPipeline | null {
  return state
}

export function usePipeline(): RunningPipeline | null {
  return useSyncExternalStore(subscribe, getPipeline, () => null)
}

/** A pipeline still narrating: not failed, not terminal. The second one loses. */
export function pipelineIsLive(p: RunningPipeline | null = state): boolean {
  return p !== null && p.failedAt === null && p.terminal === null
}

export function startPipeline(
  pipeline: Pick<RunningPipeline, 'id' | 'operation' | 'route' | 'label' | 'stages' | 'startedAt' | 'cancel'>,
): void {
  // Overwriting silently would drop a live pipeline's cancel while its transaction kept running.
  if (pipelineIsLive(state)) {
    throw new Error(
      `startPipeline: ${JSON.stringify(state!.label)} is still running. Clear or cancel it first — ` +
        'silently replacing it would strand a transaction that is already paying for itself.',
    )
  }
  state = {
    ...pipeline,
    reached: [],
    failedAt: null,
    replaced: [],
    submitted: false,
    stageStartedAt: {},
    transactionHash: null,
    explorerUrl: null,
    submittedBy: null,
    terminal: null,
  }
  emit()
}

/** Idempotent: an observer firing twice for one stage must not produce two rows. */
export function reachStage(stage: PipelineStageName): void {
  if (!state || state.reached.includes(stage)) return
  state = {
    ...state,
    reached: [...state.reached, stage],
    stageStartedAt: { ...state.stageStartedAt, [stage]: Date.now() },
    submitted: state.submitted || stage === 'relay' || stage === 'mature' || stage === 'confirmed',
  }
  emit()
}

export function failPipeline(stage: PipelineStageName): void {
  if (!state) return
  state = { ...state, failedAt: stage, terminal: 'failed' }
  emit()
}

export function setPipelineSubmission(input: {
  transactionHash: string
  explorerUrl?: string | null
  submittedBy: PipelineSubmitter
}): void {
  if (!state) return
  state = {
    ...state,
    submitted: true,
    transactionHash: input.transactionHash,
    explorerUrl: input.explorerUrl ?? state.explorerUrl,
    submittedBy: input.submittedBy,
  }
  emit()
}

export function finishPipeline(terminal: PipelineTerminal): void {
  if (!state) return
  state = { ...state, terminal }
  emit()
}

/** The expired-proof case: the earlier attempt keeps its row and gains a replaced marker. */
export function replaceStage(stage: PipelineStageName): void {
  if (!state || state.replaced.includes(stage)) return
  state = { ...state, replaced: [...state.replaced, stage] }
  emit()
}

export function canCancel(pipeline: RunningPipeline | null): boolean {
  return pipeline !== null && !pipeline.submitted && pipeline.cancel !== null
}

export function cancelPipeline(): void {
  if (!canCancel(state)) return
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

/** Drop a finished or failed row so the next operation can start. A live one stays. */
export function clearSettledPipeline(): void {
  if (state && !pipelineIsLive(state)) clearPipeline()
}
