import { TriangleAlert } from 'lucide-react'
import { DESTINATIONS, type BridgeDestination } from '@strk20/protocol/bridge'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChainMark } from './chain-marks'

export interface DestinationPickerProps {
  value: BridgeDestination
  onChange: (next: BridgeDestination) => void
}

/** The chain comes first: a burn is irreversible, so "where" is decided before "how much". */
export function DestinationPicker({ value, onChange }: DestinationPickerProps) {
  return (
    <Field>
      <FieldLabel>Destination chain</FieldLabel>
      <ToggleGroup
        variant="outline"
        size="lg"
        value={[value.key]}
        onValueChange={(next) => {
          // Single-select can report an empty group on a re-press; the chosen chain stays.
          const picked = DESTINATIONS.find((d) => d.key === next[0])
          if (picked) onChange(picked)
        }}
        aria-label="Destination chain"
        className="flex-wrap"
      >
        {DESTINATIONS.map((d) => (
          <ToggleGroupItem key={d.key} value={d.key} aria-label={d.name} className="gap-2 px-3 aria-pressed:border-foreground">
            <ChainMark chainKey={d.key} size={18} />
            {d.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {value.caveat ? <DestinationCaveat chain={value} /> : null}
    </Field>
  )
}

/** The authored caveat, verbatim, where the chain is chosen — not discovered at the last screen. */
export function DestinationCaveat({ chain }: { chain: BridgeDestination }) {
  if (!chain.caveat) return null
  return (
    <Alert className="border-dashed border-exposed bg-exposedTint">
      <TriangleAlert className="text-exposed" />
      <AlertTitle>{chain.name} has an untested delivery path</AlertTitle>
      <AlertDescription>{chain.caveat}</AlertDescription>
    </Alert>
  )
}
