import { useId, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { DEFAULT_SLIPPAGE_BPS, parseSlippage } from '@strk20/protocol/quote'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const PRESETS_BPS = [10, 50, DEFAULT_SLIPPAGE_BPS] as const

export function slippageLabel(bps: number): string {
  return `${(bps / 100).toString()}%`
}

export interface SlippagePopoverProps {
  slippageBps: number
  onChange: (bps: number) => void
}

/**
 * Slippage tolerance. Presets or a typed percentage; the typed one goes through `parseSlippage`,
 * which refuses rather than clamps so the number on screen is the number in the transaction.
 */
export function SlippagePopover({ slippageBps, onChange }: SlippagePopoverProps) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const isPreset = PRESETS_BPS.some((preset) => preset === slippageBps)

  const onTyped = (next: string) => {
    setTyped(next)
    if (next.trim() === '') {
      setProblem(null)
      return
    }
    const parsed = parseSlippage(next)
    if ('bps' in parsed) {
      setProblem(null)
      onChange(parsed.bps)
    } else {
      setProblem(parsed.problem)
    }
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
        <Settings2 data-icon="inline-start" />
        Slippage {slippageLabel(slippageBps)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Slippage tolerance</PopoverTitle>
          <PopoverDescription>How far below the quote the fill may land before the swap reverts instead.</PopoverDescription>
        </PopoverHeader>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={isPreset ? [String(slippageBps)] : []}
          onValueChange={(group) => {
            const next = group[0]
            if (typeof next === 'string') {
              onChange(Number(next))
              setTyped('')
              setProblem(null)
            }
          }}
          aria-label="Slippage presets"
        >
          {PRESETS_BPS.map((preset) => (
            <ToggleGroupItem key={preset} value={String(preset)}>
              {slippageLabel(preset)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Field data-invalid={problem ? true : undefined}>
          <FieldLabel htmlFor={id}>Custom</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={id}
              value={typed}
              onChange={(e) => onTyped(e.target.value)}
              inputMode="decimal"
              placeholder={isPreset ? '' : slippageLabel(slippageBps).replace('%', '')}
              aria-invalid={problem ? true : undefined}
              className="font-mono tabular-nums"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {problem ? <FieldError>{problem}</FieldError> : <FieldDescription>Between 0.01% and 50%.</FieldDescription>}
        </Field>
      </PopoverContent>
    </Popover>
  )
}
