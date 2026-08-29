import { Ban, Eye } from 'lucide-react'
import { AUDITOR_ESCROW, NOTES_STAY, POOL_SEES, RELAYER_SEES, WHO_CAN_READ } from '@strk20/protocol/disclosure-copy'
import { FORBIDDEN_CLAIMS } from '@strk20/protocol/forbidden-claims'
import { CONTEXT_LABELS, VISIBILITY_CONTEXTS, type VisibilityContext } from '@strk20/protocol/visibility-matrix'

import { VisibilityMatrixView } from '@/components/privacy/visibility-matrix'
import { Badge } from '@/components/ui/badge'
import { Field, FieldLabel } from '@/components/ui/field'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsSection } from './section'
import { MATRIX_PICKER_LABEL, NEVER_CLAIM_BODY, NEVER_CLAIM_TITLE, OPEN_NOTE_PUBLIC, RECIPIENT_SEES } from './settings-copy'

export interface PrivacySectionProps {
  context: VisibilityContext
  onContextChange: (context: VisibilityContext) => void
}

function isContext(v: unknown): v is VisibilityContext {
  return typeof v === 'string' && (VISIBILITY_CONTEXTS as readonly string[]).includes(v)
}

// The protocol's sentences, in the order a reader meets the actors: pool, relayer, auditor, you.
const STANDING_LINES = [POOL_SEES, RELAYER_SEES, AUDITOR_ESCROW, NOTES_STAY, RECIPIENT_SEES, OPEN_NOTE_PUBLIC]

/** The claims list ships verbatim from `forbidden-claims.ts`; the matrix is the protocol's, per context. */
export function PrivacySection({ context, onContextChange }: PrivacySectionProps) {
  return (
    <SettingsSection id="privacy" index="04" title="Privacy">
      <Item variant="outline" className="items-start">
        <ItemMedia variant="icon">
          <Ban aria-hidden />
        </ItemMedia>
        <ItemContent className="gap-2">
          <ItemTitle>{NEVER_CLAIM_TITLE}</ItemTitle>
          <ItemDescription className="line-clamp-none">{NEVER_CLAIM_BODY}</ItemDescription>
          <ul className="flex flex-wrap gap-1.5" aria-label={NEVER_CLAIM_TITLE}>
            {FORBIDDEN_CLAIMS.map((claim) => (
              <li key={claim}>
                <Badge variant="outline" className="font-mono text-mono normal-case line-through decoration-irreversible/70">
                  {claim}
                </Badge>
              </li>
            ))}
          </ul>
        </ItemContent>
      </Item>

      <Item variant="muted" className="items-start">
        <ItemMedia variant="icon">
          <Eye aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>What is true instead</ItemTitle>
          <ul className="flex flex-col gap-1.5 text-body4 text-muted-foreground">
            {STANDING_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </ItemContent>
      </Item>

      <Item variant="outline" className="items-start">
        <ItemContent className="gap-3">
          <ItemTitle>{WHO_CAN_READ}</ItemTitle>
          <Field orientation="horizontal" className="flex-wrap items-center">
            <FieldLabel htmlFor="matrix-context">{MATRIX_PICKER_LABEL}</FieldLabel>
            <Select
              value={context}
              items={CONTEXT_LABELS}
              onValueChange={(v) => {
                if (isContext(v)) onContextChange(v)
              }}
            >
              <SelectTrigger id="matrix-context" className="w-full sm:w-auto sm:min-w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_CONTEXTS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONTEXT_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <VisibilityMatrixView context={context} />
        </ItemContent>
      </Item>
    </SettingsSection>
  )
}
