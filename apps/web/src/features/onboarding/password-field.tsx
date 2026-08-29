import { useState, type KeyboardEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { MIN_PASSWORD_LENGTH, passwordStrength, type PasswordStrength } from '@strk20/protocol/session-vault'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

interface PasswordFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'new-password' | 'current-password' | 'off'
  autoFocus?: boolean
  /** Show the strength meter — only where a password is being chosen, never where one is typed back. */
  meter?: boolean
  error?: string | null
  hint?: string
  mono?: boolean
}

/* One colour, more of it: the meter fills in the brand orange and the word carries the verdict. */
const METER: Record<PasswordStrength, { filled: number; label: string }> = {
  'too-short': { filled: 1, label: `Too short — at least ${MIN_PASSWORD_LENGTH} characters` },
  weak: { filled: 2, label: 'Weak — a longer phrase beats symbols' },
  fair: { filled: 3, label: 'Fair' },
  strong: { filled: 4, label: 'Strong' },
}

/** One password input for the whole app: reveal toggle, Caps Lock notice, inline error, optional meter. */
export function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, meter = false, error, hint, mono }: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const strength = meter && value ? METER[passwordStrength(value)] : null
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'))

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-12 bg-background">
        <InputGroupInput
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onKeyUp={onKey}
          aria-invalid={error ? true : undefined}
          aria-describedby={strength ? `${id}-meter` : undefined}
          className={cn('text-body2', mono && 'font-mono text-body3')}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-sm"
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {strength ? (
        <div id={`${id}-meter`} className="flex items-center gap-3" aria-live="polite">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn('h-1 flex-1 rounded-pill transition-colors duration-quick', i < strength.filled ? 'bg-primary' : 'bg-inset')}
              />
            ))}
          </div>
          <span className="shrink-0 text-body4 text-muted-foreground">{strength.label}</span>
        </div>
      ) : null}
      {caps ? <FieldDescription className="text-primary">Caps Lock is on.</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )
}
