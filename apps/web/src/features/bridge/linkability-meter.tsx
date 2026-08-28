import type { LinkabilityModel, NoteFieldModel } from '@strk20/protocol/linkability'
import { FIELD_DOT_MEANING, FIELD_DOT_YOURS, UNMEASURABLE_CONSEQUENCE, caretDelta } from '@strk20/protocol/linkability-copy'
import { getPrivacyColor, type PrivacyColor } from '@strk20/protocol/privacy'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// The surface's privacy claim: a count, a sentence and a picture. No score, no gauge. Severity
// arrives as a value from the model and is only ever mapped through `getPrivacyColor`.

const TONE: Record<PrivacyColor, string> = {
  neutral: 'text-foreground',
  quiet: 'text-muted-foreground',
  exposed: 'text-exposed',
  irreversible: 'text-irreversible',
}

export interface LinkabilityMeterProps {
  meter: LinkabilityModel
  /** The crowd is still being read: draw a placeholder, not "unreachable". */
  pending?: boolean
  /** `row` is the one-line form for a surface that is not yet an action. */
  variant?: 'full' | 'row'
  className?: string
}

export function LinkabilityMeter({ meter, pending = false, variant = 'full', className }: LinkabilityMeterProps) {
  if (pending) {
    return variant === 'row' ? (
      <Skeleton className={cn('h-5 w-full', className)} />
    ) : (
      <section aria-label="Anonymity set" aria-busy className={cn('flex flex-col gap-3', className)}>
        <p className="text-kicker uppercase text-muted-foreground">Anonymity set</p>
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="aspect-square w-full max-w-64 rounded-pill" />
      </section>
    )
  }

  if (meter.state === 'unmeasurable') {
    if (variant === 'row') {
      return (
        <div className={cn('flex items-baseline justify-between gap-3 text-body4', className)}>
          <span className="text-muted-foreground">Anonymity set</span>
          <span className="text-muted-foreground">{meter.because}</span>
        </div>
      )
    }
    // Silence, not a warning: a failed read is not evidence about the user's exposure.
    return (
      <section aria-label="Anonymity set" className={cn('flex flex-col gap-2', className)}>
        <p className="text-kicker uppercase text-muted-foreground">Anonymity set</p>
        <p className="text-body3">{meter.because}</p>
        <p className="text-body4 text-muted-foreground">{UNMEASURABLE_CONSEQUENCE}</p>
      </section>
    )
  }

  const tone = meter.severity === null ? 'text-foreground' : TONE[getPrivacyColor(meter.severity)]

  if (variant === 'row') {
    return (
      <div className={cn('flex items-baseline justify-between gap-3 text-body4', className)}>
        <span className="text-muted-foreground">Anonymity set</span>
        <span className={cn('font-mono tabular-nums', tone)}>{meter.candidates.toLocaleString('en-US')} possible sources</span>
      </div>
    )
  }

  return (
    <section aria-label="Anonymity set" className={cn('flex flex-col gap-3', className)}>
      <p className="text-kicker uppercase text-muted-foreground">Anonymity set</p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-display2 tabular-nums" aria-label="Possible sources">
          {meter.candidates.toLocaleString('en-US')}
        </span>
        <span className="text-body4 text-muted-foreground">possible sources</span>
        {meter.caretDelta === null ? null : <span className="text-body4 text-settled">{caretDelta(meter.caretDelta)}</span>}
      </p>
      <p className={cn('text-body3 font-medium', tone)}>{meter.headline}</p>
      {meter.lines.map((line) => (
        <p key={line} className="text-body4 text-muted-foreground">
          {line}
        </p>
      ))}
      <NoteField field={meter.field} label={`${meter.candidates} possible sources, including yours`} />
      <p className="text-body4 text-muted-foreground">{meter.provenance}</p>
      {meter.alternatives.length > 0 ? (
        // Labels, not buttons: nothing on this surface can fulfil them yet, and a no-op is an overclaim.
        <ul className="flex flex-wrap gap-1.5" aria-label="What would help">
          {meter.alternatives.map((label) => (
            <li key={label}>
              <Badge variant="outline">{label}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** The picture: one dot per candidate deposit, yours at the centre. Deterministic from the model. */
export function NoteField({ field, label }: { field: NoteFieldModel; label: string }) {
  const count = Math.max(field.nodes.length, 1)
  // Viewbox units: dense fields get small dots, sparse ones stay readable.
  const radius = Math.min(3, Math.max(0.5, 100 / (Math.sqrt(count) * 6)))
  const mine = field.nodes.find((node) => node.mine)
  const big = Math.max(radius * 2.4, 3)
  return (
    <figure className="flex flex-col gap-1.5">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        className="aspect-square w-full max-w-64 rounded-lg bg-inset"
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="fill-neutral3">
          {field.nodes.map((node, index) =>
            node.mine ? null : <circle key={index} cx={node.x * 100} cy={node.y * 100} r={radius} />,
          )}
        </g>
        {mine ? (
          <g>
            <circle cx={mine.x * 100} cy={mine.y * 100} r={big + 2.5} className="fill-inset" />
            <circle cx={mine.x * 100} cy={mine.y * 100} r={big} className="fill-neutral1" />
            <circle cx={mine.x * 100} cy={mine.y * 100} r={big + 3.5} className="fill-none stroke-neutral1" strokeWidth="0.8" />
          </g>
        ) : null}
      </svg>
      <figcaption className="text-body4 text-muted-foreground">
        {FIELD_DOT_MEANING} {FIELD_DOT_YOURS}
        {field.downsampled
          ? ` Showing ${field.nodes.length.toLocaleString('en-US')} of ${field.total.toLocaleString('en-US')} — the picture is a sample, the count is not.`
          : null}
      </figcaption>
    </figure>
  )
}
