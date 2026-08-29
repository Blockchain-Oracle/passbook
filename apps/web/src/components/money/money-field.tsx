import { useId } from 'react'
import { ArrowRightLeft } from 'lucide-react'

import { Amount } from '@/components/money/amount'
import type { AssetBoundary } from '@/components/money/asset-identity'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

export interface ShieldDoor {
  shortfallWei: bigint
  onShield: () => void
}

export interface MoneyFieldProps {
  value: string
  onChange: (next: string) => void
  symbol: string
  decimals: number | null
  /** The balance this field spends. `null` = unreadable (renders an em dash). */
  available: bigint | null
  boundary: AssetBoundary
  onMax?: () => void
  /** A parse or balance problem from the caller; rendered inline as the field error. */
  problem?: string | null
  /** Offered when the shielded side is short and public money could cover it. */
  shieldDoor?: ShieldDoor | null
  label?: string
  autoFocus?: boolean
  className?: string
}

const BOUNDARY_WORD: Record<AssetBoundary, string> = { shielded: 'shielded', public: 'public' }

/** An amount input that says which balance it spends, and opens the shield door when short. */
export function MoneyField({
  value,
  onChange,
  symbol,
  decimals,
  available,
  boundary,
  onMax,
  problem,
  shieldDoor,
  label = 'Amount',
  autoFocus,
  className,
}: MoneyFieldProps) {
  const id = useId()
  const invalid = Boolean(problem)
  return (
    <Field className={className} data-invalid={invalid || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span className="text-body4 text-muted-foreground">
          Spends {BOUNDARY_WORD[boundary]} · <Amount wei={available} decimals={decimals} symbol={symbol} size="sm" />
        </span>
      </div>
      <InputGroup className="h-12">
        <InputGroupInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0"
          aria-invalid={invalid || undefined}
          className={cn('h-full font-mono text-display4 tabular-nums', invalid && 'text-irreversible')}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="font-medium text-foreground">{symbol}</InputGroupText>
          {onMax ? (
            <InputGroupButton onClick={onMax} aria-disabled={available === null || undefined}>
              Max
            </InputGroupButton>
          ) : null}
        </InputGroupAddon>
      </InputGroup>
      {problem ? <FieldError>{problem}</FieldError> : null}
      {shieldDoor ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-public bg-publicTint px-3 py-2">
          <FieldDescription className="text-foreground">
            Short by <Amount wei={shieldDoor.shortfallWei} decimals={decimals} symbol={symbol} size="sm" /> shielded. Your
            public {symbol} can cover it.
          </FieldDescription>
          <Button size="sm" variant="outline" onClick={shieldDoor.onShield} className="shrink-0">
            <ArrowRightLeft data-icon="inline-start" />
            Shield {symbol}
          </Button>
        </div>
      ) : null}
    </Field>
  )
}
