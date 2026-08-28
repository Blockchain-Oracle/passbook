import { ArrowUpRight, Check } from 'lucide-react'
import type { Disclosure, DisclosureLine } from '@strk20/protocol/disclosure'
import { panelSeverity } from '@strk20/protocol/disclosure'
import { getPrivacyColor, type PrivacyColor } from '@strk20/protocol/privacy'
import { CONTEXT_LABELS } from '@strk20/protocol/visibility-matrix'

import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item'
import { cn } from '@/lib/utils'

const TONE: Record<PrivacyColor, { text: string; ring: string }> = {
  neutral: { text: 'text-foreground', ring: 'border-border' },
  quiet: { text: 'text-muted-foreground', ring: 'border-border' },
  exposed: { text: 'text-exposed', ring: 'border-dashed border-exposed bg-exposedTint' },
  irreversible: { text: 'text-irreversible', ring: 'border-irreversible bg-irreversibleTint' },
}

function Marker({ line }: { line: DisclosureLine }) {
  return line.marker === 'leaves' ? (
    <ArrowUpRight className="text-exposed" aria-label="leaves the private domain" />
  ) : (
    <Check className="text-settled" aria-label="stays private" />
  )
}

export interface DisclosurePanelViewProps {
  panel: Disclosure
  /** Renders the way-out button only when supplied; a label with no action is an overclaim. */
  onWayOut?: () => void
  className?: string
}

/**
 * The required review disclosure. First line is the headline and takes the panel's colour;
 * every other line is neutral. Marker = word + shape, so it survives greyscale.
 */
export function DisclosurePanelView({ panel, onWayOut, className }: DisclosurePanelViewProps) {
  if (!panel.authored) {
    return (
      <p className={cn('rounded-lg border border-dashed px-3 py-2 text-body4 text-muted-foreground', className)}>
        {panel.because}
      </p>
    )
  }
  const tone = TONE[getPrivacyColor(panelSeverity(panel))]
  const [headline, ...rest] = panel.lines
  return (
    <section aria-label={`What this reveals: ${CONTEXT_LABELS[panel.context]}`} className={cn('rounded-lg border p-3', tone.ring, className)}>
      <p className="text-kicker uppercase text-muted-foreground">Who sees what</p>
      <ItemGroup className="mt-2 gap-1.5">
        {headline ? (
          <Item size="xs" className="items-start p-0">
            <ItemMedia variant="icon">
              <Marker line={headline} />
            </ItemMedia>
            <ItemContent className={cn('text-body3 font-medium', tone.text)}>{headline.text}</ItemContent>
          </Item>
        ) : null}
        {rest.map((line) => (
          <Item key={line.text} size="xs" className="items-start p-0">
            <ItemMedia variant="icon">
              <Marker line={line} />
            </ItemMedia>
            <ItemContent className="text-body4 text-muted-foreground">{line.text}</ItemContent>
          </Item>
        ))}
      </ItemGroup>
      {panel.wayOut && onWayOut ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onWayOut}>
          {panel.wayOut.label}
        </Button>
      ) : null}
    </section>
  )
}
