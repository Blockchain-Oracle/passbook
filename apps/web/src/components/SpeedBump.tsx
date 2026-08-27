//
// The ordered speed-bump chain (Uniswap `SendForm.tsx:190` is the model).
//
// ── EACH BUMP CLEARS ONLY ITS OWN FLAG ────────────────────────────────────────────────────
//
// The mechanism is the whole design. A single "I understand" checkbox for a screen with two
// different risks on it teaches a user that acknowledging is a gesture rather than a reading, and
// then the one that mattered is cleared by a reflex aimed at the other. So each bump is its own
// dialog with its own confirm, and clearing it clears nothing else — change the amount and a
// dismissed amount warning comes back while a dismissed chain warning stays dismissed.
//
// ── AND THEY ARE ONLY EVER RAISED BY A MEASUREMENT ────────────────────────────────────────
//
// Two of them exist on the crossing surface: a destination whose delivery path nobody has tested,
// and a crowd small enough that the amount identifies the sender. Both are facts read from
// somewhere — the destination registry and a bounded read of real pool events. There is
// deliberately no "unfamiliar address" bump, which Uniswap does have: it needs an address book to
// mean anything, this app has none, and a warning that fires on every address is one nobody reads.
//
import type { ReactNode } from 'react'

import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

export interface SpeedBumpModel {
  /** Stable id. It is what the acknowledgement is keyed on, so it must not encode the amount. */
  readonly id: string
  readonly title: string
  /** The body, already authored elsewhere — this component writes no privacy copy of its own. */
  readonly lines: readonly string[]
  /** What the button says. Never "OK": the label should name what continuing does. */
  readonly confirmLabel: string
  /** Rendered under the lines, for a bump that carries a drawing or a list. */
  readonly detail?: ReactNode
}

export interface SpeedBumpProps {
  /** The first unacknowledged bump, or `null` when the chain is clear. */
  bump: SpeedBumpModel | null
  onAcknowledge: (id: string) => void
  /** Backing out. Closes the whole flow rather than falling through to the next bump. */
  onDismiss: () => void
}

export function SpeedBump({ bump, onAcknowledge, onDismiss }: SpeedBumpProps) {
  return (
    <ResponsiveDialog
      open={bump !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
      label={bump?.title ?? 'Before you continue'}
      modal
    >
      {bump ? (
        <div className="flex min-h-0 w-full min-w-0 flex-col gap-s16">
          <Text variant="subheading1" as="h2" className="text-exposed">
            {bump.title}
          </Text>

          <div className="-mx-s4 flex min-h-0 flex-1 flex-col gap-s12 overflow-y-auto px-s4">
            {bump.lines.map((line) => (
              <Text key={line} variant="body3" className="text-neutral2">
                {line}
              </Text>
            ))}
            {bump.detail}
          </div>

          <div className="flex flex-col gap-s8">
            {/*
              THE CONTINUE IS THE SECONDARY BUTTON AND BACKING OUT IS THE PRIMARY ONE.
              Inverted from the ordinary dialog on purpose: at this point the app has just told
              somebody something it thinks they should reconsider, and putting the loud styling on
              "continue" would undo the sentence above it.
            */}
            <Button variant="primary" size="lg" fill onClick={onDismiss}>
              Go back
            </Button>
            <Button variant="secondary" size="lg" fill onClick={() => onAcknowledge(bump.id)}>
              {bump.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </ResponsiveDialog>
  )
}
