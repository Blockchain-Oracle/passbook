import { Check, Circle, X } from 'lucide-react'
import type { PipelineStage } from '@strk20/protocol/pipeline-stage'
import { elapsedLabel, isCurrent, provingLabel, stepsFor, type ProgressStep } from '@strk20/protocol/progress'

import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'

export interface OperationPipelineProps {
  stages: readonly PipelineStage[]
  reached: readonly PipelineStage[]
  failedAt?: PipelineStage | null
  replaced?: readonly PipelineStage[]
  /** Epoch ms when the pipeline started; drives the proving clock. */
  startedAt?: number | null
  /** Optional per-stage note under the current row. */
  notes?: Partial<Record<PipelineStage, string>>
  className?: string
}

/** A 1 s clock for the live row. Ticks only while something is in flight. */
function useElapsed(startedAt: number | null | undefined, running: boolean): number {
  const now = useNow(running && startedAt ? 1000 : false)
  return startedAt ? Math.max(0, now - startedAt) : 0
}

function StepMark({ step }: { step: ProgressStep }) {
  if (step.status === 'complete') return <Check className="text-settled" />
  if (step.status === 'failed') return <X className="text-irreversible" />
  if (isCurrent(step.status)) return <Spinner className="text-primary" />
  return <Circle className={cn('text-muted-foreground', step.status === 'replaced' && 'opacity-40')} />
}

/** Named stages from `progress.stepsFor`; the live row carries the proving clock. */
export function OperationPipeline({ stages, reached, failedAt, replaced, startedAt, notes, className }: OperationPipelineProps) {
  const steps = stepsFor({ stages, reached, failedAt: failedAt ?? null, replaced })
  const current = steps.find((s) => isCurrent(s.status))
  const done = steps.filter((s) => s.status === 'complete').length
  const running = current !== undefined && !failedAt
  const elapsed = useElapsed(startedAt, running)
  const fill = failedAt ? done / stages.length : Math.min(0.995, (done + (running ? 0.5 : 0)) / stages.length)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Progress value={Math.round(fill * 100)} aria-label={current ? `${current.title} in progress` : 'Pipeline progress'} />
      <ItemGroup className="gap-1">
        {steps.map((step) => {
          const live = isCurrent(step.status)
          const detail = live
            ? step.stage === 'prove'
              ? provingLabel(elapsed)
              : `${step.position ?? ''}${startedAt ? ` · ${elapsedLabel(elapsed)}` : ''}`
            : step.status === 'failed'
              ? 'Stopped here'
              : null
          const note = live ? notes?.[step.stage] : undefined
          return (
            <Item key={step.key} size="xs" className={cn(step.status === 'replaced' && 'opacity-50 line-through')}>
              <ItemMedia variant="icon">
                <StepMark step={step} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className={cn(live && 'text-foreground', step.status === 'preview' && 'text-muted-foreground')}>
                  {step.title}
                </ItemTitle>
                {detail ? <ItemDescription className="font-mono text-mono">{detail}</ItemDescription> : null}
                {note ? <ItemDescription>{note}</ItemDescription> : null}
              </ItemContent>
            </Item>
          )
        })}
      </ItemGroup>
    </div>
  )
}
